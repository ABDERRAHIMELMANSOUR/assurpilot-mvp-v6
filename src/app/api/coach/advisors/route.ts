// src/app/api/coach/advisors/route.ts
//
// The coach's advisers with the two call-distribution switches the coach
// controls. COACH ONLY — an administrator is refused as firmly as a conseiller
// is: these switches are the coach's to set.
//
// Kept separate from /api/analytics and /api/users on purpose. The switches
// live in their own table, and routing them through those shared endpoints
// would make a missing table break the admin dashboard too.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireRole } from "@/lib/api";
import { directReportsWhere } from "@/lib/scope";
import { DEFAULT_CALL_SETTINGS, explainDbError } from "@/lib/callSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const coach = await requireRole("SUPERVISEUR");

    const [me, advisers] = await Promise.all([
      prisma.user.findUnique({
        where: { id: coach.userId },
        select: { team: { select: { id: true, nom: true } } },
      }),
      prisma.user.findMany({
        // The coach's roster is their direct reports — a Team is a bucket that
        // several coaches share, so scoping by team would show other coaches'
        // people and hand this coach switches over them.
        where: directReportsWhere(coach.userId),
        select: {
          id: true,
          nom: true,
          prenom: true,
          isActive: true,
          team: { select: { nom: true } },
          callSettings: { select: { isActiveForCalls: true, isBoosted: true } },
        },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      }),
    ]);

    return NextResponse.json({
      team: me?.team ?? null,
      advisers: advisers.map((a) => ({
        id: a.id,
        nom: a.nom,
        prenom: a.prenom,
        team: a.team?.nom ?? null,
        // A deactivated ACCOUNT is a different thing from "not taking calls":
        // the UI shows its switches as unavailable rather than editable.
        isActive: a.isActive,
        // No row yet means the defaults.
        ...(a.callSettings ?? DEFAULT_CALL_SETTINGS),
      })),
    });
  } catch (error) {
    return handleApiError(explainDbError(error), "GET /api/coach/advisors");
  }
}
