// src/app/api/admin/proassur/ids/route.ts
//
// ProAssur, the CRM of the AUTO service (AZZUR / Santé is not concerned here). The administrator
// enters the identifiers the teams and advisers already have in ProAssur: ID_EQ per Auto team,
// ID_US per adviser; every adviser belongs to one Auto team and is sent with that team's ID_EQ
// ($id_us / $id_eq of the ProAssur links). ADMIN ONLY. Only Auto teams and their advisers are
// read or changed.
//
//   GET                                   -> Auto teams (ID_EQ, entity, advisers) and Auto advisers (ID_US)
//   POST { entity: "ALM"|"CPA", nom, idEq } -> creates an Auto team ("Équipe auto ALM <nom>")
//   PUT  { teamId, idEq }                 -> a team's ID_EQ (names are not changed here: the base
//                                            team names also route the standard lines at import)
//   PUT  { userId, idUs?, teamId? }       -> an adviser's ID_US and/or Auto team
//   PUT  { items: [ …same objects… ] }    -> several at once
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { entityOfTeamName, parseEntity, subTeamOfTeamName } from "@/lib/entity";
import { CRM_ID_RE, isMissingTable, loadCrmIds, missingTableMessage, saveCrmId } from "@/lib/azzurRoutesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isAuto = (nom: string | null | undefined) => subTeamOfTeamName(nom) === "AUTO";

function parseId(raw: unknown, label: string): string {
  const v = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : null;
  if (v === null || (v !== "" && !CRM_ID_RE.test(v))) {
    throw badRequest(`${label} : lettres, chiffres, espace, « _ », « . » ou « - », 40 caractères au plus.`);
  }
  return v;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isMissingTable(error)) throw new ApiError(503, missingTableMessage(error));
    throw error;
  }
}

/** "Équipe auto ALM" + an optional suffix: the name must keep "auto" and the entity, which route the calls. */
function teamName(entity: "ALM" | "CPA", suffix: string): string {
  const s = suffix.trim().replace(/\s+/g, " ").slice(0, 60);
  return s ? `Équipe auto ${entity} ${s}` : `Équipe auto ${entity}`;
}

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const [teams, ids] = await Promise.all([
      prisma.team.findMany({
        select: {
          id: true, nom: true,
          users: {
            where: { role: { in: ["CONSEILLER", "SUPERVISEUR"] }, isActive: true },
            select: { id: true, prenom: true, nom: true, role: true, phoneNumber: true },
            orderBy: [{ nom: "asc" }, { prenom: "asc" }],
          },
        },
        orderBy: { nom: "asc" },
      }),
      loadCrmIds(),
    ]);
    const auto = teams.filter((t) => isAuto(t.nom));
    return NextResponse.json({
      teams: auto.map((t) => ({ id: t.id, nom: t.nom, entity: entityOfTeamName(t.nom), idEq: ids.idEq[t.id] ?? "", advisers: t.users.length })),
      advisers: auto
        .flatMap((t) => t.users.map((u) => ({
          id: u.id, name: `${u.prenom} ${u.nom}`.trim(), role: u.role, line: u.phoneNumber,
          teamId: t.id, team: t.nom, idUs: ids.idUs[u.id] ?? "",
        })))
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/proassur/ids");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ entity?: unknown; nom?: unknown; idEq?: unknown }>(req);
    const entity = parseEntity(typeof body.entity === "string" ? body.entity : null);
    if (!entity) throw badRequest("Choisissez l'entité de l'équipe : ALM ou CPA.");
    const idEq = parseId(body.idEq, "ID_EQ");
    if (!idEq) throw badRequest("L'ID_EQ de l'équipe (son identifiant dans ProAssur) est obligatoire.");
    const nom = teamName(entity, typeof body.nom === "string" ? body.nom : "");
    if (await prisma.team.findFirst({ where: { nom } })) throw badRequest(`L'équipe « ${nom} » existe déjà.`);
    const team = await prisma.team.create({ data: { nom }, select: { id: true, nom: true } });
    await guarded(() => saveCrmId("eq", team.id, idEq, admin.userId));
    return NextResponse.json({ ok: true, team: { ...team, idEq } }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/proassur/ids");
  }
}

type Item = { userId?: unknown; idUs?: unknown; teamId?: unknown; idEq?: unknown };

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const body = await readJson<Item & { items?: unknown }>(req);
    const raw: Item[] = Array.isArray(body.items) ? (body.items as Item[]) : [body];
    if (!raw.length || raw.length > 500) throw badRequest("Rien à enregistrer");

    const teams = await prisma.team.findMany({ select: { id: true, nom: true } });
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const userIds = raw.map((it) => it.userId).filter((v): v is string => typeof v === "string" && !!v);
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, teamId: true, prenom: true, nom: true } });
    const userById = new Map(users.map((u) => [u.id, u]));

    // Validate everything before writing anything.
    const ops: Array<() => Promise<unknown>> = [];
    for (const it of raw) {
      if (typeof it.userId === "string" && it.userId) {
        const u = userById.get(it.userId);
        if (!u) throw badRequest("Conseiller introuvable");
        const target = typeof it.teamId === "string" && it.teamId ? teamById.get(it.teamId) : undefined;
        if (it.teamId !== undefined && (!target || !isAuto(target.nom))) throw badRequest("L'équipe choisie n'est pas une équipe Auto.");
        const current = u.teamId ? teamById.get(u.teamId) : undefined;
        if (!isAuto(target?.nom ?? current?.nom)) throw badRequest(`${u.prenom} ${u.nom} n'est pas dans une équipe Auto.`);
        if (it.idUs !== undefined) {
          const idUs = parseId(it.idUs, "ID_US");
          ops.push(() => saveCrmId("us", u.id, idUs, admin.userId));
        }
        if (target && target.id !== u.teamId) ops.push(() => prisma.user.update({ where: { id: u.id }, data: { teamId: target.id } }));
      } else if (typeof it.teamId === "string" && it.teamId) {
        const t = teamById.get(it.teamId);
        if (!t || !isAuto(t.nom)) throw badRequest("Équipe Auto introuvable");
        if (it.idEq !== undefined) {
          const idEq = parseId(it.idEq, "ID_EQ");
          ops.push(() => saveCrmId("eq", t.id, idEq, admin.userId));
        }
      } else {
        throw badRequest("Indiquez userId (+ idUs / teamId) ou teamId (+ idEq)");
      }
    }
    await guarded(async () => { for (const op of ops) await op(); });
    return NextResponse.json({ ok: true, saved: ops.length });
  } catch (error) {
    return handleApiError(error, "PUT /api/admin/proassur/ids");
  }
}
