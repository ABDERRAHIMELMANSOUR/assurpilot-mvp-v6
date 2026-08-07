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

    // Count alongside the page so a truncated list can say so rather than
    // quietly disagreeing with the dashboard totals.
    const [total, calls] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.findMany({
        where,
        include: {
          phoneLine: true,
          team: { select: { id: true, nom: true } },
          assignedUser: { select: CALL_USER_SELECT },
          result: true,
        },
        orderBy: { startedAt: "desc" },
        take: MAX_ROWS,
      }),
    ]);

    // The response stays a bare array for backwards compatibility; the totals
    // ride along in headers so callers can detect truncation.
    return NextResponse.json(calls, {
      headers: {
        "X-Total-Count": String(total),
        "X-Returned-Count": String(calls.length),
        "X-Truncated": total > calls.length ? "true" : "false",
      },
    });
  } catch (error) {
    return handleApiError(error, "GET /api/calls");
  }
}
