// src/app/api/calls/[id]/transfer/route.ts
//
// A coach hands a call to one of their conseillers.
//
// The call's `assignedUserId` moves to the conseiller, so it appears in their
// list immediately. `transferredById` records the coach, which is what keeps
// the call in the coach's own workspace afterwards (see scopeFor() in
// /api/calls) and drives the "Transféré à …" badge.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CALL_INCLUDE } from "@/lib/selects";
import { isDirectReport } from "@/lib/scope";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  readJson,
  requireRole,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

type TransferPayload = {
  /** Target conseiller. `null` cancels a previous transfer. */
  conseillerId?: string | null;
  /** Optional qualification applied in the same action. */
  resultat?: string | null;
  notes?: string | null;
};

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireRole("ADMINISTRATEUR", "SUPERVISEUR");
    const { conseillerId, resultat, notes } = await readJson<TransferPayload>(req);

    const call = await prisma.call.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        assignedUserId: true,
        transferredById: true,
        assignedUser: { select: { role: true, superviseurId: true } },
      },
    });
    if (!call) throw notFound("Appel introuvable");

    // A coach may only move a call they can already see.
    if (user.role === "SUPERVISEUR") {
      const ownsIt =
        call.assignedUserId === user.userId ||
        call.transferredById === user.userId ||
        (call.assignedUser !== null && isDirectReport(user.userId, call.assignedUser));
      if (!ownsIt) throw forbidden("Cet appel n'est pas dans votre périmètre");
    }

    // Cancelling a transfer returns the call to the coach who made it.
    if (conseillerId === null || conseillerId === "") {
      if (!call.transferredById) {
        throw badRequest("Cet appel n'a pas été transféré");
      }
      const restored = await prisma.call.update({
        where: { id: params.id },
        data: {
          assignedUserId: call.transferredById,
          transferredById: null,
          transferredAt: null,
        },
        include: CALL_INCLUDE,
      });
      return NextResponse.json(restored);
    }

    if (!conseillerId) throw badRequest("Le conseiller destinataire est obligatoire");

    const target = await prisma.user.findUnique({
      where: { id: conseillerId },
      select: { id: true, role: true, teamId: true, isActive: true, superviseurId: true },
    });
    if (!target) throw notFound("Conseiller introuvable");
    if (target.role !== "CONSEILLER") {
      throw badRequest("Un appel ne peut être transféré qu'à un conseiller");
    }
    if (!target.isActive) throw badRequest("Ce conseiller est désactivé");

    // A coach transfers only within their own team.
    if (user.role === "SUPERVISEUR" && !isDirectReport(user.userId, target)) {
      throw forbidden("Ce conseiller ne fait pas partie de votre équipe");
    }

    // Whoever currently holds the call is the one recorded as transferring it,
    // so a re-transfer keeps pointing at the original coach rather than the
    // conseiller it passed through.
    const transferredById =
      call.transferredById ?? call.assignedUserId ?? user.userId;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.call.update({
        where: { id: params.id },
        data: {
          assignedUserId: target.id,
          transferredById,
          transferredAt: new Date(),
        },
      });

      // Qualification is optional and applied in the same action so the coach
      // can "qualify and transfer" in one step.
      if (resultat !== undefined) {
        if (!resultat) {
          await tx.callResult.deleteMany({ where: { callId: params.id } });
        } else {
          await tx.callResult.upsert({
            where: { callId: params.id },
            create: {
              callId: params.id,
              userId: user.userId,
              resultat,
              notes: notes ?? null,
            },
            update: { resultat, notes: notes ?? null },
          });
        }
      }

      return tx.call.findUnique({ where: { id: params.id }, include: CALL_INCLUDE });
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, `POST /api/calls/${params.id}/transfer`);
  }
}
