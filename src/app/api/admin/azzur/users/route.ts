// src/app/api/admin/azzur/users/route.ts
//
// Which CRM user each adviser is. ADMIN ONLY.
//
// AZZUR's MER web service puts a fiche in an adviser's space through `id_user`, its OWN numeric
// user id — it does not match names. So each adviser whose calls go to an AZZUR link needs that
// number once. Supplier scripts (ProAssur…) receive the adviser's name instead ($conseiller), so
// nothing is needed for them. Names in Assurpilot are never changed here.
//
//   GET                         -> advisers with their team, category, CRM link type and AZZUR id
//   PUT { userId, azzurId }     -> sets the AZZUR id_user (digits), or clears it with ""
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { routeKeyFor, resolveEndpoint, ROUTE_LABEL } from "@/lib/azzurRouting";
import {
  isMissingTable, loadAzzurRoutes, loadAzzurUserMap, missingTableMessage, saveAzzurUserId,
} from "@/lib/azzurRoutesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const [users, { routes }, ids] = await Promise.all([
      prisma.user.findMany({
        // Coaches have lines too: calls that reach them are dispatched the same way.
        where: { role: { in: ["CONSEILLER", "SUPERVISEUR"] }, isActive: true },
        select: { id: true, prenom: true, nom: true, role: true, phoneNumber: true, team: { select: { nom: true } } },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      }),
      loadAzzurRoutes(),
      loadAzzurUserMap(),
    ]);
    return NextResponse.json({
      advisers: users.map((u) => {
        const key = routeKeyFor(u.team?.nom ?? null, null);
        const ep = resolveEndpoint(key, routes);
        return {
          id: u.id,
          name: `${u.prenom} ${u.nom}`.trim(),
          role: u.role,
          line: u.phoneNumber,
          team: u.team?.nom ?? null,
          category: key ? ROUTE_LABEL[key] : null,
          // "mer": AZZUR (needs id_user) · "template": supplier script (name sent as is) · null: no link yet
          linkKind: ep.kind,
          azzurId: ids[u.id] ?? "",
        };
      }),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/azzur/users");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ userId?: unknown; azzurId?: unknown }>(req);
    if (typeof body.userId !== "string" || !body.userId) throw badRequest("userId manquant");
    const azzurId = typeof body.azzurId === "string" ? body.azzurId.trim() : typeof body.azzurId === "number" ? String(body.azzurId) : null;
    if (azzurId === null || (azzurId !== "" && !/^\d{1,9}$/.test(azzurId))) {
      throw badRequest("L'identifiant AZZUR (id_user) est un nombre, par ex. 123 — vide pour l'effacer.");
    }
    const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!user) throw badRequest("Conseiller introuvable");
    try {
      await saveAzzurUserId(user.id, azzurId, admin.userId);
    } catch (error) {
      if (isMissingTable(error)) throw new ApiError(503, missingTableMessage(error));
      throw error;
    }
    return NextResponse.json({ ok: true, userId: user.id, azzurId });
  } catch (error) {
    return handleApiError(error, "PUT /api/admin/azzur/users");
  }
}
