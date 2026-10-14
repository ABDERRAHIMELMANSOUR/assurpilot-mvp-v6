// src/app/api/admin/call-settings/[id]/route.ts
//
// Admin OVERRIDE of what is requested for one adviser. Same rules as the coach's
// switches (muting clears the boost; a muted adviser cannot be boosted), applied
// by the same function, so an admin cannot create a state a coach could not.
// It changes the REQUEST only — whether it has been applied on the PBX is a
// separate step (see ../apply), so an override shows up as work still to do.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { conflict, handleApiError, notFound, readJson, requireRole } from "@/lib/api";
import {
  asMigrationPending,
  parseCallSettingsPatch,
  resolveCallSettings,
} from "@/lib/callSettings";
import { loadAdviserRows } from "@/lib/adminRouting";
import { DEFAULT_ROUTING } from "@/lib/routingState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const patch = parseCallSettingsPatch(await readJson(req));

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true, isActive: true },
    });
    if (!target || target.role !== "CONSEILLER") throw notFound("Conseiller introuvable");
    if (!target.isActive) throw conflict("Ce compte est désactivé");

    const existing = await prisma.advisorCallSettings.findUnique({
      where: { userId: target.id },
      select: { isActiveForCalls: true, isBoosted: true },
    });
    const next = resolveCallSettings(existing ?? DEFAULT_ROUTING, patch);

    // `applied*` is deliberately not written: overriding the request does not
    // change what is on the PBX.
    await prisma.advisorCallSettings.upsert({
      where: { userId: target.id },
      create: { userId: target.id, ...next, updatedById: admin.userId },
      update: { ...next, updatedById: admin.userId },
      select: { userId: true },
    });

    const [row] = await loadAdviserRows([target.id]);
    return NextResponse.json({ adviser: row });
  } catch (error) {
    return handleApiError(asMigrationPending(error), "PATCH /api/admin/call-settings/[id]");
  }
}
