// src/lib/scope.ts
//
// One definition of "the conseillers a coach manages", shared by every endpoint
// so they cannot drift apart.
//
// A Team is a bucket several coaches can share (Pôle Auto holds everyone in
// auto, whichever coach they report to), so scoping a coach by `teamId` leaked
// every conseiller in that bucket — including other coaches' people. Direct
// assignment lives on `User.superviseurId`, and that is the only thing that
// defines a coach's roster.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { forbidden, notFound, type SessionUser } from "@/lib/api";

/** Conseillers reporting directly to this coach. */
export function directReportsWhere(coachUserId: string): Prisma.UserWhereInput {
  return { role: "CONSEILLER", superviseurId: coachUserId };
}

/** True when `target` reports directly to `coachUserId`. */
export function isDirectReport(
  coachUserId: string,
  target: { role: string; superviseurId: string | null }
): boolean {
  return target.role === "CONSEILLER" && target.superviseurId === coachUserId;
}

/**
 * Every call a coach may see:
 *   - calls sitting on their own line,
 *   - calls they transferred to one of their conseillers,
 *   - calls belonging to a conseiller who reports to them.
 */
export function coachCallScope(coachUserId: string): Prisma.CallWhereInput {
  return {
    OR: [
      { assignedUserId: coachUserId },
      { transferredById: coachUserId },
      { assignedUser: { superviseurId: coachUserId, role: "CONSEILLER" } },
    ],
  };
}

/** Convenience wrapper for a session user known to be a coach. */
export function coachScopeFor(user: SessionUser): Prisma.CallWhereInput {
  return coachCallScope(user.userId);
}

/**
 * Everything a given user is allowed to see.
 *
 * A coach's workspace is deliberately wider than "calls currently assigned to
 * me": a call they transferred to a conseiller moves `assignedUserId` to that
 * conseiller, and must still show up for the coach (badged "Transféré à …").
 */
export function callScopeFor(user: SessionUser): Prisma.CallWhereInput {
  if (user.role === "ADMINISTRATEUR") return {};
  if (user.role === "SUPERVISEUR") return coachScopeFor(user);
  // A conseiller sees only what is assigned to them — including transfers in.
  return { assignedUserId: user.userId };
}

/**
 * Restricts the result set to one person, for the profile drill-downs.
 * Returns the extra `where` clause, after checking the caller may look.
 */
export async function filterForUser(
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
export async function filterForCoach(
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

  return coachCallScope(coach.id);
}
