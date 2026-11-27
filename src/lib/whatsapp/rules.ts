// src/lib/whatsapp/rules.ts
//
// The WhatsApp rules the app enforces, as pure functions (no database, no
// network) so they behave the same in every route and in the UI.

/** Meta's customer-service window: free-form messages only within 24 h of the client's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WindowState = {
  open: boolean;
  /** When the window closes (null when it was never opened on this number). */
  closesAt: Date | null;
};

/**
 * Is free text allowed from `sendingPhoneNumberId` right now?
 *
 * The window belongs to one business number: a client who wrote to the main
 * number has opened nothing on the backup. So after a switch to the backup, a
 * client can only receive a template until they answer on the backup.
 */
export function serviceWindow(
  conv: { lastInboundAt: Date | string | null; lastInboundPhoneNumberId: string | null },
  sendingPhoneNumberId: string,
  now: Date = new Date()
): WindowState {
  if (!conv.lastInboundAt) return { open: false, closesAt: null };
  const closesAt = new Date(new Date(conv.lastInboundAt).getTime() + SERVICE_WINDOW_MS);
  const sameNumber = !!sendingPhoneNumberId && conv.lastInboundPhoneNumberId === sendingPhoneNumberId;
  return { open: sameNumber && closesAt.getTime() > now.getTime(), closesAt: sameNumber ? closesAt : null };
}

// ─── Message statuses ────────────────────────────────────────────────────────
//
// Outgoing: pending (saved, not yet accepted by Meta) -> sent -> delivered -> read,
// or failed. Meta's status webhooks can arrive out of order (a "delivered" after
// the "read"), so a status only ever moves forward; "failed" wins over anything
// short of "read".
export const OUT_STATUSES = ["pending", "sent", "delivered", "read", "failed"] as const;
export type OutStatus = (typeof OUT_STATUSES)[number];

const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, failed: 3, read: 4 };

export function isKnownStatus(s: string): s is OutStatus {
  return (OUT_STATUSES as readonly string[]).includes(s);
}

/** The status to keep when `incoming` arrives for a message currently at `current`. */
export function nextStatus(current: string, incoming: string): string {
  if (!isKnownStatus(incoming)) return current;
  const a = RANK[current] ?? -1;
  return RANK[incoming] > a ? incoming : current;
}

export const STATUS_LABEL: Record<string, string> = {
  received: "Reçu",
  pending: "En cours d'envoi",
  sent: "Envoyé",
  delivered: "Distribué",
  read: "Lu",
  failed: "Échec",
};

// ─── Templates ──────────────────────────────────────────────────────────────
//
// The approved templates. Their variables are filled in at send time; how many
// each one takes is in WHATSAPP_TEMPLATE_PARAMS (JSON, e.g.
// {"alm_confirmation_demande":2}) until the final wording is known.
export const TEMPLATES = [
  { name: "alm_confirmation_demande", label: "Confirmation de demande" },
  { name: "alm_appel_sans_reponse", label: "Appel sans réponse" },
  { name: "alm_appel_manque", label: "Appel manqué" },
] as const;

export type TemplateName = (typeof TEMPLATES)[number]["name"];

export function isTemplateName(name: string): name is TemplateName {
  return TEMPLATES.some((t) => t.name === name);
}

/** Expected number of body variables per template, from the environment (default 0 = unknown, free). */
export function templateParamCounts(raw = process.env.WHATSAPP_TEMPLATE_PARAMS ?? ""): Record<string, number> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n <= 20) out[k] = n;
    }
    return out;
  } catch {
    console.error("[whatsapp] WHATSAPP_TEMPLATE_PARAMS is not valid JSON; ignored");
    return {};
  }
}

/** Short text for the conversation list. */
export function preview(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}
