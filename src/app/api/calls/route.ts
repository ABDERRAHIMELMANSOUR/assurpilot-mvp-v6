// src/app/api/calls/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CALL_INCLUDE } from "@/lib/selects";
import { handleApiError, requireUser } from "@/lib/api";
import { callScopeFor, filterForCoach, filterForUser } from "@/lib/scope";
import { callFilterClauses } from "@/lib/callFilters";
import { retentionClause } from "@/lib/retention";
import {
  attachPriorContact,
  buildPriorContactMap,
  groupCallsByCaller,
  wantsGrouping,
} from "@/lib/dedupe";
import { normalizePhone } from "@/lib/phone";
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

/** Ceiling on the prior-contact lookup, so one page cannot scan the archive. */
const PRIOR_SCAN_ROWS = 20_000;

/**
 * Who first took each of the numbers on this page, across the WHOLE history.
 *
 * Three deliberate properties:
 *
 * - It ignores the viewer's scope. A conseiller sees only their own calls, so
 *   a colleague's earlier attempt on the same number is invisible to them —
 *   which is precisely the collision the "Déjà contacté par" badge exists to
 *   prevent.
 * - It ignores the viewer's retention floor. The badge names a colleague
 *   against a number already on screen; it discloses no call the role may not
 *   read, and a lead someone picked up five weeks ago is exactly the case an
 *   adviser needs warning about.
 * - It is keyed on the numbers actually displayed rather than on a date
 *   window. Scanning a window and capping it would have silently dropped the
 *   numbers whose history sits outside the cap; asking only about the numbers
 *   in hand is both narrower and complete.
 *
 * Matching is on the last nine digits, which every French format shares
 * ("0612345678", "+33612345678", "33612345678", "0033612345678"). That can
 * over-fetch a foreign number ending the same way; `buildPriorContactMap`
 * re-normalises, so an over-fetched row simply keys elsewhere and is ignored.
 */
async function lookupPriorContacts(calls: Array<{ callerNumber: string }>) {
  const significant = new Set<string>();
  for (const call of calls) {
    const key = normalizePhone(call.callerNumber);
    if (key) significant.add(key.length > 9 ? key.slice(-9) : key);
  }
  if (!significant.size) return new Map();

  const history = await prisma.call.findMany({
    where: { OR: [...significant].map((tail) => ({ callerNumber: { endsWith: tail } })) },
    select: {
      callerNumber: true,
      startedAt: true,
      durationSeconds: true,
      assignedUser: { select: { id: true, nom: true, prenom: true } },
    },
    orderBy: { startedAt: "asc" },
    take: PRIOR_SCAN_ROWS,
  });

  return buildPriorContactMap(history);
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

    // The prior-contact lookup runs in BOTH modes. It used to be tied to
    // grouping, so turning the toggle off — and every drill-down, which never
    // groups — lost the warning entirely, on exactly the screens an adviser
    // works a single lead from.
    const priorContacts = await lookupPriorContacts(calls);

    const rows = grouped
      ? groupCallsByCaller(calls, priorContacts).slice(0, MAX_ROWS)
      : attachPriorContact(calls, priorContacts);

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
