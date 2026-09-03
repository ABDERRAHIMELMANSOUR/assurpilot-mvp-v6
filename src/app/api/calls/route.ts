// src/app/api/calls/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CALL_INCLUDE } from "@/lib/selects";
import { handleApiError, requireUser } from "@/lib/api";
import { callScopeFor, filterForCoach, filterForUser } from "@/lib/scope";
import { callFilterClauses } from "@/lib/callFilters";
import { retentionClause, retentionFloorFor } from "@/lib/retention";
import { buildPriorContactMap, groupCallsByCaller, wantsGrouping } from "@/lib/dedupe";
import { maskCallsFor } from "@/lib/mask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 500;

/**
 * How many rows grouping looks at before folding them into leads.
 *
 * Grouping has to see every attempt from a number, so it cannot run on a
 * 500-row page — a lead's third call would be on the page and its first two
 * off it, and the row would claim an attempt count of one. Scanning wider and
 * then trimming to `MAX_ROWS` groups keeps the counts honest for the window the
 * roles can actually reach (3-5 days for everyone but an admin).
 */
const GROUP_SCAN_ROWS = 4_000;

/** Ceiling on the unscoped "who called this number first" lookup. */
const PRIOR_SCAN_ROWS = 20_000;

/**
 * How far back the prior-contact lookup reaches when nothing else bounds it.
 *
 * A colleague who spoke to this number last quarter is history, not a
 * collision; 30 days is the window in which "someone is already working this
 * lead" is worth a badge, and it keeps the unscoped scan bounded for an admin
 * looking at the full archive.
 */
const PRIOR_CONTACT_DAYS = 30;

/**
 * Earliest call the prior-contact lookup considers.
 *
 * Deliberately never earlier than the viewer's own retention floor: the badge
 * discloses a colleague's name, and that disclosure stays inside the same
 * window the role is allowed to read. Roles with no floor get the 30 days.
 */
function priorContactFloor(role: string): Date {
  const floor = retentionFloorFor(role);
  if (floor) return floor;
  const fallback = new Date();
  fallback.setHours(0, 0, 0, 0);
  fallback.setDate(fallback.getDate() - PRIOR_CONTACT_DAYS);
  return fallback;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;

    const clauses: Prisma.CallWhereInput[] = [
      callScopeFor(user),
      // Role-based history floor. ANDed in last-word style: a hand-written
      // `?dateFrom=2020-01-01` narrows within the window, it cannot widen it.
      retentionClause(user.role),
    ];

    // Profile drill-down onto one person.
    const targetId = params.get("userId") ?? params.get("conseillerId");
    if (targetId) clauses.push(await filterForUser(user, targetId));

    // Narrow to a coach's roster: their own calls plus their conseillers'.
    // Distinct from `userId`, which is a single person.
    const coachId = params.get("coachId");
    if (coachId) clauses.push(await filterForCoach(user, coachId));

    // Date range, entity / line, team, phone line, statut.
    clauses.push(...callFilterClauses(params));

    // AND of the scope, the optional person filter and the optional date range —
    // combining them by assignment would let one clobber another's OR block.
    const where: Prisma.CallWhereInput = { AND: clauses };

    const grouped = wantsGrouping(params);

    // Count alongside the page so a truncated list can say so rather than
    // quietly disagreeing with the dashboard totals.
    const [total, calls] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.findMany({
        where,
        include: CALL_INCLUDE,
        orderBy: { startedAt: "desc" },
        take: grouped ? GROUP_SCAN_ROWS : MAX_ROWS,
      }),
    ]);

    let rows: typeof calls | ReturnType<typeof groupCallsByCaller<(typeof calls)[number]>> = calls;

    if (grouped) {
      // Who took each number FIRST, ignoring the viewer's scope. Without this
      // the warning never fires for the person who needs it: a conseiller sees
      // only their own calls, so a colleague's earlier attempt on the same
      // number is invisible to them — which is the collision the badge exists
      // to prevent.
      const priorContacts = buildPriorContactMap(
        await prisma.call.findMany({
          where: { startedAt: { gte: priorContactFloor(user.role) } },
          select: {
            callerNumber: true,
            startedAt: true,
            assignedUser: { select: { id: true, nom: true, prenom: true } },
          },
          orderBy: { startedAt: "asc" },
          take: PRIOR_SCAN_ROWS,
        })
      );
      rows = groupCallsByCaller(calls, priorContacts).slice(0, MAX_ROWS);
    }

    // The response stays a bare array for backwards compatibility; the totals
    // ride along in headers so callers can detect truncation.
    // Caller numbers are masked for every role except admin, at the source.
    return NextResponse.json(maskCallsFor(user.role, rows), {
      headers: {
        "X-Total-Count": String(total),
        "X-Returned-Count": String(rows.length),
        // In grouped mode "truncated" means calls were left out of the scan,
        // not that rows were dropped from the page.
        "X-Truncated": total > calls.length ? "true" : "false",
        "X-Grouped": grouped ? "true" : "false",
      },
    });
  } catch (error) {
    return handleApiError(error, "GET /api/calls");
  }
}
