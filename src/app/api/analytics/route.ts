// src/app/api/analytics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function buildDateFilter(searchParams: URLSearchParams) {
  const dateFrom = searchParams.get("dateFrom");
  const dateTo   = searchParams.get("dateTo");
  const period   = searchParams.get("period");
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (period) {
    const now = new Date();
    endDate = new Date(now);
    if (period === "today") {
      startDate = new Date(now); startDate.setHours(0,0,0,0);
    } else if (period === "week") {
      startDate = new Date(now); startDate.setDate(startDate.getDate() - 7);
    } else if (period === "month") {
      startDate = new Date(now); startDate.setDate(1); startDate.setHours(0,0,0,0);
    }
  } else {
    if (dateFrom) startDate = new Date(dateFrom);
    if (dateTo)   { endDate = new Date(dateTo); endDate.setHours(23,59,59,999); }
  }
  if (!startDate && !endDate) return undefined;
  const filter: any = {};
  if (startDate) filter.gte = startDate;
  if (endDate)   filter.lte = endDate;
  return filter;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  const { searchParams } = new URL(req.url);
  const dateFilter = buildDateFilter(searchParams);
  const startedAtWhere = dateFilter ? { startedAt: dateFilter } : {};

  if (user.role === "CONSEILLER") {
    const calls = await prisma.call.findMany({
      where: { assignedUserId: user.userId, ...startedAtWhere },
      include: { result: true },
    });
    const total       = calls.length;
    const manques     = calls.filter((c) => c.isMissed).length;
    const repondus    = calls.filter((c) => !c.isMissed).length;
    const devis       = calls.filter((c) => c.result?.resultat === "DEVIS_REALISE").length;
    const durations   = calls.filter((c) => c.durationSeconds > 0).map((c) => c.durationSeconds);
    const dureeMoyenne = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return NextResponse.json({ total, manques, repondus, devis, dureeMoyenne, tauxConversion: repondus > 0 ? Math.round((devis / repondus) * 100) : 0 });
  }

  if (user.role === "SUPERVISEUR") {
    const agents = await prisma.user.findMany({
      where: { teamId: user.teamId, role: "CONSEILLER" },
      include: { assignedCalls: { where: startedAtWhere, include: { result: true } } },
    });
    const leaderboard = agents.map((a) => {
      const total   = a.assignedCalls.length;
      const repondus = a.assignedCalls.filter((c) => !c.isMissed).length;
      const devis   = a.assignedCalls.filter((c) => c.result?.resultat === "DEVIS_REALISE").length;
      const manques = a.assignedCalls.filter((c) => c.isMissed).length;
      return { id: a.id, nom: a.nom, prenom: a.prenom, total, repondus, devis, manques, tauxConversion: repondus > 0 ? Math.round((devis / repondus) * 100) : 0 };
    }).sort((a, b) => b.tauxConversion - a.tauxConversion);
    return NextResponse.json({
      totalAppels:  leaderboard.reduce((s, a) => s + a.total,   0),
      totalDevis:   leaderboard.reduce((s, a) => s + a.devis,   0),
      totalManques: leaderboard.reduce((s, a) => s + a.manques, 0),
      leaderboard,
    });
  }

  // ADMIN
  const allUsers = await prisma.user.findMany({
    where: { role: "CONSEILLER" },
    include: { assignedCalls: { where: startedAtWhere, include: { result: true } }, team: true },
  });
  const leaderboard = allUsers.map((a) => {
    const total    = a.assignedCalls.length;
    const repondus = a.assignedCalls.filter((c) => !c.isMissed).length;
    const devis    = a.assignedCalls.filter((c) => c.result?.resultat === "DEVIS_REALISE").length;
    const manques  = a.assignedCalls.filter((c) => c.isMissed).length;
    return { id: a.id, nom: a.nom, prenom: a.prenom, team: a.team?.nom ?? "—", total, repondus, devis, manques, tauxConversion: repondus > 0 ? Math.round((devis / repondus) * 100) : 0 };
  }).sort((a, b) => b.tauxConversion - a.tauxConversion);
  return NextResponse.json({
    totalAppels:  leaderboard.reduce((s, a) => s + a.total,   0),
    totalDevis:   leaderboard.reduce((s, a) => s + a.devis,   0),
    totalManques: leaderboard.reduce((s, a) => s + a.manques, 0),
    totalAgents:  allUsers.length,
    leaderboard,
  });
}
