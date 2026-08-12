// src/app/api/calls/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CALL_INCLUDE } from "@/lib/selects";
import { forbidden, handleApiError, notFound, requireUser, type SessionUser } from "@/lib/api";
import { coachScopeFor, isDirectReport } from "@/lib/scope";
import { callFilterClauses } from "@/lib/callFilters";
import { maskCallsFor } from "@/lib/mask";

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

  if (user.role === "SUPERVISEUR") return coachScopeFor(user);

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
    // Themselves, or a conseiller who reports to them — nobody else.
    const isSelf = target.id === viewer.userId;
    if (!isSelf && !isDirectReport(viewer.userId, target)) throw forbidden();
  }

  // A coach's own drill-down includes what they transferred away, mirroring
  // how their workspace is scoped.
  return target.role === "SUPERVISEUR"
    ? { OR: [{ assignedUserId: target.id }, { transferredById: target.id }] }
    : { assignedUserId: target.id };
}

/**
 * Narrows to everything under one coach — their own calls and those of the
 * conseillers reporting to them. Used by the entity workspace's coach filter.
 */
async function filterForCoach(
  viewer: SessionUser,
  coachId: string
): Promise<Prisma.CallWhereInput> {
  const coach = await prisma.user.findUnique({
    where: { id: coachId },
    select: { id: true, role: true },
  });
  if (!coach || coach.role !== "SUPERVISEUR") throw notFound("Coach introuvable");
  // Only an admin may pivot on an arbitrary coach; a coach may pivot on themselves.
  if (viewer.role !== "ADMINISTRATEUR" && viewer.userId !== coach.id) throw forbidden();

  return {
    OR: [
      { assignedUserId: coach.id },
      { transferredById: coach.id },
      { assignedUser: { superviseurId: coach.id, role: "CONSEILLER" } },
    ],
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;

    const clauses: Prisma.CallWhereInput[] = [scopeFor(user)];

    // Profile drill-down onto one person.
    const targetId = params.get("userId") ?? params.get("conseillerId");
    if (targetId) clauses.push(await filterForUser(user, targetId));

    // Narrow to a coach's roster: their own calls plus their conseillers'.
    // Distinct from `userId`, which is a single person.
    const coachId = params.get("coachId");
    if (coachId) clauses.push(await filterForCoach(user, coachId));

    // Date range, entity / sub-team, team, line, statut.
    clauses.push(...callFilterClauses(params));

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
    // Caller numbers are masked for every role except admin, at the source.
    return NextResponse.json(maskCallsFor(user.role, calls), {
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
