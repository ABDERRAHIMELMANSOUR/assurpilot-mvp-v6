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
// call_id / session_id, event / type, direction.
//
// ONLY INBOUND CALLS are kept: "direction" must say inbound (inbound / in / incoming / entrant).
// Outbound, internal (is_internal) and calls whose direction is missing or unknown are ignored.
//
// And ONLY CALLS FORWARDED FROM THE KEYYO STANDARD (keyyoStandardOrigin), recognised by one of:
//   1. a redirection / transfer field naming a Keyyo standard line: redirected_from,
//      redirecting_number, forwarded_from, diverted_from, transferred_from, transfer,
//      original_called_number… — at the top, in "data" or in "metadata";
//   2. the number called (to_number / callee) being itself a Keyyo standard line;
//   3. the number called being one of the Ringover numbers the standard forwards to, declared on
//      /admin/keyyo (« 0189… » or « 0189…=0182287364 » to name the standard line it serves).
// A direct call to Ringover, or one redirected from any other number, is ignored.
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "@/lib/phone";
import { eventType, parisWallClock, type KeyyoEventType, type KeyyoNotification } from "@/lib/keyyoWebhook";

export type RingoverEndpoint = "answered" | "ended";

export type RingoverNotification = KeyyoNotification & {
  /** Ringover's user id of the agent, to remember which AssurPilot adviser it is. */
  ringoverUserId: string | null;
  /** Internal call between Ringover users: not a lead. */
  internal: boolean;
  /** Ringover said "inbound": the only calls processed. */
  inbound: boolean;
  /** The direction as received ("" when absent), for the reason of an ignored event. */
  rawDirection: string;
  /** Number called (to_number / callee): the Ringover line, national form. */
  called: string;
  /** Numbers the call was redirected / transferred from, as the payload gives them. */
  redirectedFrom: string[];
  /** Ringover IVR number the call went through, if any. */
  ivrNumber: string;
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

// Field names under which a redirection / transfer origin may come (compared without case or
// separators). A value may be a number, or an object holding it (from / number / from_number…).
const REDIRECT_KEYS = [
  "redirected_from", "redirect_from", "redirected_by", "redirecting", "redirecting_number", "redirection",
  "redirect", "forwarded_from", "forward_from", "forwarded_by", "forwarding_number", "diverted_from",
  "diversion", "diversion_number", "transferred_from", "transfer_from", "transfer", "transferred_by",
  "original_number", "original_called_number", "original_to_number", "original_callee", "origin_number",
  "keyyo_line", "keyyo_number", "ligne_keyyo", "standard",
].map((k) => k.replace(/[^a-z0-9]/g, ""));
const NESTED_NUMBER_KEYS = ["from", "number", "from_number", "numero", "phone", "line", "to_number", "original"];

function redirectNumbers(...sources: Obj[]): string[] {
  const found: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" || typeof v === "number") {
      const digits = String(v).replace(/\D/g, "");
      if (digits.length >= 9) found.push(normalizePhone(String(v)));
    } else if (isObj(v)) {
      for (const k of NESTED_NUMBER_KEYS) if (k in v) add(v[k]);
    } else if (Array.isArray(v)) {
      v.forEach(add);
    }
  };
  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) {
      if (REDIRECT_KEYS.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ""))) add(v);
    }
  }
  return [...new Set(found.filter(Boolean))];
}

export type KeyyoOrigin = {
  /** The Keyyo standard line the call came from, when known (national form). */
  line: string | null;
  via: "redirection" | "numéro appelé" | "numéro de renvoi";
};

/**
 * Parses the « Numéros Ringover recevant les renvois du standard Keyyo » setting: one entry per
 * line (or separated by commas / semicolons; spaces inside a number are fine), optionally
 * « ringover=keyyo ». An entry that is not a phone number (under 9 digits) is skipped.
 */
export function forwardTargetEntries(textValue: string | null | undefined): string[] {
  return (textValue ?? "").split(/[\n\r,;]+/).map((x) => x.trim()).filter(Boolean);
}

const isPhone = (x: string | undefined) => (x ?? "").replace(/\D/g, "").length >= 9;

export function parseForwardTargets(textValue: string | null | undefined): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const entry of forwardTargetEntries(textValue)) {
    const [target, line] = entry.split("=").map((x) => x.trim());
    if (!isPhone(target)) continue;
    out.set(normalizePhone(target), isPhone(line) ? normalizePhone(line) : null);
  }
  return out;
}

/** Entries of the setting that are not « number » or « number=number ». */
export function invalidForwardTargets(textValue: string | null | undefined): string[] {
  return forwardTargetEntries(textValue).filter((entry) => {
    const parts = entry.split("=").map((x) => x.trim());
    return parts.length > 2 || !isPhone(parts[0]) || (parts.length === 2 && !isPhone(parts[1]));
  });
}

/**
 * Did this Ringover call come from the Keyyo standard? `keyyoLines`: the standard's lines
 * (national form); `forwardTargets`: Ringover numbers the standard forwards to. null = no.
 */
export function keyyoStandardOrigin(
  n: Pick<RingoverNotification, "redirectedFrom" | "called" | "ivrNumber">,
  keyyoLines: Set<string>,
  forwardTargets: Map<string, string | null>,
): KeyyoOrigin | null {
  const redirected = n.redirectedFrom.find((x) => keyyoLines.has(x));
  if (redirected) return { line: redirected, via: "redirection" };
  const reached = [n.called, n.ivrNumber].filter(Boolean);
  const direct = reached.find((x) => keyyoLines.has(x));
  if (direct) return { line: direct, via: "numéro appelé" };
  const target = reached.find((x) => forwardTargets.has(x));
  if (target) return { line: forwardTargets.get(target) ?? null, via: "numéro de renvoi" };
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

  const dir = text(data.direction, data.call_direction).toLowerCase();
  const direction = /^(in|inbound|incoming|entrant)$/.test(dir) ? "incoming" : /^(out|outbound|outgoing|sortant)$/.test(dir) ? "outgoing" : "unknown";
  const inbound = direction === "incoming";
  const from = normalizePhone(text(data.from_number, data.caller, data.from, data.caller_number));
  const to = normalizePhone(text(data.to_number, data.callee, data.to, data.called_number));
  const anonymous = data.is_anonymous === true || data.is_anonymous === "true";
  // The customer: the caller of an inbound call (nothing else is processed).
  const customer = anonymous || !inbound ? "" : from;

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
    // Anything not explicitly inbound is treated as outgoing, i.e. ignored by the call logic too.
    direction: inbound ? "incoming" : "outgoing",
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
    internal: data.is_internal === true || data.is_internal === "true" || data.is_internal === 1 || data.is_internal === "1",
    inbound,
    rawDirection: dir,
    called: to,
    redirectedFrom: redirectNumbers(body, data, ...[body.metadata, data.metadata, body.meta, data.meta, data.custom_data, data.tags].filter(isObj)),
    ivrNumber: normalizePhone(text(ivr.number)),
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
