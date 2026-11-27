// src/lib/whatsapp/scope.ts
//
// Who may see which WhatsApp conversation. Same rule as the calls
// (src/lib/scope.ts), keyed on the conversation's owner:
//   - conseiller : only the conversations they own;
//   - coach      : their own, and those of the conseillers reporting directly to them;
//   - admin      : every conversation, including the unassigned queue.
// Every WhatsApp route goes through these functions.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { forbidden, notFound, type SessionUser } from "@/lib/api";
import { isDirectReport } from "@/lib/scope";

export function conversationScopeFor(user: SessionUser): Prisma.WaConversationWhereInput {
  if (user.role === "ADMINISTRATEUR") return {};
  if (user.role === "SUPERVISEUR") {
    return {
      OR: [
        { ownerUserId: user.userId },
        { owner: { superviseurId: user.userId, role: "CONSEILLER" } },
      ],
    };
  }
  return { ownerUserId: user.userId };
}

/** Loads a conversation the viewer may see, or throws 404 (no hint that it exists). */
export async function loadVisibleConversation(user: SessionUser, id: string) {
  const conv = await prisma.waConversation.findFirst({
    where: { AND: [{ id }, conversationScopeFor(user)] },
    include: { owner: { select: { id: true, nom: true, prenom: true, superviseurId: true, role: true } } },
  });
  if (!conv) throw notFound("Conversation introuvable");
  return conv;
}

/**
 * Who may WRITE in a conversation: its owner, or an administrator.
 * A coach reads their team's chats but does not answer in an adviser's place.
 */
export function canReply(user: SessionUser, conv: { ownerUserId: string | null }): boolean {
  return user.role === "ADMINISTRATEUR" || (conv.ownerUserId !== null && conv.ownerUserId === user.userId);
}

/**
 * Checks a (re)assignment. An admin may give any conversation to any active
 * conseiller or coach, or put it back in the queue (null). A coach may move a
 * conversation of their team to themselves or one of their direct reports.
 */
export async function assertCanAssign(
  user: SessionUser,
  conv: { ownerUserId: string | null },
  targetUserId: string | null
): Promise<void> {
  if (user.role === "CONSEILLER") throw forbidden();

  if (targetUserId === null) {
    if (user.role !== "ADMINISTRATEUR") throw forbidden("Seul un administrateur peut remettre une conversation dans la file");
    return;
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, superviseurId: true, isActive: true },
  });
  if (!target || !target.isActive || (target.role !== "CONSEILLER" && target.role !== "SUPERVISEUR")) {
    throw notFound("Conseiller introuvable");
  }
  if (user.role === "ADMINISTRATEUR") return;

  // Coach: the conversation is already in their scope (loadVisibleConversation),
  // and the target must be themselves or one of their people.
  if (target.id !== user.userId && !isDirectReport(user.userId, target)) {
    throw forbidden("Vous ne pouvez attribuer qu'à vous-même ou à vos conseillers");
  }
}
