// src/app/api/admin/proassur/ids/route.ts
//
// ProAssur identifiers — ProAssur is the CRM of the AUTO teams (AZZUR is only for Santé). The
// administrator enters, as they are in ProAssur, each adviser's ID_US and ID_EQ, and a default
// ID_EQ per Auto team for advisers without their own. They go out through the $id_us / $id_eq
// variables of the ProAssur links (AUTO_ALM, AUTO_CPA). ADMIN ONLY.
//
//   GET                         -> Auto teams (default ID_EQ) and their advisers (ID_US, ID_EQ);
//                                  ?all=1: every team and adviser
//   PUT { userId, idUs?, idEq? } -> an adviser's ID_US and/or ID_EQ ("" clears)
//   PUT { teamId, idEq }        -> a team's default ID_EQ ("" clears)
//   PUT { items: [ …same objects… ] }  -> several at once
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { subTeamOfTeamName } from "@/lib/entity";
import { CRM_ID_RE, isMissingTable, loadCrmIds, missingTableMessage, saveCrmId } from "@/lib/azzurRoutesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const all = req.nextUrl.searchParams.get("all") === "1";
    const [teams, users, ids] = await Promise.all([
      prisma.team.findMany({ select: { id: true, nom: true }, orderBy: { nom: "asc" } }),
      prisma.user.findMany({
        where: { role: { in: ["CONSEILLER", "SUPERVISEUR"] }, isActive: true },
        select: { id: true, prenom: true, nom: true, role: true, phoneNumber: true, teamId: true },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      }),
      loadCrmIds(),
    ]);
    const shownTeams = teams.filter((t) => all || subTeamOfTeamName(t.nom) === "AUTO");
    const teamIds = new Set(shownTeams.map((t) => t.id));
    const teamName = new Map(teams.map((t) => [t.id, t.nom]));
    return NextResponse.json({
      teams: shownTeams.map((t) => ({ id: t.id, nom: t.nom, idEq: ids.idEq[t.id] ?? "" })),
      advisers: users
        .filter((u) => all || (u.teamId && teamIds.has(u.teamId)))
        .map((u) => ({
          id: u.id, name: `${u.prenom} ${u.nom}`.trim(), role: u.role, line: u.phoneNumber,
          teamId: u.teamId, team: u.teamId ? teamName.get(u.teamId) ?? null : null,
          idUs: ids.idUs[u.id] ?? "",
          idEq: ids.idEqUser[u.id] ?? "",
          // What $id_eq becomes for this adviser: their own, else their team's.
          idEqSent: ids.idEqUser[u.id] ?? (u.teamId ? ids.idEq[u.teamId] : undefined) ?? "",
        })),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/proassur/ids");
  }
}

type Item = { userId?: unknown; idUs?: unknown; idEq?: unknown; teamId?: unknown };

function parseValue(raw: unknown, label: string): string {
  const v = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : null;
  if (v === null || (v !== "" && !CRM_ID_RE.test(v))) {
    throw badRequest(`${label} : lettres, chiffres, espace, « _ », « . » ou « - », 40 caractères au plus (vide pour effacer).`);
  }
  return v;
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const body = await readJson<Item & { items?: unknown }>(req);
    const raw: Item[] = Array.isArray(body.items) ? (body.items as Item[]) : [body];
    if (!raw.length || raw.length > 500) throw badRequest("Rien à enregistrer");

    const changes: Array<{ kind: "us" | "equ" | "eq"; id: string; value: string }> = [];
    for (const it of raw) {
      if (typeof it.userId === "string" && it.userId) {
        if (it.idUs === undefined && it.idEq === undefined) throw badRequest("Indiquez idUs et/ou idEq");
        if (it.idUs !== undefined) changes.push({ kind: "us", id: it.userId, value: parseValue(it.idUs, "ID_US") });
        if (it.idEq !== undefined) changes.push({ kind: "equ", id: it.userId, value: parseValue(it.idEq, "ID_EQ") });
      } else if (typeof it.teamId === "string" && it.teamId) {
        changes.push({ kind: "eq", id: it.teamId, value: parseValue(it.idEq, "ID_EQ") });
      } else {
        throw badRequest("Indiquez userId (+ idUs / idEq) ou teamId (+ idEq)");
      }
    }
    const [users, teams] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: changes.filter((c) => c.kind !== "eq").map((c) => c.id) } }, select: { id: true } }),
      prisma.team.findMany({ where: { id: { in: changes.filter((c) => c.kind === "eq").map((c) => c.id) } }, select: { id: true } }),
    ]);
    const known = new Set([...users.map((u) => u.id), ...teams.map((t) => t.id)]);
    if (changes.some((c) => !known.has(c.id))) throw badRequest("Conseiller ou équipe introuvable");

    try {
      for (const c of changes) await saveCrmId(c.kind, c.id, c.value, admin.userId);
    } catch (error) {
      if (isMissingTable(error)) throw new ApiError(503, missingTableMessage(error));
      throw error;
    }
    return NextResponse.json({ ok: true, saved: changes.length });
  } catch (error) {
    return handleApiError(error, "PUT /api/admin/proassur/ids");
  }
}
