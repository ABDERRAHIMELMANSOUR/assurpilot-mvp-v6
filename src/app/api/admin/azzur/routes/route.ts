// src/app/api/admin/azzur/routes/route.ts
//
// The four AZZUR links (AUTO ALM, SANTÉ ALM, AUTO CPA, SANTÉ CPA). ADMIN ONLY.
//
//   GET  -> for each link: whether it is set, where it points (host, path, id_prov —
//           NEVER the secret key) and whether the table exists
//   PUT  { key, value }  -> sets it; value is a full MER URL, a bare id_prov, or ""
//           to clear it (the main link is then used)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ApiError, badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { readAzzurConfig } from "@/lib/azzur";
import { describeUrl, isRouteKey, parseRouteValue, resolveEndpoint, ROUTE_KEYS, ROUTE_LABEL } from "@/lib/azzurRouting";
import { isMissingTable, loadAzzurRoutes, saveAzzurRoute } from "@/lib/azzurRoutesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIGRATION_HINT = "Exécutez prisma/sql/009-azzur-routes.sql dans Supabase pour pouvoir enregistrer les liens.";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const config = readAzzurConfig();
    const { routes, tableAvailable, origin } = await loadAzzurRoutes();

    return NextResponse.json({
      tableAvailable,
      migrationHint: tableAvailable ? null : MIGRATION_HINT,
      main: config.url ? describeUrl(config.url) : null,
      routes: ROUTE_KEYS.map((key) => {
        const ep = config.url ? resolveEndpoint(key, routes, config.url) : null;
        return {
          key,
          label: ROUTE_LABEL[key],
          configured: ep?.source === "dedicated",
          origin: origin[key] ?? null,
          // Where calls for this team and product actually go.
          target: ep ? describeUrl(ep.url) : null,
          why: ep?.why ?? null,
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

    const parsed = parseRouteValue(body.value, readAzzurConfig().url);
    if (!parsed.ok) throw badRequest(parsed.error);

    try {
      await saveAzzurRoute(body.key, parsed.value, user.userId);
    } catch (error) {
      if (isMissingTable(error)) throw new ApiError(503, MIGRATION_HINT);
      throw error;
    }
    return NextResponse.json({ ok: true, key: body.key, cleared: parsed.value === "" });
  } catch (error) {
    return handleApiError(error, "PUT /api/admin/azzur/routes");
  }
}
