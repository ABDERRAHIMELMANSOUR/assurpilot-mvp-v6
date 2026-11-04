// src/lib/keyyoWebhook.ts
//
// Keyyo "Notification d'appels": Keyyo calls a URL of ours for every state change of a call on
// a Keyyo line. Pure parsing here — no database, no request — so the rules can be read and
// tested on their own; src/app/api/keyyo/webhook/route.ts applies them.
//
// What Keyyo sends (guide "CTI / API / TAPI"): an HTTP GET with
//   account  the Keyyo line notified (international form, 33…)  -> the adviser's line
//   caller   the calling number                                -> the customer
//   callee   the called number
//   callref  the call's identifier (same for its SETUP, CONNECT, RELEASE)
//   type     SETUP (ringing), CONNECT (answered), RELEASE (hung up)
//   dref     optional reference
// No date: the start of the call is when its first notification arrives. Notifications exist
// per LINE, not on the standard (ACD) services, so they are enabled on each adviser's line.
//
// The same names as the Keyyo call export are accepted too — "Début d'appel", "Numéro
// appelant", "Numéro présenté", "Numéro appelé" — with the export's meaning (see the Excel
// import): présenté = the customer, appelé = the adviser's line, appelant = the standard line.
// Names are compared without case, accents or separators.
import { normalizePhone } from "@/lib/phone";

export type KeyyoEventType = "ringing" | "answered" | "ended" | "unknown";

export type KeyyoNotification = {
  type: KeyyoEventType;
  /** Keyyo's word for it, as received (SETUP, CONNECT…). */
  rawType: string;
  /** Identifier shared by the notifications of one call; null if Keyyo sent none. */
  callRef: string | null;
  /** The customer's number (Numéro présenté / caller), national form. */
  customer: string;
  /** Numbers that may be the adviser's line, most specific first (account, Numéro appelé, callee). */
  adviserCandidates: string[];
  /** Numbers that may be the standard line it came in on (Numéro appelant, callee, account). */
  lineCandidates: string[];
  /** Start of the call when Keyyo gives it ("Début d'appel"); otherwise null (= now). */
  startedAt: Date | null;
  /** Duration in seconds when given. */
  durationSeconds: number | null;
  dref: string | null;
};

function key(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pick(params: Map<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = params.get(key(n));
    if (v !== undefined && v.trim() !== "") return v.trim();
  }
  return "";
}

const TYPE_WORDS: Array<[KeyyoEventType, RegExp]> = [
  ["ringing", /^(setup|ring|ringing|sonnerie|incoming|alerting|start|debut|nouveau|new)$/],
  ["answered", /^(connect|connected|answer|answered|decroche|decroch|pickup|up|bridge)$/],
  ["ended", /^(release|released|hangup|hang_up|end|ended|fin|raccroche|disconnect|terminated)$/],
];

export function eventType(raw: string): KeyyoEventType {
  const w = key(raw);
  for (const [type, re] of TYPE_WORDS) if (re.test(w)) return type;
  return "unknown";
}

/**
 * Date and time as the rest of the application stores them: the Paris wall-clock time put in a
 * UTC Date (that is what the Excel import does with Keyyo's "Début d'appel", so a call keeps the
 * same instant whichever way it arrived). A text without a zone is taken as Paris time; an epoch
 * or a zoned ISO date is converted to Paris time first.
 */
export function parisWallClock(input: Date | string | number | null | undefined, now: Date = new Date()): Date {
  const fromInstant = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")));
  };
  if (input === null || input === undefined || input === "") return fromInstant(now);
  if (input instanceof Date) return fromInstant(input);
  const text = String(input).trim();
  if (/^\d{10}(\.\d+)?$/.test(text)) return fromInstant(new Date(Number(text) * 1000));
  if (/^\d{13}$/.test(text)) return fromInstant(new Date(Number(text)));
  let m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] ?? 0)));
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fromInstant(now) : fromInstant(parsed);
}

/** Reads one notification from its parameters (query string, form or JSON, merged). */
export function parseKeyyoNotification(raw: Record<string, unknown>): KeyyoNotification {
  const params = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    params.set(key(k), String(v));
  }

  const rawType = pick(params, "type", "event", "evenement", "etat", "state", "status", "statut");
  const account = pick(params, "account", "compte", "ligne");
  const callee = pick(params, "callee", "called", "to", "appele");
  const appele = pick(params, "Numéro appelé", "numero_appele");
  const appelant = pick(params, "Numéro appelant", "numero_appelant");
  const customer = normalizePhone(pick(params, "Numéro présenté", "numero_presente", "caller", "callerid", "cli", "from", "presente"));
  const start = pick(params, "Début d'appel", "debut_appel", "debut", "date", "start", "starttime", "datetime", "timestamp");
  const duration = pick(params, "Durée réelle", "duree", "duration");

  const uniq = (xs: string[]) => [...new Set(xs.map((x) => normalizePhone(x)).filter(Boolean))];
  return {
    type: rawType ? eventType(rawType) : "unknown",
    rawType,
    callRef: pick(params, "callref", "call_ref", "callid", "call_id", "id_appel", "session_id", "uniqueid") || null,
    customer,
    adviserCandidates: uniq([account, appele, callee]),
    lineCandidates: uniq([appelant, callee, account]),
    startedAt: start ? parisWallClock(start) : null,
    durationSeconds: duration && /^\d+$/.test(duration) ? Number(duration) : null,
    dref: pick(params, "dref") || null,
  };
}
