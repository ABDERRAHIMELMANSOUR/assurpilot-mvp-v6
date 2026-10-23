// src/app/api/admin/azzur/send/route.ts
//
// Sends the REVIEWED leads to AZZUR, on demand. ADMIN ONLY. Nothing is sent without an
// explicit request here — importing a file never triggers it.
//
//   POST { source, includeHistory?, category: "AUTO_ALM" | … | "PRINCIPAL" | "ALL",
//          exclude?: [categories already sent], offset?, limit?, confirm: true }
//
// Only categories whose link is configured can be sent: asking for one that is not is
// refused, and "ALL" leaves the others out (their calls stay in the local database).
//
// The leads are RECOMPUTED here from the same rules as the review (the client never
// sends a list), in a fixed order, and the request handles one slice of them
// (`offset`, `limit` <= 100) so a large file fits the serverless time limit; the
// response says where to continue (`nextOffset`). Each lead carries its first call's id
// as num_devis_initial, so a lead sent twice is recognised by AZZUR as a duplicate.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { mapPool, pushCallToAzzur } from "@/lib/azzur";
import { loadAzzurRoutes, loadEffectiveConfig } from "@/lib/azzurRoutesStore";
import { CATEGORY_ORDER, CATEGORY_LABEL, type CategoryId } from "@/lib/azzurReview";
import { ROUTE_KEYS, resolveEndpoint, type RouteKey } from "@/lib/azzurRouting";
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

    const { config } = await loadEffectiveConfig();
    if (!config.ready) {
      throw badRequest(config.problem ?? "L'envoi AZZUR est désactivé : activez l'interrupteur « Envoi AZZUR » en haut de cette page.");
    }

    // Which categories have a link. Everything else is never sent.
    const { routes } = await loadAzzurRoutes();
    const configured = (id: CategoryId) =>
      (ROUTE_KEYS as readonly string[]).includes(id) && resolveEndpoint(id as RouteKey, routes).url !== null;
    if (category !== "ALL" && !configured(category as CategoryId)) {
      throw badRequest(`Le lien ${CATEGORY_LABEL[category as CategoryId]} n'est pas configuré : ces appels restent en local. Configurez-le d'abord.`);
    }

    const { review } = await loadReview(source, includeHistory);
    const wanted = category === "ALL"
      ? review.leads.filter((l) => !exclude.includes(l.category) && configured(l.category))
      : review.leads.filter((l) => l.category === category);
    const slice = wanted.slice(offset, offset + limit);
    const keptLocal = category === "ALL" ? review.leads.filter((l) => !configured(l.category)).length : 0;
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
      // Leads left out because their link is not configured (they stay in the database).
      keptLocal,
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
