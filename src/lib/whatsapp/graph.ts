// src/lib/whatsapp/graph.ts
//
// The two things that talk to Meta: checking a webhook's signature, and sending
// a message through the Graph API. Nothing here touches the database.
import { createHmac, timingSafeEqual } from "node:crypto";
import { accessToken, graphVersion } from "@/lib/whatsapp/config";

/**
 * Meta signs every webhook POST with the App Secret:
 *   X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>
 * The check must run on the RAW body text, before any JSON parsing.
 */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type OutgoingMessage =
  | { kind: "text"; body: string }
  | { kind: "template"; name: string; language: string; params: string[] };

export type SendResult =
  | { ok: true; waMessageId: string }
  | { ok: false; code: string; title: string; status: number };

const TIMEOUT_MS = 10_000;

/** Sends one message from `phoneNumberId` to `to` (digits with country code). */
export async function sendMessage(phoneNumberId: string, to: string, msg: OutgoingMessage): Promise<SendResult> {
  const token = accessToken();
  if (!token) return { ok: false, code: "config", title: "WHATSAPP_ACCESS_TOKEN n'est pas configuré", status: 503 };
  if (!phoneNumberId) return { ok: false, code: "config", title: "Aucun Phone Number ID pour le numéro actif", status: 503 };

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
  };
  if (msg.kind === "text") {
    payload.type = "text";
    payload.text = { preview_url: false, body: msg.body };
  } else {
    payload.type = "template";
    payload.template = {
      name: msg.name,
      language: { code: msg.language },
      ...(msg.params.length
        ? { components: [{ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) }] }
        : {}),
    };
  }

  const url = `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneNumberId)}/messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, code: timedOut ? "timeout" : "network", title: timedOut ? "Meta n'a pas répondu à temps" : "Meta injoignable", status: 502 };
  }

  const data = (await res.json().catch(() => null)) as
    | { messages?: { id?: string }[]; error?: { code?: number; message?: string; error_data?: { details?: string } } }
    | null;

  const id = data?.messages?.[0]?.id;
  if (res.ok && id) return { ok: true, waMessageId: id };

  const err = data?.error;
  return {
    ok: false,
    code: String(err?.code ?? res.status),
    // Meta's message, never the token or the request.
    title: (err?.error_data?.details || err?.message || `Erreur Meta ${res.status}`).slice(0, 300),
    status: res.status >= 400 && res.status < 500 ? 422 : 502,
  };
}
