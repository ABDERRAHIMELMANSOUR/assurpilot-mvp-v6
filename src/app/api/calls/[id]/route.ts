// src/app/api/calls/[id]/route.ts
// Admin-only: read, update, delete a single call (only manual/imported calls).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CALL_USER_SELECT } from "@/lib/selects";
import {
  badRequest,
  handleApiError,
  notFound,
  readJson,
  requireRole,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

type CallPayload = {
  callerNumber?: string;
  assignedUserId?: string | null;
  phoneLineId?: string;
  startedAt?: string;
  durationSeconds?: number | string;
  statut?: string;
  isMissed?: boolean;
  resultat?: string | null;
  notes?: string | null;
};

const CALL_INCLUDE = {
  phoneLine: true,
  assignedUser: { select: CALL_USER_SELECT },
  result: true,
} as const;

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireRole("ADMINISTRATEUR");
    const call = await prisma.call.findUnique({
      where: { id: params.id },
      include: CALL_INCLUDE,
    });
    if (!call) throw notFound("Appel introuvable");
    return NextResponse.json(call);
  } catch (error) {
    return handleApiError(error, `GET /api/calls/${params.id}`);
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const currentUser = await requireRole("ADMINISTRATEUR");

    const call = await prisma.call.findUnique({ where: { id: params.id } });
    if (!call) throw notFound("Appel introuvable");
    if (!call.isManual) {
      throw badRequest("Seuls les appels importés manuellement peuvent être modifiés");
    }

    const body = await readJson<CallPayload>(req);
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
    } = body;

    let started = call.startedAt;
    if (startedAt !== undefined) {
      started = new Date(startedAt);
      if (Number.isNaN(started.getTime())) throw badRequest("Date de début invalide");
    }

    let duration = call.durationSeconds;
    if (durationSeconds !== undefined) {
      duration = Number(durationSeconds);
      if (!Number.isFinite(duration) || duration < 0) {
        throw badRequest("Durée invalide");
      }
    }

    const missed = isMissed ?? call.isMissed;
    const nextAssignedUserId =
      assignedUserId !== undefined ? assignedUserId || null : call.assignedUserId;

    // One transaction so the call and its result never diverge on partial failure.
    const updatedCall = await prisma.$transaction(async (tx) => {
      const updated = await tx.call.update({
        where: { id: params.id },
        data: {
          ...(callerNumber !== undefined && { callerNumber }),
          ...(assignedUserId !== undefined && { assignedUserId: nextAssignedUserId }),
          ...(phoneLineId !== undefined && { phoneLineId }),
          startedAt: started,
          durationSeconds: duration,
          isMissed: missed,
          statut: statut ?? (missed ? "MANQUE" : "REPONDU"),
          endedAt: missed ? null : new Date(started.getTime() + duration * 1000),
        },
      });

      if (resultat !== undefined) {
        if (!resultat) {
          await tx.callResult.deleteMany({ where: { callId: params.id } });
        } else if (nextAssignedUserId) {
          await tx.callResult.upsert({
            where: { callId: params.id },
            create: {
              callId: params.id,
              userId: currentUser.userId,
              resultat,
              notes: notes ?? null,
            },
            update: { resultat, notes: notes ?? null },
          });
        }
      }

      return tx.call.findUnique({ where: { id: updated.id }, include: CALL_INCLUDE });
    });

    return NextResponse.json(updatedCall);
  } catch (error) {
    return handleApiError(error, `PUT /api/calls/${params.id}`);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireRole("ADMINISTRATEUR");

    const call = await prisma.call.findUnique({ where: { id: params.id } });
    if (!call) throw notFound("Appel introuvable");
    if (!call.isManual) {
      throw badRequest("Seuls les appels importés manuellement peuvent être supprimés");
    }

    // The result row holds an FK to the call, so it has to go first.
    await prisma.$transaction([
      prisma.callResult.deleteMany({ where: { callId: params.id } }),
      prisma.call.delete({ where: { id: params.id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, `DELETE /api/calls/${params.id}`);
  }
}
