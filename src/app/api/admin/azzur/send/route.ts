// src/app/api/admin/azzur/send/route.ts
//
// Sends the REVIEWED leads to AZZUR, on demand. ADMIN ONLY. Nothing is sent without an
// explicit request here — importing a file never triggers it.
//
//   POST { source, includeHistory?, category: "AUTO_ALM" | … | "PRINCIPAL" | "ALL",
//          exclude?: [categories already sent], offset?, limit?, confirm: true }
//
// The leads are RECOMPUTED here from the same rules as the review (the client never
// sends a list), in a fixed order, and the request handles one slice of them
// (`offset`, `limit` <= 100) so a large file fits the serverless time limit; the
// response says where to continue (`nextOffset`). Each lead carries its first call's id
// as num_devis_initial, so a lead sent twice is recognised by AZZUR as a duplicate.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { mapPool, pushCallToAzzur, readAzzurConfig } from "@/lib/azzur";
import { loadAzzurRoutes } from "@/lib/azzurRoutesStore";
import { CATEGORY_ORDER, type CategoryId } from "@/lib/azzurReview";
import { eventForLead, loadReview, parseSource } from "@/lib/azzurReviewData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SLICE = 100;

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const body = await readJson<{
      source?: unknown; includeHistory?: unknown; category?: unknown; exclude?: unknown; offset?: unknown; limit?: unknown; confirm?: unknown;
    }>(req);
    if (body.confirm !== true) throw badRequest("Envoi non confirmé");

    const source = parseSource(body.source);
    const includeHistory = body.includeHistory === true;
    const category = body.category;
    if (category !== "ALL" && !CATEGORY_ORDER.includes(category as CategoryId)) throw badRequest("Catégorie inconnue");
    // "ALL" skips the links already sent in this session, so a send-all after a per-link send
    // does not push those leads a second time.
    const exclude = Array.isArray(body.exclude) ? body.exclude.filter((c): c is CategoryId => CATEGORY_ORDER.includes(c as CategoryId)) : [];
    const offset = Math.max(0, Math.floor(Number(body.offset ?? 0)) || 0);
    const limit = Math.min(MAX_SLICE, Math.max(1, Math.floor(Number(body.limit ?? 50)) || 50));

    const config = readAzzurConfig();
    if (!config.ready) {
      throw badRequest(config.problem ?? "Intégration AZZUR désactivée : définissez AZZUR_WEBHOOK_ENABLED=true et AZZUR_MER_URL.");
    }

    const { review } = await loadReview(source, includeHistory);
    const wanted = category === "ALL"
      ? review.leads.filter((l) => !exclude.includes(l.category))
      : review.leads.filter((l) => l.category === category);
    const slice = wanted.slice(offset, offset + limit);

    const { routes } = await loadAzzurRoutes();
    const results = await mapPool(slice, 4, (lead) =>
      pushCallToAzzur(eventForLead(lead), { config, routes, ignoreMaxAge: true }).then((r) => ({ ...r, category: lead.category }))
    );

    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    const next = offset + slice.length;
    return NextResponse.json({
      category,
      total: wanted.length,
      offset,
      processed: slice.length,
      nextOffset: next < wanted.length ? next : null,
      sent: count("sent"),
      duplicates: count("duplicate"),
      failed: count("failed"),
      skipped: count("skipped"),
      results,
    });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/azzur/send");
  }
}
