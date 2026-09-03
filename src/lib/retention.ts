// src/lib/retention.ts
//
// How far back into the history each role may look.
//
// This is a server-side boundary, not a default for a date picker: it is ANDed
// into the `where` of every call query, so a hand-written `?dateFrom=2020-01-01`
// cannot widen it. A conseiller working today's leads has no business reading
// last month's caller numbers, and a coach's review window is a working week.
//
//   CONSEILLER    startedAt >= today 00:00 − 3 days
//   SUPERVISEUR   startedAt >= today 00:00 − 5 days
//   ADMINISTRATEUR  unrestricted
//
// The floor is the START of the day N days back, not "now minus N×24h", so the
// window does not slide through the day and drop calls mid-shift.
import type { Prisma } from "@prisma/client";

/** Days of history each role keeps. `null` means unrestricted. */
const RETENTION_DAYS: Record<string, number | null> = {
  ADMINISTRATEUR: null,
  SUPERVISEUR: 5,
  CONSEILLER: 3,
};

/** Unknown roles get the tightest window rather than the widest. */
const DEFAULT_RETENTION_DAYS = 3;

/** Days of history visible to `role`, or `null` when unrestricted. */
export function retentionDaysFor(role: string | null | undefined): number | null {
  if (role && role in RETENTION_DAYS) return RETENTION_DAYS[role];
  return DEFAULT_RETENTION_DAYS;
}

/**
 * Earliest `startedAt` the role may see, or `null` when unrestricted.
 * Exported for the UI so date pickers can refuse to offer an empty range.
 */
export function retentionFloorFor(role: string | null | undefined): Date | null {
  const days = retentionDaysFor(role);
  if (days === null) return null;

  const floor = new Date();
  floor.setHours(0, 0, 0, 0);
  floor.setDate(floor.getDate() - days);
  return floor;
}

/**
 * The clause to AND into a call query. Returns an empty object for roles with
 * no limit so callers can push it unconditionally.
 */
export function retentionClause(role: string | null | undefined): Prisma.CallWhereInput {
  const floor = retentionFloorFor(role);
  return floor ? { startedAt: { gte: floor } } : {};
}
