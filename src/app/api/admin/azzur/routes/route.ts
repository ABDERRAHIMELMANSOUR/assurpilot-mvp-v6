// src/app/api/admin/azzur/routes/route.ts
//
// The four AZZUR links (AUTO ALM, SANTÉ ALM, AUTO CPA, SANTÉ CPA). ADMIN ONLY.
//
//   GET  -> for each link: whether it is configured, where it points (host, path, id_prov —
//           NEVER the secret key) and whether the table exists
//   PUT  { key, value }  -> sets it; value is a full MER URL, or "" to clear it. A link that
//           is not configured has no destination: nothing is sent for that category.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ApiError, badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { allowedHosts, describeEndpoint, isRouteKey, parseRouteValue, resolveEndpoint, ROUTE_KEYS, ROUTE_LABEL } from "@/lib/azzurRouting";
import { isMissingTable, missingTableMessage, loadAzzurRoutes, MIGRATION_HINT, saveAzzurRoute } from "@/lib/azzurRoutesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const { routes, tableAvailable, origin } = await loadAzzurRoutes();

    return NextResponse.json({
      tableAvailable,
      migrationHint: tableAvailable ? null : MIGRATION_HINT,
      allowedHosts: allowedHosts(),
      routes: ROUTE_KEYS.map((key) => {
        const ep = resolveEndpoint(key, routes);
        return {
          key,
          label: ROUTE_LABEL[key],
          configured: ep.url !== null,
          origin: origin[key] ?? null,
          // Where calls for this team and product go; null = nowhere, they stay local.
          target: describeEndpoint(ep),
          kind: ep.kind,
          why: ep.why,
        };
      }),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/azzur/routes");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ key?: string; value?: string }>(req);
    if (!isRouteKey(body.key)) throw badRequest("Lien inconnu (AUTO_ALM, SANTE_ALM, AUTO_CPA ou SANTE_CPA)");
    if (typeof body.value !== "string") throw badRequest("value doit être un texte (vide pour effacer)");

    const parsed = parseRouteValue(body.value, allowedHosts());
    if (!parsed.ok) throw badRequest(parsed.error);

    try {
      await saveAzzurRoute(body.key, parsed.value, user.userId);
    } catch (error) {
      if (isMissingTable(error)) throw new ApiError(503, missingTableMessage(error));
      throw error;
    }
    return NextResponse.json({ ok: true, key: body.key, cleared: parsed.value === "" });
  } catch (error) {
    return handleApiError(error, "PUT /api/admin/azzur/routes");
  }
}
