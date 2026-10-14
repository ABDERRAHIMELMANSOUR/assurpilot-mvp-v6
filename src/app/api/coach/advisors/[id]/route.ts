// src/app/api/coach/advisors/[id]/route.ts
//
// Flip one adviser's "Appels entrants" and/or "Booster" switch. COACH ONLY, and
// only for the coach's own advisers.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  conflict,
  forbidden,
  handleApiError,
  notFound,
  readJson,
  requireRole,
} from "@/lib/api";
import { isDirectReport } from "@/lib/scope";
import {
  DEFAULT_CALL_SETTINGS,
  explainDbError,
  parseCallSettingsPatch,
  resolveCallSettings,
} from "@/lib/callSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const coach = await requireRole("SUPERVISEUR");
    const patch = parseCallSettingsPatch(await readJson(req));

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true, superviseurId: true, isActive: true },
    });
    if (!target) throw notFound("Conseiller introuvable");

    // Their own advisers only. A coach holds no switches over another coach's
    // people, nor over a coach or an administrator.
    if (!isDirectReport(coach.userId, target)) throw forbidden();

    if (!target.isActive) throw conflict("Ce compte est désactivé");

    const existing = await prisma.advisorCallSettings.findUnique({
      where: { userId: target.id },
      select: { isActiveForCalls: true, isBoosted: true },
    });
    const next = resolveCallSettings(existing ?? DEFAULT_CALL_SETTINGS, patch);

    const saved = await prisma.advisorCallSettings.upsert({
      where: { userId: target.id },
      create: { userId: target.id, ...next, updatedById: coach.userId },
      update: { ...next, updatedById: coach.userId },
      select: { isActiveForCalls: true, isBoosted: true },
    });

    // The settled values, not an echo of the request: switching calls off also
    // clears the boost, and the client must show what was actually stored.
    return NextResponse.json({ userId: target.id, ...saved });
  } catch (error) {
    return handleApiError(explainDbError(error), "PATCH /api/coach/advisors/[id]");
  }
}
