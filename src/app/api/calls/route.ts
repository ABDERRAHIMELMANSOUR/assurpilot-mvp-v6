// src/app/api/calls/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CALL_USER_SELECT } from "@/lib/selects";
import { handleApiError, requireUser } from "@/lib/api";
import { buildDateRange } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 500;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const range = buildDateRange(new URL(req.url).searchParams);

    // Role-based scope — an admin sees every call.
    const where: Prisma.CallWhereInput = {};
    if (user.role === "CONSEILLER") {
      where.assignedUserId = user.userId;
    } else if (user.role === "SUPERVISEUR") {
      where.assignedUser = { teamId: user.teamId };
    }
    if (range) where.startedAt = range;

    const calls = await prisma.call.findMany({
      where,
      include: {
        phoneLine: true,
        assignedUser: { select: CALL_USER_SELECT },
        result: true,
      },
      orderBy: { startedAt: "desc" },
      take: MAX_ROWS,
    });

    return NextResponse.json(calls);
  } catch (error) {
    return handleApiError(error, "GET /api/calls");
  }
}
