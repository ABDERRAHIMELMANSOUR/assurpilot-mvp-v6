// src/app/api/admin/azzur/users/route.ts
//
// Which CRM user each adviser is. ADMIN ONLY.
//
// AZZUR's MER web service puts a fiche in an adviser's space through `id_user`, its OWN numeric
// user id — it does not match names. So each adviser whose calls go to an AZZUR link needs that
// number once. Supplier scripts (ProAssur…) receive the adviser's name instead ($conseiller), so
// nothing is needed for them. Names in Assurpilot are never changed here.
//
//   GET                                  -> advisers with their team, category, CRM link type, AZZUR id
//                                           and the id_user actually sent; the default id per space
//   PUT { userId, azzurId }              -> sets the AZZUR id_user (digits), or clears it with ""
//   PUT { assignments: [{ userId, azzurId }] }  -> the same for several advisers (import from AZZUR)
//   PUT { defaultFor: "SANTE_ALM", azzurId }    -> default id_user of a space, for advisers without one
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { routeKeyFor, resolveEndpoint, ROUTE_KEYS, ROUTE_LABEL, type RouteKey } from "@/lib/azzurRouting";
import { readAzzurConfig, resolveAzzurUserId } from "@/lib/azzur";
import {
  isMissingTable, loadAzzurDefaultUserIds, loadAzzurRoutes, loadAzzurUserMap, missingTableMessage,
  saveAzzurDefaultUserId, saveAzzurUserId,
} from "@/lib/azzurRoutesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const [users, { routes }, ids, defaults] = await Promise.all([
      prisma.user.findMany({
        // Coaches have lines too: calls that reach them are dispatched the same way.
        where: { role: { in: ["CONSEILLER", "SUPERVISEUR"] }, isActive: true },
        select: { id: true, prenom: true, nom: true, role: true, email: true, phoneNumber: true, team: { select: { nom: true } } },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      }),
      loadAzzurRoutes(),
      loadAzzurUserMap(),
      loadAzzurDefaultUserIds(),
    ]);
    // The same resolution as the send itself, so the page shows the id_user that will go out.
    const config = { ...readAzzurConfig(), userMapById: ids, defaultUserIds: defaults };
    return NextResponse.json({
      defaults: ROUTE_KEYS.map((key) => ({
        key,
        label: ROUTE_LABEL[key],
        linkKind: resolveEndpoint(key, routes).kind,
        azzurId: defaults[key] ?? "",
      })),
      envDefault: config.defaultUserId,
      advisers: users.map((u) => {
        const key = routeKeyFor(u.team?.nom ?? null, null);
        const ep = resolveEndpoint(key, routes);
        const sent = resolveAzzurUserId(
          { conseiller: { id: u.id, email: u.email, nom: u.nom, prenom: u.prenom }, teamName: u.team?.nom ?? null, lineLabel: null },
          config
        );
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
          // What a fiche of this adviser carries as id_user, and why ("conseiller", "defaut-espace"…).
          sentId: sent.id,
          sentSource: sent.source,
        };
      }),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/azzur/users");
  }
}

const ID_HINT = "L'identifiant AZZUR (id_user) est un nombre, par ex. 123 — vide pour l'effacer.";

function parseAzzurId(raw: unknown): string {
  const id = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : null;
  if (id === null || (id !== "" && !/^\d{1,9}$/.test(id))) throw badRequest(ID_HINT);
  return id;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isMissingTable(error)) throw new ApiError(503, missingTableMessage(error));
    throw error;
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ userId?: unknown; azzurId?: unknown; assignments?: unknown; defaultFor?: unknown }>(req);

    // Default id of one space.
    if (body.defaultFor !== undefined) {
      if (typeof body.defaultFor !== "string" || !(ROUTE_KEYS as readonly string[]).includes(body.defaultFor)) {
        throw badRequest(`defaultFor doit être l'un de : ${ROUTE_KEYS.join(", ")}`);
      }
      const azzurId = parseAzzurId(body.azzurId);
      await guarded(() => saveAzzurDefaultUserId(body.defaultFor as RouteKey, azzurId, admin.userId));
      return NextResponse.json({ ok: true, defaultFor: body.defaultFor, azzurId });
    }

    // Several advisers at once (import from AZZUR's user list).
    if (body.assignments !== undefined) {
      if (!Array.isArray(body.assignments) || body.assignments.length === 0 || body.assignments.length > 500) {
        throw badRequest("assignments : une liste de 1 à 500 { userId, azzurId }");
      }
      const items = body.assignments.map((a: unknown) => {
        const { userId, azzurId } = (a ?? {}) as { userId?: unknown; azzurId?: unknown };
        if (typeof userId !== "string" || !userId) throw badRequest("userId manquant dans assignments");
        return { userId, azzurId: parseAzzurId(azzurId) };
      });
      const known = new Set(
        (await prisma.user.findMany({ where: { id: { in: items.map((i) => i.userId) } }, select: { id: true } })).map((u) => u.id)
      );
      const missing = items.filter((i) => !known.has(i.userId));
      if (missing.length) throw badRequest(`${missing.length} conseiller(s) introuvable(s)`);
      await guarded(async () => {
        for (const i of items) await saveAzzurUserId(i.userId, i.azzurId, admin.userId);
      });
      return NextResponse.json({ ok: true, saved: items.length });
    }

    if (typeof body.userId !== "string" || !body.userId) throw badRequest("userId manquant");
    const azzurId = parseAzzurId(body.azzurId);
    const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!user) throw badRequest("Conseiller introuvable");
    await guarded(() => saveAzzurUserId(user.id, azzurId, admin.userId));
    return NextResponse.json({ ok: true, userId: user.id, azzurId });
  } catch (error) {
    return handleApiError(error, "PUT /api/admin/azzur/users");
  }
}
