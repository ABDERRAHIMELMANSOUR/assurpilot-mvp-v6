// src/lib/ringoverWebhook.ts
//
// Ringover webhooks ("Appels décrochés", "Appels raccrochés"…): calls that reach the advisers
// through Ringover (e.g. Google Ads numbers forwarded Keyyo -> Ringover). Pure parsing here — no
// database, no request — src/lib/ringoverEndpoint.ts applies it with the same call logic as the
// Keyyo notifications (src/lib/keyyoCalls.ts).
//
// Ringover POSTs JSON (format of github.com/ringover/ringover-webhooks, developer.ringover.com):
//   { "resource": "call", "event": "ringing" | "answered" | "hangup" | "missed",
//     "timestamp": 1554823493.76,                       // epoch seconds
//     "data": { "id", "call_id", "channel_id", "direction": "inbound" | "outbound",
//               "from_number": "33601020304",           // the customer on an inbound call
//               "to_number":   "33101020304",           // the Ringover number called
//               "start_time", "hangup_time", "duration_in_seconds",
//               "is_internal", "is_anonymous", "is_ivr", "ivr_data": { "number", … },
//               "user_id", "user": { "user_id", "firstname", "lastname", "email" } },
//     "attempt": 1 }
// and signs each request: header X-Ringover-Webhook-Signature = a JWT (HS512) made with the
// webhook key shown in the Ringover dashboard.
//
// Flat payloads (a relay such as n8n) are accepted too, with the names of the specification:
// from_number / caller, to_number / callee, user_name / user_id / user_email, duration,
// call_id / session_id, event / type.
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "@/lib/phone";
import { eventType, parisWallClock, type KeyyoEventType, type KeyyoNotification } from "@/lib/keyyoWebhook";

export type RingoverEndpoint = "answered" | "ended";

export type RingoverNotification = KeyyoNotification & {
  /** Ringover's user id of the agent, to remember which AssurPilot adviser it is. */
  ringoverUserId: string | null;
  /** Internal call between Ringover users: not a lead. */
  internal: boolean;
  /** On a hangup: the call WAS answered (it has an agent), though no "answered" came first. */
  answeredBeforeEnd: Date | null;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function text(...values: unknown[]): string {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s && s !== "0" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") return s;
  }
  return "";
}

function num(...values: unknown[]): number | null {
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Epoch seconds (or ms, or a date text) -> Paris wall-clock, like the rest of the app. */
function when(v: unknown): Date | null {
  if (v === null || v === undefined || v === "" || v === 0 || v === "0") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    return parisWallClock(new Date(ms));
  }
  const s = String(v).trim();
  if (/^\d{10}(\.\d+)?$/.test(s) || /^\d{13}$/.test(s)) return parisWallClock(s);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : parisWallClock(s);
}

const RINGOVER_EVENTS: Record<string, KeyyoEventType> = {
  ringing: "ringing", answered: "answered", hangup: "ended", hungup: "ended", ended: "ended", missed: "ended", voicemail: "ended",
};

/**
 * Reads one Ringover webhook. `endpoint` is the URL it came on (/answered or /ended); the
 * payload's own "event" wins when it names a call event (a "missed" sent to /ended…).
 */
export function parseRingoverPayload(body: Obj, endpoint: RingoverEndpoint): RingoverNotification {
  const data: Obj = isObj(body.data) ? { ...body, ...body.data } : { ...body };
  const user: Obj = isObj(data.user) ? data.user : {};
  const ivr: Obj = isObj(data.ivr_data) ? data.ivr_data : isObj(data.ivr) ? data.ivr : {};

  const rawEvent = text(body.event, data.event, data.type).toLowerCase();
  const type: KeyyoEventType = RINGOVER_EVENTS[rawEvent] ?? (rawEvent ? eventType(rawEvent) : "unknown");
  const effective: KeyyoEventType = type === "unknown" ? (endpoint === "answered" ? "answered" : "ended") : type;
  const missed = rawEvent === "missed" || rawEvent === "voicemail";

  const dir = text(data.direction).toLowerCase();
  const direction = /^(in|inbound|incoming|entrant)$/.test(dir) ? "incoming" : /^(out|outbound|outgoing|sortant)$/.test(dir) ? "outgoing" : "unknown";
  const from = normalizePhone(text(data.from_number, data.caller, data.from, data.caller_number));
  const to = normalizePhone(text(data.to_number, data.callee, data.to, data.called_number));
  const anonymous = data.is_anonymous === true || data.is_anonymous === "true";
  // The customer: the caller of an inbound call (outbound calls are ignored anyway).
  const customer = anonymous ? "" : direction === "outgoing" ? to : from;

  const callId = text(data.call_id, data.session_id, data.callid, data.id);
  const firstname = text(user.firstname, data.user_firstname) || null;
  const lastname = text(user.lastname, data.user_lastname) || null;
  const fullName = text(user.concat_name, user.name, data.user_name, data.agent_name, data.agent) || null;
  const email = text(user.email, data.user_email, data.agent_email) || null;
  const ringoverUserId = text(user.user_id, data.user_id) || null;

  const duration = num(data.duration_in_seconds, data.incall_duration, data.duration);
  const startedAt = when(data.start_time);
  const eventAt =
    effective === "ended" ? when(data.hangup_time ?? data.end_time ?? body.timestamp)
      : effective === "answered" ? when(data.answered_time ?? body.timestamp)
        : when(body.timestamp ?? data.start_time);

  // A hangup naming its agent is the end of an ANSWERED call (Ringover sends "missed" otherwise).
  let answeredBeforeEnd: Date | null = null;
  if (effective === "ended" && !missed && (firstname || lastname || fullName || email || ringoverUserId)) {
    answeredBeforeEnd = when(data.answered_time)
      ?? (eventAt && duration !== null ? new Date(eventAt.getTime() - duration * 1000) : null)
      ?? startedAt ?? eventAt;
  }

  return {
    type: effective,
    rawType: rawEvent || endpoint,
    direction: direction === "unknown" ? "incoming" : direction,
    callRef: callId ? `ringover:${callId}` : null,
    sessionId: null,
    isAcd: false,
    customer,
    adviserCandidates: to ? [to] : [],
    lineCandidates: [...new Set([to, normalizePhone(text(ivr.number))].filter(Boolean))],
    startedAt,
    eventAt,
    durationSeconds: effective === "ended" ? (missed ? 0 : duration) : null,
    dref: null,
    drefReplace: null,
    account: to,
    callee: to,
    voicemail: false,
    adviserHint: { email, firstname, lastname, fullName },
    provider: "ringover",
    ringoverUserId,
    internal: data.is_internal === true || data.is_internal === "true",
    answeredBeforeEnd,
  };
}

/**
 * Checks X-Ringover-Webhook-Signature: a JWT signed HS512 with the webhook key. Constant-time;
 * an expired token ("exp") is refused.
 */
export function ringoverSignatureValid(jwt: string | null | undefined, secret: string | null | undefined, nowMs = Date.now()): boolean {
  if (!jwt || !secret) return false;
  const parts = jwt.trim().split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!header || header.alg !== "HS512") return false;
    const expected = createHmac("sha512", secret).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (payload && typeof payload.exp === "number" && payload.exp * 1000 < nowMs) return false;
    return true;
  } catch {
    return false;
  }
}
