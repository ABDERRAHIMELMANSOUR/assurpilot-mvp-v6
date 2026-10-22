// src/app/api/admin/stats-lignes/route.ts
//
// Reconciliation of the CPA / ALM standard lines against the advisers who
// answered on them, with duplicate counts. ADMIN ONLY. The rules live in
// src/lib/lineStats.ts.
//
//   GET ?period=today|week|month  or  ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
//       &ligne=ALM|CPA        standard line the call entered on
//       &equipe=ALM|CPA       entity of the adviser who answered
//       &produit=tous|sante|auto   product of the line (alias: branche)
//       &view=gross|net       table rows: every call, or one per caller
//       &categorie=CPA>ALM    table only: restrict to one card
//
// Cost: three small lookups (teams, lines, users — a few hundred rows in all)
// plus ONE scalar-only scan of the calls in the period. The team metadata is
// joined in memory from those maps rather than by a per-row relation include,
// which is what keeps a month of calls cheap.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, requireRole } from "@/lib/api";
import { buildDateRange } from "@/lib/dates";
import { entityOfTeamName, parseEntity, parseSubTeam } from "@/lib/entity";
import {
  buildRows,
  computeLineStats,
  filterByEntities,
  isCategoryKey,
  productOf,
  sourceEntityOf,
  type StatCall,
} from "@/lib/lineStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Calls read for one report; beyond this the figures are flagged as partial. */
const MAX_SCAN = 50_000;
/** Rows sent for the detail table; the cards always use the full scan. */
const MAX_TABLE_ROWS = 500;

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const params = req.nextUrl.searchParams;

    // A report needs a period: an unbounded scan of the whole history is never
    // what "reconcile the lines" means. Default to today.
    if (!params.get("period") && !params.get("dateFrom") && !params.get("dateTo") &&
        !params.get("startDate") && !params.get("endDate")) {
      params.set("period", "today");
    }
    const range = buildDateRange(params);
    if (range?.gte && range?.lte && range.gte > range.lte) {
      throw badRequest("La date de début doit précéder la date de fin");
    }

    const ligneRaw = params.get("ligne");
    const equipeRaw = params.get("equipe");
    const ligne = parseEntity(ligneRaw);
    const equipe = parseEntity(equipeRaw);
    if (ligneRaw && !ligne) throw badRequest("Ligne source inconnue (ALM ou CPA)");
    if (equipeRaw && !equipe) throw badRequest("Équipe conseiller inconnue (ALM ou CPA)");

    // "tous" (or nothing) means every product; anything else must be Santé or Auto.
    const produitRaw = (params.get("produit") ?? params.get("branche") ?? "").trim();
    const produit = parseSubTeam(produitRaw);
    if (produitRaw && produitRaw.toLowerCase() !== "tous" && !produit) {
      throw badRequest("Produit inconnu (tous, sante ou auto)");
    }

    const view = params.get("view") === "net" ? "net" : "gross";
    const categorieRaw = params.get("categorie");
    if (categorieRaw && !isCategoryKey(categorieRaw)) throw badRequest("Catégorie inconnue");

    const [teams, lines, users, calls] = await Promise.all([
      prisma.team.findMany({ select: { id: true, nom: true } }),
      prisma.phoneLine.findMany({ select: { id: true, label: true, teamId: true } }),
      prisma.user.findMany({ select: { id: true, nom: true, prenom: true, teamId: true } }),
      prisma.call.findMany({
        where: { ...(range && { startedAt: range }) },
        select: {
          id: true,
          callerNumber: true,
          startedAt: true,
          durationSeconds: true,
          isMissed: true,
          phoneLineId: true,
          assignedUserId: true,
          teamId: true,
        },
        orderBy: { startedAt: "desc" },
        take: MAX_SCAN + 1,
      }),
    ]);

    const truncated = calls.length > MAX_SCAN;
    if (truncated) calls.pop();

    const teamName = new Map(teams.map((t) => [t.id, t.nom]));
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const userById = new Map(users.map((u) => [u.id, u]));

    type Meta = { ligne: string; conseiller: { nom: string; prenom: string } | null; equipeNom: string | null };
    const metaById = new Map<string, Meta>();

    const statCalls: StatCall[] = calls.map((c) => {
      const line = lineById.get(c.phoneLineId);
      const user = c.assignedUserId ? userById.get(c.assignedUserId) : undefined;
      const userTeam = user?.teamId ? teamName.get(user.teamId) ?? null : null;
      metaById.set(c.id, {
        ligne: line?.label ?? "—",
        conseiller: user ? { nom: user.nom, prenom: user.prenom } : null,
        equipeNom: userTeam,
      });
      return {
        id: c.id,
        // Raw, exactly as stored: this view is for calling clients back.
        callerNumber: c.callerNumber,
        startedAt: c.startedAt,
        durationSeconds: c.durationSeconds,
        isMissed: c.isMissed,
        sourceEntity: sourceEntityOf(
          line?.teamId ? teamName.get(line.teamId) : null,
          line?.label,
          c.teamId ? teamName.get(c.teamId) : null
        ),
        adviserEntity: entityOfTeamName(userTeam),
        hasAdviser: Boolean(user),
        product: productOf(
          line?.teamId ? teamName.get(line.teamId) : null,
          line?.label,
          c.teamId ? teamName.get(c.teamId) : null,
          userTeam
        ),
      };
    });

    // Filter first, then count, so cards and table describe the same calls.
    const scoped = filterByEntities(statCalls, ligne, equipe, produit);
    const { stats, classified } = computeLineStats(scoped);

    const tableSource = categorieRaw ? classified.filter((c) => c.categorie === categorieRaw) : classified;
    const allRows = buildRows(tableSource, view);
    const rows = allRows.slice(0, MAX_TABLE_ROWS).map((r) => {
      const meta = metaById.get(r.id)!;
      return {
        id: r.id,
        callerNumber: r.callerNumber,
        startedAt: r.startedAt.toISOString(),
        durationSeconds: r.durationSeconds,
        categorie: r.categorie,
        ligne: meta.ligne,
        sourceEntity: r.sourceEntity,
        conseiller: meta.conseiller,
        equipe: meta.equipeNom,
        adviserEntity: r.adviserEntity,
        attemptCount: r.attemptCount,
        firstAttemptAt: r.firstAttemptAt,
        lastAttemptAt: r.lastAttemptAt,
      };
    });

    return NextResponse.json({
      range: { from: range?.gte?.toISOString() ?? null, to: range?.lte?.toISOString() ?? null },
      filters: { ligne, equipe, produit, view, categorie: categorieRaw },
      scanned: calls.length,
      truncated,
      ...stats,
      rows,
      rowsTotal: allRows.length,
      rowsTruncated: allRows.length > rows.length,
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/stats-lignes");
  }
}
