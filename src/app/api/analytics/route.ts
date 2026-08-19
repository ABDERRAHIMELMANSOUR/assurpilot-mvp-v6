// src/app/api/analytics/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireUser } from "@/lib/api";
import { buildDateRange } from "@/lib/dates";
import { directReportsWhere } from "@/lib/scope";
import { parseEntity, parseSubTeam, userScopeWhere } from "@/lib/entity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVIS = "DEVIS_REALISE";

type CallWithResult = { isMissed: boolean; durationSeconds: number; result: { resultat: string } | null };

function tally(calls: CallWithResult[]) {
  const total = calls.length;
  const manques = calls.filter((c) => c.isMissed).length;
  const repondus = total - manques;
  const devis = calls.filter((c) => c.result?.resultat === DEVIS).length;
  return {
    total,
    manques,
    repondus,
    devis,
    tauxConversion: repondus > 0 ? Math.round((devis / repondus) * 100) : 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;
    const range = buildDateRange(params);
    const startedAtWhere: Prisma.CallWhereInput = range ? { startedAt: range } : {};

    // Entity (CPA/ALM) and line (Auto/Santé) narrow WHICH CONSEILLERS are
    // counted, via the team they belong to. Scoping the people rather than the
    // calls keeps the summary cards equal to the sum of the leaderboard rows
    // shown beneath them — the two are read together, so they must agree.
    // `lineType` is the UI's name for it; `subTeam` is accepted as an alias for
    // consistency with /api/calls.
    const entity = parseEntity(params.get("entity"));
    const subTeam = parseSubTeam(params.get("lineType") ?? params.get("subTeam"));
    const scopeWhere = userScopeWhere(entity, subTeam);

    if (user.role === "CONSEILLER") {
      const calls = await prisma.call.findMany({
        where: { assignedUserId: user.userId, ...startedAtWhere },
        select: {
          isMissed: true,
          durationSeconds: true,
          result: { select: { resultat: true } },
        },
      });

      const stats = tally(calls);
      const durations = calls.filter((c) => c.durationSeconds > 0).map((c) => c.durationSeconds);
      const dureeMoyenne = durations.length
        ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
        : 0;

      return NextResponse.json({ ...stats, dureeMoyenne });
    }

    const isSuperviseur = user.role === "SUPERVISEUR";
    const agents = await prisma.user.findMany({
      where: {
        AND: [
          // Coach metrics cover only their own conseillers.
          isSuperviseur ? directReportsWhere(user.userId) : { role: "CONSEILLER" },
          scopeWhere,
        ],
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        team: { select: { nom: true } },
        assignedCalls: {
          where: startedAtWhere,
          select: {
            isMissed: true,
            durationSeconds: true,
            result: { select: { resultat: true } },
          },
        },
      },
    });

    const leaderboard = agents
      .map((agent) => ({
        id: agent.id,
        nom: agent.nom,
        prenom: agent.prenom,
        team: agent.team?.nom ?? "—",
        ...tally(agent.assignedCalls),
      }))
      .sort((a, b) => b.tauxConversion - a.tauxConversion);

    const totals = {
      totalAppels: leaderboard.reduce((sum, a) => sum + a.total, 0),
      totalDevis: leaderboard.reduce((sum, a) => sum + a.devis, 0),
      totalManques: leaderboard.reduce((sum, a) => sum + a.manques, 0),
    };

    const applied = { entity, lineType: subTeam };

    return NextResponse.json(
      isSuperviseur
        ? { ...totals, leaderboard, applied }
        : { ...totals, totalAgents: agents.length, leaderboard, applied }
    );
  } catch (error) {
    return handleApiError(error, "GET /api/analytics");
  }
}
