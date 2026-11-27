// src/lib/whatsapp/store.ts
//
// Turns Meta's webhook payloads into conversations and messages, and records
// the messages we send.
//
// Ownership of a NEW conversation follows the calls: the client belongs to the
// FIRST adviser who had their number on a call (the same person the
// "Déjà contacté par" badge names). A number nobody has called from goes to the
// unassigned queue, which only administrators see, until someone assigns it.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { slotForPhoneNumberId } from "@/lib/whatsapp/config";
import { nextStatus, preview } from "@/lib/whatsapp/rules";

// ─── Webhook payload (the parts we read) ─────────────────────────────────────
type WaContact = { wa_id?: string; profile?: { name?: string } };
type WaInbound = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string };
  location?: { name?: string; address?: string; latitude?: number; longitude?: number };
};
type WaStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};
type WaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: WaContact[];
  messages?: WaInbound[];
  statuses?: WaStatus[];
};
export type WaWebhookPayload = {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: WaValue }[] }[];
};

export type IngestReport = { messages: number; duplicates: number; statuses: number; ignored: number };

/** Readable text for any inbound message type. */
export function inboundText(m: WaInbound): string {
  switch (m.type) {
    case "text": return m.text?.body ?? "";
    case "image": return m.image?.caption || "[Image]";
    case "video": return m.video?.caption || "[Vidéo]";
    case "document": return m.document?.caption || `[Document${m.document?.filename ? ` : ${m.document.filename}` : ""}]`;
    case "audio": return "[Message vocal]";
    case "sticker": return "[Sticker]";
    case "button": return m.button?.text ?? "[Bouton]";
    case "interactive": return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[Réponse]";
    case "reaction": return m.reaction?.emoji ? `[Réaction ${m.reaction.emoji}]` : "[Réaction]";
    case "location": return m.location?.name || m.location?.address || "[Position]";
    default: return `[${m.type ?? "message"}]`;
  }
}

function tsToDate(ts: string | undefined): Date {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** Meta wa_id -> digits only. */
export function cleanWaId(raw: string | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * The first adviser (conseiller or coach, still active) who had this number on
 * a call, or null. Matched on the last nine digits like the calls' dedupe.
 */
export async function findOwnerForPhone(nationalPhone: string): Promise<string | null> {
  const digits = nationalPhone.replace(/\D/g, "");
  if (digits.length < 9) return null;
  const tail = digits.slice(-9);
  // callerNumber is stored however it arrived ("+33 6 12 ...", "0612..."), so the
  // comparison is on its digits; the 1000-row cap keeps a busy number cheap.
  const calls = await prisma.$queryRaw<{ callerNumber: string; assignedUserId: string }[]>(Prisma.sql`
    SELECT c."callerNumber", c."assignedUserId"
    FROM calls c
    JOIN users u ON u.id = c."assignedUserId"
    WHERE right(regexp_replace(c."callerNumber", '[^0-9]', '', 'g'), 9) = ${tail}
      AND u."isActive" = true
      AND u.role IN ('CONSEILLER', 'SUPERVISEUR')
    ORDER BY c."startedAt" ASC
    LIMIT 1000`);
  // Re-check with the full normalisation: a foreign number with the same tail is not a match.
  const hit = calls.find((c) => normalizePhone(c.callerNumber) === nationalPhone);
  return hit?.assignedUserId ?? null;
}

/** Finds or creates the conversation for a client number. */
export async function conversationFor(waId: string, clientName = "") {
  const existing = await prisma.waConversation.findUnique({ where: { waId } });
  if (existing) return existing;
  const clientPhone = normalizePhone(waId);
  const ownerUserId = await findOwnerForPhone(clientPhone);
  try {
    return await prisma.waConversation.create({
      data: { waId, clientPhone, clientName, ownerUserId, assignedAt: ownerUserId ? new Date() : null },
    });
  } catch (error) {
    // Two webhooks for the same new client at once: the other one created it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.waConversation.findUniqueOrThrow({ where: { waId } });
    }
    throw error;
  }
}

async function ingestInbound(phoneNumberId: string, m: WaInbound, contacts: WaContact[]): Promise<"new" | "duplicate" | "ignored"> {
  const waId = cleanWaId(m.from);
  if (!waId || !m.id) return "ignored";
  if (await prisma.waMessage.findUnique({ where: { waMessageId: m.id }, select: { id: true } })) return "duplicate";

  const name = contacts.find((c) => cleanWaId(c.wa_id) === waId)?.profile?.name ?? "";
  const conv = await conversationFor(waId, name);
  const at = tsToDate(m.timestamp);
  const body = inboundText(m);

  try {
    await prisma.waMessage.create({
      data: {
        conversationId: conv.id,
        direction: "IN",
        type: m.type ?? "text",
        body,
        waMessageId: m.id,
        phoneNumberId,
        status: "received",
        createdAt: at,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }

  // A late webhook must not move the window or the list backwards.
  const newer = !conv.lastInboundAt || at > conv.lastInboundAt;
  await prisma.waConversation.update({
    where: { id: conv.id },
    data: {
      unreadCount: { increment: 1 },
      ...(name && name !== conv.clientName ? { clientName: name } : {}),
      ...(newer ? { lastInboundAt: at, lastInboundPhoneNumberId: phoneNumberId } : {}),
      // A brand-new conversation has no preview yet (its lastMessageAt is its creation time).
      ...(!conv.lastMessagePreview || at >= conv.lastMessageAt ? { lastMessageAt: at, lastMessagePreview: preview(body) } : {}),
    },
  });
  return "new";
}

async function ingestStatus(s: WaStatus): Promise<boolean> {
  if (!s.id || !s.status) return false;
  const msg = await prisma.waMessage.findUnique({ where: { waMessageId: s.id }, select: { id: true, status: true } });
  if (!msg) return false; // sent from outside the app (e.g. Meta's own tools)
  const status = nextStatus(msg.status, s.status);
  const err = s.errors?.[0];
  if (status === msg.status && !(s.status === "failed" && err)) return true;
  await prisma.waMessage.update({
    where: { id: msg.id },
    data: {
      status,
      statusAt: tsToDate(s.timestamp),
      ...(s.status === "failed" && err
        ? { errorCode: String(err.code ?? ""), errorTitle: (err.error_data?.details || err.message || err.title || "").slice(0, 300) }
        : {}),
    },
  });
  return true;
}

/** Processes one webhook body. Events for a business number that is not ours are ignored. */
export async function ingestWebhook(payload: WaWebhookPayload): Promise<IngestReport> {
  const report: IngestReport = { messages: 0, duplicates: 0, statuses: 0, ignored: 0 };
  if (payload.object !== "whatsapp_business_account") return report;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      if (!slotForPhoneNumberId(phoneNumberId)) {
        report.ignored += (value.messages?.length ?? 0) + (value.statuses?.length ?? 0);
        continue;
      }
      for (const m of value.messages ?? []) {
        const r = await ingestInbound(phoneNumberId, m, value.contacts ?? []);
        if (r === "new") report.messages++;
        else if (r === "duplicate") report.duplicates++;
        else report.ignored++;
      }
      for (const s of value.statuses ?? []) {
        if (await ingestStatus(s)) report.statuses++;
        else report.ignored++;
      }
    }
  }
  return report;
}
