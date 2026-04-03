// src/app/api/calls/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  const { searchParams } = new URL(req.url);

  // Date filters
  const dateFrom = searchParams.get("dateFrom"); // ISO string
  const dateTo   = searchParams.get("dateTo");   // ISO string
  const period   = searchParams.get("period");   // today | week | month

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (period) {
    const now = new Date();
    endDate = new Date(now);
    if (period === "today") {
      startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (period === "week") {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === "month") {
      startDate = new Date(now);
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
    }
  } else {
    if (dateFrom) startDate = new Date(dateFrom);
    if (dateTo)   { endDate = new Date(dateTo); endDate.setHours(23, 59, 59, 999); }
  }

  // Role-based scope
  let where: any = {};
  if (user.role === "CONSEILLER") {
    where.assignedUserId = user.userId;
  } else if (user.role === "SUPERVISEUR") {
    where.assignedUser = { teamId: user.teamId };
  }
  // ADMIN: no scope filter

  // Apply date range
  if (startDate || endDate) {
    where.startedAt = {};
    if (startDate) where.startedAt.gte = startDate;
    if (endDate)   where.startedAt.lte = endDate;
  }

  const calls = await prisma.call.findMany({
    where,
    include: {
      phoneLine:    true,
      assignedUser: { select: { id: true, nom: true, prenom: true } },
      result:       true,
    },
    orderBy: { startedAt: "desc" },
    take: 500,
  });

  // No masking — everyone sees callerNumber directly
  return NextResponse.json(calls);
}
