// src/app/api/calls/mock/route.ts — dev only, simulate an inbound call
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CALL_USER_SELECT } from "@/lib/selects";
import { badRequest, forbidden, handleApiError, requireRole } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAKE_NUMBERS = [
  "+33 6 12 34 56 78",
  "+33 7 65 43 21 09",
  "+33 6 98 76 54 32",
  "+33 9 11 22 33 44",
  "+33 6 55 66 77 88",
  "+33 7 99 88 77 66",
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      throw forbidden("Non disponible en production");
    }
    await requireRole("ADMINISTRATEUR");

    const { isMissed = false, userId } = await req
      .json()
      .catch(() => ({ isMissed: false, userId: undefined as string | undefined }));

    const lines = await prisma.phoneLine.findMany({ where: { isActive: true } });
    if (!lines.length) throw badRequest("Aucune ligne configurée");
    const line = pick(lines);

    let agentId: string | undefined = userId;
    if (!agentId) {
      const agents = await prisma.user.findMany({
        where: { role: "CONSEILLER", isActive: true },
        select: { id: true },
      });
      if (!agents.length) throw badRequest("Aucun conseiller actif");
      agentId = pick(agents).id;
    }

    const duration = isMissed ? 0 : Math.floor(Math.random() * 480) + 60;
    const startedAt = new Date();

    const call = await prisma.call.create({
      data: {
        phoneLineId: line.id,
        assignedUserId: agentId,
        callerNumber: isMissed ? "+33 6 00 00 00 00" : pick(FAKE_NUMBERS),
        isMissed,
        durationSeconds: duration,
        startedAt,
        endedAt: isMissed ? null : new Date(startedAt.getTime() + duration * 1000),
        statut: isMissed ? "MANQUE" : "REPONDU",
      },
      include: { phoneLine: true, assignedUser: { select: CALL_USER_SELECT } },
    });

    return NextResponse.json({ success: true, call }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "POST /api/calls/mock");
  }
}
