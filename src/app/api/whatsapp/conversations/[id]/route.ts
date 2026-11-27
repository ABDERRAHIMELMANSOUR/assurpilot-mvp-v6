// src/app/api/whatsapp/conversations/[id]/route.ts
//
// GET   : one conversation (if the viewer may see it) with its messages, the
//         state of the 24-hour window on the active number, and whether the
//         viewer may reply. Opening it as its owner clears the unread count.
// PATCH : { ownerUserId: string | null } — (re)assign. Admin: anyone, or back to
//         the queue. Coach: within their team (src/lib/whatsapp/scope.ts).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, readJson, requireUser } from "@/lib/api";
import { assertCanAssign, canReply, loadVisibleConversation } from "@/lib/whatsapp/scope";
import { withWhatsAppTables } from "@/lib/whatsapp/tables";
import { activeNumber } from "@/lib/whatsapp/config";
import { serviceWindow } from "@/lib/whatsapp/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGES = 500;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const conv = await withWhatsAppTables(() => loadVisibleConversation(user, params.id));
    const [messages, number] = await Promise.all([
      prisma.waMessage.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: "desc" },
        take: MAX_MESSAGES,
        select: {
          id: true, direction: true, type: true, body: true, templateName: true,
          status: true, errorCode: true, errorTitle: true, createdAt: true, statusAt: true,
          phoneNumberId: true, sentById: true,
        },
      }),
      activeNumber(),
    ]);

    if (conv.unreadCount > 0 && conv.ownerUserId === user.userId) {
      await prisma.waConversation.update({ where: { id: conv.id }, data: { unreadCount: 0 } });
    }

    const window = serviceWindow(conv, number.phoneNumberId);
    return NextResponse.json({
      conversation: {
        id: conv.id,
        waId: conv.waId,
        clientPhone: conv.clientPhone,
        clientName: conv.clientName,
        owner: conv.owner ? { id: conv.owner.id, nom: conv.owner.nom, prenom: conv.owner.prenom } : null,
        lastInboundAt: conv.lastInboundAt,
      },
      messages: messages.reverse(),
      activeNumber: { slot: number.slot, label: number.label, displayNumber: number.displayNumber },
      window: { open: window.open, closesAt: window.closesAt },
      canReply: canReply(user, conv),
      canAssign: user.role !== "CONSEILLER",
    });
  } catch (error) {
    return handleApiError(error, "GET /api/whatsapp/conversations/[id]");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await readJson<{ ownerUserId?: unknown }>(req);
    if (!("ownerUserId" in body)) throw badRequest("ownerUserId est requis");
    const target = body.ownerUserId === null ? null : typeof body.ownerUserId === "string" ? body.ownerUserId : undefined;
    if (target === undefined) throw badRequest("ownerUserId doit être un identifiant ou null");

    const conv = await withWhatsAppTables(() => loadVisibleConversation(user, params.id));
    await assertCanAssign(user, conv, target);

    const updated = await prisma.waConversation.update({
      where: { id: conv.id },
      data: { ownerUserId: target, assignedAt: new Date(), assignedById: user.userId },
      include: { owner: { select: { id: true, nom: true, prenom: true } } },
    });
    return NextResponse.json({ id: updated.id, owner: updated.owner });
  } catch (error) {
    return handleApiError(error, "PATCH /api/whatsapp/conversations/[id]");
  }
}
