// src/lib/azzur.ts
//
// Pushes recorded calls to the AZZUR CRM "mise en relation" (MER) web service so
// they appear in AZZUR's dispatch board (or directly in an adviser's space).
//
// Design rules, in order of importance:
//   1. NEVER break or slow call logging. Everything here is fire-and-forget:
//      `scheduleAzzurPush` returns immediately, hands the work to the platform's
//      `waitUntil` (so Vercel keeps the function alive to finish it) and swallows
//      every error. A slow or down AZZUR costs nothing but a log line.
//   2. Off by default. Nothing is sent unless AZZUR_WEBHOOK_ENABLED=true AND
//      AZZUR_MER_URL is set.
//   3. The URL carries a secret (`cle_ws`). It lives only in the environment, is
//      never written to the repository, and is redacted from every log line.
//   4. Only NEW calls are pushed (callers pass what they just created), and only
//      recent ones: pushing a month-old backlog into a CRM would create stale
//      fiches, so calls older than AZZUR_MER_MAX_AGE_HOURS are skipped.
//
// The exact field names AZZUR's MER service expects are documented behind the
// MER URL itself, not in this repository, so the defaults below are a best guess
// and every one of them can be renamed — or switched off with "" — through
// AZZUR_MER_FIELDS (JSON) without touching code.
import { waitUntil } from "@vercel/functions";
import { normalizePhone } from "@/lib/phone";

/** What the caller knows about a freshly recorded call. */
export type AzzurCallEvent = {
  /** Stable id for the logs: the call id, or "import:<batch>#<row>". */
  reference: string;
  callerNumber: string;
  startedAt: Date;
  isMissed: boolean;
  /** Label of the standard line the call entered on, e.g. "Ligne santé CPA". */
  lineLabel: string | null;
  /** The adviser who answered, when there is one. */
  conseiller: { email: string; nom: string; prenom: string } | null;
};

export type AzzurConfig = {
  enabled: boolean;
  /** Enabled AND a usable URL is configured. */
  ready: boolean;
  url: URL | null;
  method: "POST" | "GET";
  format: "form" | "json";
  fields: Record<FieldKey, string>;
  timeoutMs: number;
  maxAgeHours: number;
  onlyAnswered: boolean;
  /** Why it is not ready, for the status endpoint. */
  problem: string | null;
};

type FieldKey = "telephone" | "provenance" | "conseiller" | "conseiller_nom" | "date";

const DEFAULT_FIELDS: Record<FieldKey, string> = {
  telephone: "telephone",
  provenance: "provenance",
  conseiller: "conseiller",
  conseiller_nom: "conseiller_nom",
  date: "date",
};

function isTrue(value: string | undefined): boolean {
  return ["true", "1", "yes", "oui", "on"].includes((value ?? "").trim().toLowerCase());
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Reads the integration settings. Pure: pass an env object to test it. */
export function readAzzurConfig(env: Record<string, string | undefined> = process.env): AzzurConfig {
  const enabled = isTrue(env.AZZUR_WEBHOOK_ENABLED);
  let url: URL | null = null;
  let problem: string | null = null;

  const rawUrl = (env.AZZUR_MER_URL ?? "").trim();
  if (rawUrl) {
    try {
      url = new URL(rawUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocole");
      // Lets the provenance be changed without re-pasting the secret key.
      const idProv = (env.AZZUR_MER_ID_PROV ?? "").trim();
      if (idProv) url.searchParams.set("id_prov", idProv);
    } catch {
      url = null;
      problem = "AZZUR_MER_URL n'est pas une URL valide";
    }
  } else if (enabled) {
    problem = "AZZUR_MER_URL n'est pas défini";
  }

  let fields = { ...DEFAULT_FIELDS };
  const rawFields = (env.AZZUR_MER_FIELDS ?? "").trim();
  if (rawFields) {
    try {
      const parsed = JSON.parse(rawFields) as Record<string, unknown>;
      for (const key of Object.keys(DEFAULT_FIELDS) as FieldKey[]) {
        if (typeof parsed[key] === "string") fields[key] = parsed[key] as string;
      }
    } catch {
      problem = problem ?? "AZZUR_MER_FIELDS n'est pas un JSON valide (valeurs par défaut utilisées)";
      fields = { ...DEFAULT_FIELDS };
    }
  }

  return {
    enabled,
    ready: enabled && url !== null,
    url,
    method: (env.AZZUR_MER_METHOD ?? "").trim().toUpperCase() === "GET" ? "GET" : "POST",
    format: (env.AZZUR_MER_FORMAT ?? "").trim().toLowerCase() === "json" ? "json" : "form",
    fields,
    timeoutMs: positiveInt(env.AZZUR_MER_TIMEOUT_MS, 5000),
    maxAgeHours: positiveInt(env.AZZUR_MER_MAX_AGE_HOURS, 48),
    onlyAnswered: isTrue(env.AZZUR_MER_ONLY_ANSWERED),
    problem,
  };
}

/** "2026-10-22 15:33:31" in Paris time, the shape PHP back-offices usually parse. */
function formatParisDate(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * The fields sent for one call. The number goes out complete (never masked), in
 * national form (0687814485) so "+33 6 87 81 44 85" and "0687814485" reach the
 * CRM identically — which is also what lets AZZUR's own duplicate detection work.
 * Without an adviser the conseiller fields are simply omitted, which leaves the
 * fiche for manual dispatch.
 */
export function buildAzzurPayload(event: AzzurCallEvent, config: AzzurConfig): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: FieldKey, value: string) => {
    const name = config.fields[key];
    if (name) out[name] = value; // "" in AZZUR_MER_FIELDS switches the field off
  };

  put("telephone", normalizePhone(event.callerNumber));
  put("provenance", event.lineLabel ? `Appel entrant - ${event.lineLabel}` : "Appel entrant");
  put("date", formatParisDate(event.startedAt));
  if (event.conseiller) {
    put("conseiller", event.conseiller.email);
    put("conseiller_nom", `${event.conseiller.prenom} ${event.conseiller.nom}`.trim());
  }
  return out;
}

/** Strips the secret key (and any other query-string secret) from text bound for the logs. */
export function redactSecrets(text: string): string {
  return text.replace(/(cle_ws=)[^&\s"']+/gi, "$1***");
}

/** Keeps the last 3 digits only: enough to find a call, not a phone book in the logs. */
function maskForLog(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 3 ? `${"*".repeat(digits.length - 3)}${digits.slice(-3)}` : "***";
}

export type PushResult = {
  reference: string;
  outcome: "sent" | "skipped" | "failed";
  status?: number;
  attempts?: number;
  detail: string;
  at: string;
};

/** Last results seen by THIS server instance, for the admin status endpoint. */
const recent: PushResult[] = [];
function remember(result: PushResult) {
  recent.unshift(result);
  if (recent.length > 25) recent.pop();
}
export function recentAzzurResults(): PushResult[] {
  return [...recent];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FetchLike = typeof fetch;

/**
 * Sends one call. Never throws: every outcome is a PushResult and a log line.
 * Retries twice (0.5 s, 1.5 s) on a timeout, a network error, a 429 or a 5xx;
 * any other answer — including 4xx, which a retry cannot fix — is final.
 */
export async function pushCallToAzzur(
  event: AzzurCallEvent,
  options: { config?: AzzurConfig; fetchImpl?: FetchLike; now?: Date } = {}
): Promise<PushResult> {
  const config = options.config ?? readAzzurConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const finish = (r: Omit<PushResult, "reference" | "at">): PushResult => {
    const result: PushResult = { reference: event.reference, at: new Date().toISOString(), ...r };
    remember(result);
    const line = `[azzur] ${result.outcome} ref=${event.reference} tel=${maskForLog(event.callerNumber)}` +
      `${result.status ? ` status=${result.status}` : ""}${result.attempts ? ` attempts=${result.attempts}` : ""}` +
      ` ${result.detail}`;
    if (result.outcome === "failed") console.error(redactSecrets(line));
    else console.log(redactSecrets(line));
    return result;
  };

  try {
    if (!config.ready || !config.url) return finish({ outcome: "skipped", detail: "intégration désactivée" });
    if (!normalizePhone(event.callerNumber)) return finish({ outcome: "skipped", detail: "numéro absent ou masqué" });
    if (config.onlyAnswered && event.isMissed) return finish({ outcome: "skipped", detail: "appel manqué" });
    const ageHours = (now.getTime() - event.startedAt.getTime()) / 3_600_000;
    if (ageHours > config.maxAgeHours) {
      return finish({ outcome: "skipped", detail: `appel trop ancien (${Math.round(ageHours)} h > ${config.maxAgeHours} h)` });
    }

    const payload = buildAzzurPayload(event, config);
    const url = new URL(config.url.toString());
    let body: string | undefined;
    const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };

    if (config.method === "GET") {
      for (const [k, v] of Object.entries(payload)) url.searchParams.set(k, v);
    } else if (config.format === "json") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(payload).toString();
    }

    const delays = [500, 1500];
    let lastDetail = "";
    for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const res = await fetchImpl(url, { method: config.method, headers, body, signal: controller.signal, redirect: "follow" });
        const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
        if (res.ok) return finish({ outcome: "sent", status: res.status, attempts: attempt, detail: `réponse: ${text || "(vide)"}` });
        lastDetail = `HTTP ${res.status} réponse: ${text || "(vide)"}`;
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) return finish({ outcome: "failed", status: res.status, attempts: attempt, detail: lastDetail });
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        lastDetail = aborted ? `délai dépassé (${config.timeoutMs} ms)` : `erreur réseau: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        clearTimeout(timer);
      }
      if (attempt <= delays.length) await sleep(delays[attempt - 1]);
    }
    return finish({ outcome: "failed", attempts: delays.length + 1, detail: lastDetail });
  } catch (error) {
    // Anything unforeseen (bad data, a bug here) must still be contained.
    return finish({ outcome: "failed", detail: `erreur interne: ${error instanceof Error ? error.message : String(error)}` });
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<unknown>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(runners);
}

/**
 * The entry point for the routes: schedules the pushes and returns AT ONCE.
 * Cheap when the integration is off (one env read, no allocation of work).
 * `waitUntil` keeps a serverless function alive until the pushes finish without
 * making the response wait for them.
 */
export function scheduleAzzurPush(events: AzzurCallEvent[]): void {
  try {
    if (!events.length) return;
    const config = readAzzurConfig();
    if (!config.ready) return;

    const work = pool(events, 4, (event) => pushCallToAzzur(event, { config })).catch((error) =>
      console.error(redactSecrets(`[azzur] erreur inattendue: ${error instanceof Error ? error.message : String(error)}`))
    );
    try {
      waitUntil(work);
    } catch {
      // Not on a platform that supports it (local `next start`): the promise
      // simply keeps running in this process.
    }
  } catch (error) {
    console.error(redactSecrets(`[azzur] planification impossible: ${error instanceof Error ? error.message : String(error)}`));
  }
}
