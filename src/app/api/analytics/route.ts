// src/app/api/analytics/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireUser } from "@/lib/api";
import { buildDateRange } from "@/lib/dates";
import { directReportsWhere } from "@/lib/scope";
import {
  entityOfTeamName,
  parseEntity,
  parseSubTeam,
  subTeamOfTeamName,
  userScopeWhere,
} from "@/lib/entity";
import { isContractResult } from "@/lib/contracts";
import { retentionClause } from "@/lib/retention";
import { countUniqueCallers } from "@/lib/dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVIS = "DEVIS_REALISE";

type CallWithResult = {
  callerNumber: string;
  isMissed: boolean;
  durationSeconds: number;
  result: { resultat: string } | null;
};

/** The projection every tally needs; kept here so the two queries can't drift. */
const TALLY_SELECT = {
  callerNumber: true,
  isMissed: true,
  durationSeconds: true,
  result: { select: { resultat: true } },
} as const;

function tally(calls: CallWithResult[]) {
  const total = calls.length;
  const manques = calls.filter((c) => c.isMissed).length;
  const repondus = total - manques;
  const devis = calls.filter((c) => c.result?.resultat === DEVIS).length;
  // Signed contracts are the commercial outcome the ranking is built on; devis
  // stays alongside it because the conversion rate is still read from it.
  const contrats = calls.filter((c) => isContractResult(c.result?.resultat)).length;

  // Distinct prospects behind those calls, and the repeat attempts they hide.
  // One prospect ringing three times is one lead and two doublons, not three
  // leads — counting rows overstated reach by exactly the repeat volume.
  const prospects = countUniqueCallers(calls);

  return {
    total,
    prospects,
    doublons: total - prospects,
    manques,
    repondus,
    devis,
    contrats,
    tauxConversion: repondus > 0 ? Math.round((devis / repondus) * 100) : 0,
    // Share of answered calls that ended in a signature.
    tauxContrat: repondus > 0 ? Math.round((contrats / repondus) * 100) : 0,
  };
}

type LeaderboardRow = ReturnType<typeof tally> & { nom: string; prenom: string };

/**
 * How the leaderboard is ordered. Contracts signed is the default — that is the
 * number the business is judged on — with quotes and conversion rate as
 * tie-breakers so two agents on zero contracts still rank sensibly.
 * `?sort=conversion` restores the previous ordering for anything that relied
 * on it.
 */
function rank<T extends LeaderboardRow>(rows: T[], sort: string | null): T[] {
  if (sort === "conversion") {
    return [...rows].sort((a, b) => b.tauxConversion - a.tauxConversion);
  }
  return [...rows].sort(
    (a, b) =>
      b.contrats - a.contrats ||
      b.devis - a.devis ||
      b.tauxConversion - a.tauxConversion ||
      `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, "fr")
  );
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;
    const range = buildDateRange(params);
    // The role's history floor applies to the figures exactly as it applies to
    // the lists: a coach's dashboard must not total up calls their call log
    // will not show them.
    const startedAtWhere: Prisma.CallWhereInput = {
      AND: [range ? { startedAt: range } : {}, retentionClause(user.role)],
    };

    // Entity (CPA/ALM) and line (Auto/Santé) narrow WHICH CONSEILLERS are
    // counted, via the team they belong to. Scoping the people rather than the
    // calls keeps the summary cards equal to the sum of the leaderboard rows
    // shown beneath them — the two are read together, so they must agree.
    // `lineType` is the UI's name for it; `subTeam` is accepted as an alias for
    // consistency with /api/calls.
    const entity = parseEntity(params.get("entity"));
    const subTeam = parseSubTeam(params.get("lineType") ?? params.get("subTeam"));
    const scopeWhere = userScopeWhere(entity, subTeam);

    // Narrow to one coach's roster. Same idea as the entity filter: it selects
    // PEOPLE, so the cards stay equal to the sum of the rows beneath them.
    //
    // A coach viewing their own dashboard is already limited to their direct
    // reports, so the parameter is theirs to use only on themselves; an admin
    // may pivot on anyone. Anything else is ignored rather than refused — a
    // stale coach id in a bookmarked URL should not break the dashboard.
    const requestedCoachId = params.get("coachId") ?? "";
    const isSuperviseur = user.role === "SUPERVISEUR";
    const coachWhere: Prisma.UserWhereInput =
      requestedCoachId && (!isSuperviseur || requestedCoachId === user.userId)
        ? { superviseurId: requestedCoachId }
        : {};

    if (user.role === "CONSEILLER") {
      const calls = await prisma.call.findMany({
        where: { assignedUserId: user.userId, ...startedAtWhere },
        select: TALLY_SELECT,
      });

      const stats = tally(calls);
      const durations = calls.filter((c) => c.durationSeconds > 0).map((c) => c.durationSeconds);
      const dureeMoyenne = durations.length
        ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
        : 0;

      return NextResponse.json({ ...stats, dureeMoyenne });
    }

    const agents = await prisma.user.findMany({
      where: {
        AND: [
          // Coach metrics cover only their own conseillers.
          isSuperviseur ? directReportsWhere(user.userId) : { role: "CONSEILLER" },
          scopeWhere,
          coachWhere,
        ],
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        team: { select: { nom: true } },
        assignedCalls: {
          where: startedAtWhere,
          select: TALLY_SELECT,
        },
      },
    });

    const leaderboard = rank(
      agents.map((agent) => ({
        id: agent.id,
        nom: agent.nom,
        prenom: agent.prenom,
        team: agent.team?.nom ?? "—",
        ...tally(agent.assignedCalls),
      })),
      params.get("sort")
    );

    const totalAppels = leaderboard.reduce((sum, a) => sum + a.total, 0);

    // Distinct prospects across the WHOLE filtered set, not the sum of each
    // agent's uniques: one prospect who rang two different advisers is one
    // prospect, and summing the rows would count them twice. This is why the
    // two headline cards cannot be derived from the leaderboard the way the
    // other totals are.
    const totalProspects = countUniqueCallers(agents.flatMap((a) => a.assignedCalls));

    const totals = {
      totalAppels,
      totalProspects,
      // Repeat attempts: 371 calls from 300 numbers = 71 doublons.
      totalDoublons: totalAppels - totalProspects,
      totalDevis: leaderboard.reduce((sum, a) => sum + a.devis, 0),
      totalContrats: leaderboard.reduce((sum, a) => sum + a.contrats, 0),
      totalManques: leaderboard.reduce((sum, a) => sum + a.manques, 0),
    };

    const applied = {
      entity,
      lineType: subTeam,
      // Echoes the coach actually applied, which is "" when the id was ignored.
      coachId: "superviseurId" in coachWhere ? requestedCoachId : "",
      sort: params.get("sort") === "conversion" ? "conversion" : "contrats",
    };

    // Per-team breakdown for the dashboard's statistics section. Built from the
    // same `agents` set, so it answers to the same date / entity / pôle filters
    // and its rows add up to the cards above it.
    //
    // `tally` runs over each team's calls POOLED, not over the sum of its
    // members' figures: prospects are distinct numbers, and a prospect who rang
    // two advisers of the same team is one prospect for that team.
    const byTeam = new Map<string, typeof agents>();
    for (const agent of agents) {
      const name = agent.team?.nom ?? "—";
      const bucket = byTeam.get(name);
      if (bucket) bucket.push(agent);
      else byTeam.set(name, [agent]);
    }

    const teams = [...byTeam.entries()]
      .map(([nom, members]) => ({
        team: nom,
        entity: entityOfTeamName(nom),
        subTeam: subTeamOfTeamName(nom),
        agents: members.length,
        ...tally(members.flatMap((m) => m.assignedCalls)),
      }))
      .sort((a, b) => b.contrats - a.contrats || b.total - a.total || a.team.localeCompare(b.team, "fr"));

    return NextResponse.json(
      isSuperviseur
        ? { ...totals, leaderboard, teams, applied }
        : { ...totals, totalAgents: agents.length, leaderboard, teams, applied }
    );
  } catch (error) {
    return handleApiError(error, "GET /api/analytics");
  }
}
