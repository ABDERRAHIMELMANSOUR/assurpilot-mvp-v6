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
import { entityOfTeamName } from "@/lib/entity";
import { maskCallsFor } from "@/lib/mask";
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
    // Conseillers may hand calls to peers inside their own entity.
    const user = await requireRole("ADMINISTRATEUR", "SUPERVISEUR", "CONSEILLER");
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

    // A conseiller may only move a call that is currently theirs.
    if (user.role === "CONSEILLER" && call.assignedUserId !== user.userId) {
      throw forbidden("Cet appel ne vous est pas attribué");
    }

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
      return NextResponse.json(maskCallsFor(user.role, [restored])[0]);
    }

    if (!conseillerId) throw badRequest("Le conseiller destinataire est obligatoire");

    const target = await prisma.user.findUnique({
      where: { id: conseillerId },
      select: {
        id: true, role: true, teamId: true, isActive: true, superviseurId: true,
        team: { select: { nom: true } },
      },
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

    // A conseiller transfers only inside their own entity — CPA people to CPA
    // people, ALM to ALM, across coaches but never across the boundary.
    if (user.role === "CONSEILLER") {
      if (target.id === user.userId) {
        throw badRequest("Cet appel vous est déjà attribué");
      }
      const me = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { team: { select: { nom: true } } },
      });
      const myEntity = entityOfTeamName(me?.team?.nom);
      const targetEntity = entityOfTeamName(target.team?.nom);
      if (!myEntity) {
        throw forbidden("Votre équipe n'est rattachée ni à CPA ni à ALM");
      }
      if (targetEntity !== myEntity) {
        throw forbidden(`Transfert impossible : ce conseiller n'appartient pas à l'entité ${myEntity}`);
      }
    }

    // Whoever currently holds the call is the one recorded as transferring it,
    // so a re-transfer keeps pointing at the original coach rather than the
    // conseiller it passed through.
    // Keep pointing at whoever first handed the call on, so a chain of
    // transfers does not rewrite history to the most recent sender.
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

    return NextResponse.json(updated ? maskCallsFor(user.role, [updated])[0] : updated);
  } catch (error) {
    return handleApiError(error, `POST /api/calls/${params.id}/transfer`);
  }
}
