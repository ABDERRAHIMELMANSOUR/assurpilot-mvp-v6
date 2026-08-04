// src/app/api/calls/manual/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CALL_USER_SELECT } from "@/lib/selects";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualCallPayload = {
  callerNumber?: string;
  assignedUserId?: string;
  phoneLineId?: string;
  startedAt?: string;
  durationSeconds?: number | string;
  statut?: string;
  isMissed?: boolean;
  resultat?: string | null;
  notes?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("ADMINISTRATEUR");
    const {
      callerNumber,
      assignedUserId,
      phoneLineId,
      startedAt,
      durationSeconds,
      statut,
      isMissed,
      resultat,
      notes,
    } = await readJson<ManualCallPayload>(req);

    if (!callerNumber?.trim()) throw badRequest("Le numéro appelant est obligatoire");
    if (!assignedUserId) throw badRequest("Le conseiller est obligatoire");
    if (!phoneLineId) throw badRequest("La ligne téléphonique est obligatoire");
    if (!startedAt) throw badRequest("La date et l'heure sont obligatoires");
    if (!statut) throw badRequest("Le statut est obligatoire");

    const startDate = new Date(startedAt);
    if (Number.isNaN(startDate.getTime())) throw badRequest("Date de début invalide");

    const duration = Number(durationSeconds) || 0;
    if (duration < 0) throw badRequest("Durée invalide");

    const missed = isMissed === true || statut === "MANQUE";

    // Reject unknown FKs up front so the client gets a 400 rather than a
    // Prisma foreign-key error surfacing as a 500.
    const [conseiller, phoneLine] = await Promise.all([
      prisma.user.findUnique({ where: { id: assignedUserId }, select: { id: true } }),
      prisma.phoneLine.findUnique({ where: { id: phoneLineId }, select: { id: true } }),
    ]);
    if (!conseiller) throw badRequest("Conseiller introuvable");
    if (!phoneLine) throw badRequest("Ligne téléphonique introuvable");

    const call = await prisma.$transaction(async (tx) => {
      const created = await tx.call.create({
        data: {
          phoneLineId,
          assignedUserId,
          callerNumber: callerNumber.trim(),
          isManual: true,
          isMissed: missed,
          durationSeconds: duration,
          startedAt: startDate,
          endedAt: duration > 0 ? new Date(startDate.getTime() + duration * 1000) : null,
          statut,
        },
      });

      if (resultat && !missed) {
        await tx.callResult.create({
          data: { callId: created.id, userId: user.userId, resultat, notes: notes ?? null },
        });
      }

      return tx.call.findUnique({
        where: { id: created.id },
        include: {
          phoneLine: true,
          assignedUser: { select: CALL_USER_SELECT },
          result: true,
        },
      });
    });

    return NextResponse.json(call, { status: 201 });
  } catch (error) {
    return handleApiError(error, "POST /api/calls/manual");
  }
}
