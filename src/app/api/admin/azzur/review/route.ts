// src/app/api/admin/azzur/review/route.ts
//
// The pre-send review. Sends NOTHING: it only reports, for the chosen calls, how many
// leads would go to each AZZUR link, which repeats are ignored, and who owns each lead.
// ADMIN ONLY.
//
//   POST { source: "today" | "batch:<id>", includeHistory?: boolean }
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { buildAzzurPayload, readAzzurConfig } from "@/lib/azzur";
import { loadAzzurRoutes } from "@/lib/azzurRoutesStore";
import { describeUrl, resolveEndpoint, type RouteKey } from "@/lib/azzurRouting";
import { eventForLead, loadReview, parseSource } from "@/lib/azzurReviewData";
import { ROUTE_KEYS } from "@/lib/azzurRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lead rows returned for the detail view; the counts always cover every lead. */
const MAX_DETAIL_ROWS = 500;

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ source?: unknown; includeHistory?: unknown }>(req);
    const source = parseSource(body.source);
    const includeHistory = body.includeHistory === true;

    const config = readAzzurConfig();
    if (!config.url) throw badRequest(config.problem ?? "AZZUR_MER_URL n'est pas défini");

    const { review, selection, historyDays, truncated } = await loadReview(source, includeHistory);
    const { routes } = await loadAzzurRoutes();

    const categories = review.categories.map((cat) => {
      const key = (ROUTE_KEYS as readonly string[]).includes(cat.id) ? (cat.id as RouteKey) : null;
      const ep = resolveEndpoint(key, routes, config.url!);
      const first = review.leads.find((l) => l.category === cat.id);
      return {
        ...cat,
        target: describeUrl(ep.url),
        dedicated: ep.source === "dedicated",
        // The exact parameters of this category's first lead, so the admin can see what goes out.
        sample: first ? buildAzzurPayload(eventForLead(first), config) : null,
      };
    });

    return NextResponse.json({
      ready: config.ready,
      problem: config.problem,
      selection,
      includeHistory,
      historyDays,
      truncated,
      totals: review.totals,
      noNumber: review.noNumber,
      categories,
      leads: review.leads.slice(0, MAX_DETAIL_ROWS).map((l) => ({
        number: l.number,
        category: l.category,
        conseiller: l.owner.conseiller ? `${l.owner.conseiller.prenom} ${l.owner.conseiller.nom}`.trim() : null,
        team: l.owner.teamName,
        firstAt: l.owner.startedAt.toISOString(),
        calls: l.calls,
        duplicates: l.duplicates,
        fromHistory: l.fromHistory,
      })),
      leadsTruncated: review.leads.length > MAX_DETAIL_ROWS,
    });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/azzur/review");
  }
}
