// src/app/api/calls/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CALL_INCLUDE } from "@/lib/selects";
import { forbidden, handleApiError, notFound, requireUser, type SessionUser } from "@/lib/api";
import { buildDateRange } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 500;

/**
 * Everything a given user is allowed to see.
 *
 * A coach's workspace is deliberately wider than "calls currently assigned to
 * me": a call they transferred to a conseiller moves `assignedUserId` to that
 * conseiller, and must still show up for the coach (badged "Transféré à …").
 */
function scopeFor(user: SessionUser): Prisma.CallWhereInput {
  if (user.role === "ADMINISTRATEUR") return {};

  if (user.role === "SUPERVISEUR") {
    return {
      OR: [
        { assignedUserId: user.userId }, // calls that landed on the coach's own line
        { transferredById: user.userId }, // calls the coach handed off
        { assignedUser: { teamId: user.teamId } }, // their team's calls
      ],
    };
  }

  // A conseiller sees only what is assigned to them — including transfers in.
  return { assignedUserId: user.userId };
}

/**
 * Restricts the result set to one person, for the profile drill-downs.
 * Returns the extra `where` clause, after checking the caller may look.
 */
async function filterForUser(
  viewer: SessionUser,
  targetId: string
): Promise<Prisma.CallWhereInput> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, role: true, teamId: true, superviseurId: true },
  });
  if (!target) throw notFound("Utilisateur introuvable");

  if (viewer.role === "CONSEILLER" && target.id !== viewer.userId) {
    throw forbidden();
  }
  if (viewer.role === "SUPERVISEUR") {
    const isSelf = target.id === viewer.userId;
    const inTeam = target.teamId !== null && target.teamId === viewer.teamId;
    const isMine = target.superviseurId === viewer.userId;
    if (!isSelf && !inTeam && !isMine) throw forbidden();
  }

  // A coach's own drill-down includes what they transferred away, mirroring
  // how their workspace is scoped.
  return target.role === "SUPERVISEUR"
    ? { OR: [{ assignedUserId: target.id }, { transferredById: target.id }] }
    : { assignedUserId: target.id };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;
    const range = buildDateRange(params);

    const clauses: Prisma.CallWhereInput[] = [scopeFor(user)];

    // Profile drill-down. `conseillerId` / `coachId` are accepted as aliases so
    // callers can be explicit about who they are asking for.
    const targetId =
      params.get("userId") ?? params.get("conseillerId") ?? params.get("coachId");
    if (targetId) clauses.push(await filterForUser(user, targetId));

    if (range) clauses.push({ startedAt: range });

    // AND of the scope, the optional person filter and the optional date range —
    // combining them by assignment would let one clobber another's OR block.
    const where: Prisma.CallWhereInput = { AND: clauses };

    // Count alongside the page so a truncated list can say so rather than
    // quietly disagreeing with the dashboard totals.
    const [total, calls] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.findMany({
        where,
        include: CALL_INCLUDE,
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
