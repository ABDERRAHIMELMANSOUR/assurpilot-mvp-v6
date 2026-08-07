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
import type { SessionUser } from "@/lib/api";

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
