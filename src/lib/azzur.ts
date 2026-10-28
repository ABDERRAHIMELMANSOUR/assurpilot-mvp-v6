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
//   2. Off by default. Nothing is sent unless AZZUR_WEBHOOK_ENABLED=true AND the call's
//      category has a link configured on /admin/azzur (there is no default link). And no
//      send is ever triggered by a call being saved unless AZZUR_AUTO_PUSH=true.
//   3. The URL carries a secret (`cle_ws`). It lives only in the environment, is
//      never written to the repository, and is redacted from every log line.
//   4. Only NEW calls are pushed (callers pass what they just created), and only
//      recent ones: pushing a month-old backlog into a CRM would create stale
//      fiches, so calls older than AZZUR_MER_MAX_AGE_HOURS are skipped.
//
// The field names AZZUR's MER service expects are those of its own documentation
// (see DEFAULT_FIELDS); each can be renamed — or switched off with "" — through
// AZZUR_MER_FIELDS (JSON) without touching code.
import { waitUntil } from "@vercel/functions";
import { normalizePhone } from "@/lib/phone";
import { entityOfTeamName } from "@/lib/entity";
import { fillTemplateUrl, resolveEndpoint, routeKeyFor, type RouteKey, type RouteSettings } from "@/lib/azzurRouting";

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
  conseiller: { id?: string; email: string; nom: string; prenom: string } | null;
  /** The call's id on our side, sent as num_devis_initial (24 characters at most). */
  externalId?: string;
  /** Name of the adviser's team ("Équipe auto CPA"): decides which AZZUR link the call goes to. */
  teamName?: string | null;
};

export type AzzurConfig = {
  enabled: boolean;
  /**
   * The master switch is on. Whether a given call can actually go out also depends on
   * its category having a link configured (see azzurRouting.ts): there is no default link.
   */
  ready: boolean;
  /** AZZUR_MER_URL, kept ONLY as a reference to read AZZUR's documentation. Never a destination. */
  url: URL | null;
  /**
   * Automatic pushes (a call being saved triggers a send). Off unless AZZUR_AUTO_PUSH=true:
   * for now calls are only stored locally and sent from the review on /admin/azzur.
   */
  autoPush: boolean;
  method: "POST" | "GET";
  /** AZZUR's `retour_ws` (json | text). null = not sent: the service defaults to text. */
  retourWs: "json" | "text" | null;
  format: "form" | "json";
  fields: Record<FieldKey, string>;
  /** Stand-ins for contact data Assurpilot does not hold but AZZUR requires. */
  placeholders: { nom: string; prenom: string; date_naissance: string; code_postal: string };
  /** Adviser e-mail (lower case) -> AZZUR id_user, so the fiche lands in that adviser's space. */
  userMap: Record<string, string>;
  /**
   * Assurpilot user id -> AZZUR id_user, entered per adviser on /admin/azzur. AZZUR's MER only
   * accepts its own numeric user id (not a name), so this is what puts the fiche in the right
   * adviser's space. Takes precedence over the e-mail map of AZZUR_MER_USER_MAP.
   */
  userMapById: Record<string, string>;
  /** AZZUR_MER_ID_USER, honoured only as "0" (nobody). Unidentified calls get "0" anyway. */
  defaultUserId: string | null;
  /**
   * Default id_user per AZZUR space, set on /admin/azzur. Each space (ALM, CPA) numbers its users
   * on its own, so one default cannot serve both. Without one, id_user=0 (nobody).
   */
  defaultUserIds: Partial<Record<RouteKey, string>>;
  /** Value of the provenance field: AZZUR's provenance CODE, e.g. "AE" (id 51). */
  provenance: string;
  timeoutMs: number;
  maxAgeHours: number;
  onlyAnswered: boolean;
  /** Why it is not ready, for the status endpoint. */
  problem: string | null;
};

type FieldKey =
  | "telephone" | "portable" | "nom" | "prenom" | "date_naissance" | "code_postal" | "observation"
  | "date" | "id_user" | "num_devis_initial"
  // Not AZZUR variables (the provenance is id_prov in the URL): off by default, kept
  // so they can be switched on if AZZUR ever documents them.
  | "provenance" | "ligne" | "conseiller" | "conseiller_nom";

// AZZUR's own variable names, from the "Liste des variables GET" of its MER
// documentation (v1.9.6.64). Each can still be renamed — or switched off with "" —
// in AZZUR_MER_FIELDS.
const DEFAULT_FIELDS: Record<FieldKey, string> = {
  telephone: "tel",                 // Téléphone (14 car.)
  portable: "port",                 // Portable (14 car.)
  nom: "nom",                       // OBLIGATOIRE (50 car.)
  prenom: "prenom",                 // (50 car.)
  date_naissance: "date_naissance", // OBLIGATOIRE, aaaa-mm-jj
  code_postal: "cp",                // OBLIGATOIRE, 5 chiffres
  observation: "commentaire",       // commentaire bref du fournisseur (255 car.)
  date: "date_cotation",            // date/heure de création chez le fournisseur, aaaa-mm-jj hh:mm:ss
  id_user: "id_user",               // identifiant AZZUR de l'utilisateur (0 = aucun)
  num_devis_initial: "num_devis_initial", // identifiant de la fiche chez le fournisseur (24 car.)
  provenance: "",
  ligne: "",
  conseiller: "",
  conseiller_nom: "",
};

function isTrue(value: string | undefined): boolean {
  return ["true", "1", "yes", "oui", "on"].includes((value ?? "").trim().toLowerCase());
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * AZZUR refuses a fiche without a name, a date of birth and a postal code, none
 * of which a phone call carries. These placeholders let the fiche in so the
 * adviser can complete it; they are deliberately obvious stand-ins (a 1900 birth
 * date, postal code 00000) so they can never pass for real data, and the fiche
 * says so in its observation. Override or blank each one with AZZUR_MER_DEFAULTS.
 */
// nom / prenom may use {telephone} (the caller's number, 0612345678), {conseiller}
// (who received the call on Assurpilot, or "non attribué"), {ligne} and {date}.
// By default a fiche reads Nom "APE", Prénom = the caller's number, so the adviser
// finds it in AZZUR by the number they just spoke to.
const DEFAULT_PLACEHOLDERS = {
  nom: "APE",
  prenom: "{telephone}",
  date_naissance: "1900-01-01", // AZZUR wants aaaa-mm-jj
  code_postal: "00000",
};

/** Cuts to AZZUR's documented maximum length for a field. */
function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Fills {telephone} / {conseiller} / {ligne} / {date} in a placeholder template. */
function fillTemplate(template: string, event: AzzurCallEvent): string {
  const who = event.conseiller ? `${event.conseiller.prenom} ${event.conseiller.nom}`.trim() : "non attribué";
  return template
    // Same national form as the tel / port fields; a withheld number says so rather than leaving a blank.
    .replace(/\{telephone\}/g, normalizePhone(event.callerNumber) || "numéro masqué")
    .replace(/\{conseiller\}/g, who)
    .replace(/\{ligne\}/g, event.lineLabel ?? "")
    .replace(/\{date\}/g, formatParisDate(event.startedAt))
    .trim();
}

function readUserMap(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw?.trim()) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [email, id] of Object.entries(parsed)) {
      if (/^\d+$/.test(String(id))) out[email.trim().toLowerCase()] = String(id);
    }
  } catch {
    // Bad JSON: no mapping, fiches go to AZZUR's default user.
  }
  return out;
}

function readPlaceholders(raw: string | undefined): AzzurConfig["placeholders"] {
  const out = { ...DEFAULT_PLACEHOLDERS };
  if (!raw?.trim()) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(out) as (keyof typeof out)[]) {
      if (typeof parsed[key] === "string") out[key] = parsed[key] as string;
    }
  } catch {
    // Bad JSON: keep the defaults rather than sending fiches AZZUR will refuse.
  }
  return out;
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
      problem = "AZZUR_MER_URL (lien de référence pour la documentation) n'est pas une URL valide";
    }
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
    ready: enabled,
    url,
    autoPush: isTrue(env.AZZUR_AUTO_PUSH),
    // The MER service is documented as REST GET, so GET is the default.
    method: (env.AZZUR_MER_METHOD ?? "").trim().toUpperCase() === "POST" ? "POST" : "GET",
    retourWs: ["json", "text"].includes((env.AZZUR_MER_RETOUR_WS ?? "").trim().toLowerCase())
      ? ((env.AZZUR_MER_RETOUR_WS ?? "").trim().toLowerCase() as "json" | "text")
      : null,
    format: (env.AZZUR_MER_FORMAT ?? "").trim().toLowerCase() === "json" ? "json" : "form",
    fields,
    provenance: (env.AZZUR_MER_PROVENANCE ?? "").trim() || "AE",
    placeholders: readPlaceholders(env.AZZUR_MER_DEFAULTS),
    userMap: readUserMap(env.AZZUR_MER_USER_MAP),
    userMapById: {},
    defaultUserIds: {},
    // Only "0" is honoured: one user id cannot be valid in both AZZUR spaces (see resolveAzzurUserId).
    defaultUserId: (env.AZZUR_MER_ID_USER ?? "").trim() === "0" ? "0" : null,
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
/** The note left on a fiche: where the call came from, and that it must be completed. */
export function commentaireFor(event: AzzurCallEvent): string {
  return `Appel entrant${event.lineLabel ? ` - ${event.lineLabel}` : ""} du ${formatParisDate(event.startedAt)} (Assurpilot) : coordonnées à compléter`.slice(0, 255);
}

/** Values of the $variables of a template link (see TEMPLATE_VARIABLES in azzurRouting.ts). */
export function templateValues(event: AzzurCallEvent, config: AzzurConfig): Record<string, string> {
  const c = event.conseiller;
  return {
    telephone: normalizePhone(event.callerNumber),
    conseiller: c ? `${c.prenom} ${c.nom}`.trim() : "",
    conseiller_email: c?.email ?? "",
    nom: fillTemplate(config.placeholders.nom, event),
    prenom: fillTemplate(config.placeholders.prenom, event),
    date: formatParisDate(event.startedAt),
    ligne: event.lineLabel ?? "",
    commentaire: commentaireFor(event),
    id: event.externalId ?? event.reference.replace(/^call:/, ""),
  };
}

export type AzzurUserIdSource = "conseiller" | "defaut-espace" | "aucun";

/** id_user that files a fiche under nobody: AZZUR's documented value for "no user given". */
export const AZZUR_NO_USER = "0";

/**
 * The AZZUR id_user a call is filed under, and why. ALWAYS a value: AZZUR files a fiche that
 * comes WITHOUT id_user under the default user of its back office — one individual adviser
 * (Manuel MORA on the CPA space), who then received every fiche nobody could attribute. So:
 *   1. the Id of the adviser who took the call — only if that adviser's team is in the SAME
 *      space (ALM / CPA) as the link: each space numbers its users on its own (47 is Frédéric
 *      BAUMANN on ALM and Adam PEREZ on CPA), so an Id is never sent to the other space, and an
 *      adviser without an ALM/CPA team cannot be placed safely;
 *   2. otherwise the default id_user of that space, set on /admin/azzur;
 *   3. otherwise AZZUR_MER_ID_USER, but only "0": a single number cannot be right for both spaces;
 *   4. otherwise "0": no individual attribution, never AZZUR's default adviser.
 */
export function resolveAzzurUserId(
  event: Pick<AzzurCallEvent, "conseiller" | "teamName" | "lineLabel">,
  config: Pick<AzzurConfig, "userMapById" | "userMap" | "defaultUserIds" | "defaultUserId">
): { id: string; source: AzzurUserIdSource; why: string } {
  const digits = (v: string | undefined | null) => (v && /^\d+$/.test(v.trim()) ? v.trim() : undefined);
  const key = routeKeyFor(event.teamName ?? null, event.lineLabel ?? null);
  const space = key ? (key.endsWith("_ALM") ? "ALM" : "CPA") : null;
  const adviserSpace = entityOfTeamName(event.teamName);
  const mapped = event.conseiller
    ? digits(event.conseiller.id ? config.userMapById[event.conseiller.id] : undefined) ??
      digits(config.userMap[event.conseiller.email.trim().toLowerCase()])
    : undefined;

  let why: string;
  if (!event.conseiller) why = "appel sans conseiller";
  else if (!mapped) why = "conseiller sans Id AZZUR";
  else if (!adviserSpace) why = "conseiller sans équipe ALM/CPA : son Id ne peut pas être rattaché à un espace";
  else if (adviserSpace !== space) why = `Id du conseiller valable dans l'espace ${adviserSpace}, pas ${space ?? "inconnu"}`;
  else return { id: mapped, source: "conseiller", why: "Id du conseiller qui a pris l'appel" };

  const spaceDefault = key ? digits(config.defaultUserIds?.[key]) : undefined;
  if (spaceDefault) return { id: spaceDefault, source: "defaut-espace", why: `${why} : id_user par défaut de l'espace` };
  return { id: AZZUR_NO_USER, source: "aucun", why: `${why} : id_user=0, fiche non attribuée` };
}

export function buildAzzurPayload(event: AzzurCallEvent, config: AzzurConfig): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: FieldKey, value: string) => {
    const name = config.fields[key];
    if (name) out[name] = value; // "" in AZZUR_MER_FIELDS switches the field off
  };

  // The number goes out as BOTH tel and port: AZZUR accepts either, and a call
  // does not say whether it came from a landline or a mobile.
  const phone = clip(normalizePhone(event.callerNumber), 14);
  put("telephone", phone);
  put("portable", phone);
  // Contact data a call does not carry but AZZUR requires (see DEFAULT_PLACEHOLDERS).
  for (const key of ["nom", "prenom", "date_naissance", "code_postal"] as const) {
    const value = fillTemplate(config.placeholders[key], event);
    if (value) put(key, key === "nom" || key === "prenom" ? clip(value, 50) : value);
  }
  put(
    "observation",
    clip(`Appel entrant${event.lineLabel ? ` - ${event.lineLabel}` : ""} du ${formatParisDate(event.startedAt)} (Assurpilot) : coordonnées à compléter`, 255)
  );
  put("date", formatParisDate(event.startedAt));
  if (event.externalId) put("num_devis_initial", clip(event.externalId, 24));

  // The adviser, as AZZUR knows them: its own user id, never ours — and always sent, "0" when
  // nobody is identified, so AZZUR never falls back to its own default adviser.
  put("id_user", resolveAzzurUserId(event, config).id);

  // Only meaningful if AZZUR documents them (off by default).
  put("provenance", config.provenance);
  if (event.lineLabel) put("ligne", event.lineLabel);
  if (event.conseiller) {
    put("conseiller", event.conseiller.email);
    put("conseiller_nom", `${event.conseiller.prenom} ${event.conseiller.nom}`.trim());
  }
  return out;
}

/** Offset of Europe/Paris from UTC at the given instant, in ms (DST-aware). */
function parisOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * [start, end) of the current calendar day in Paris, as instants. "Today" must
 * be the business's day, not the server's: Vercel runs in UTC, so a plain
 * setHours(0) would cut the day two hours off in summer.
 */
export function parisDayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const midnight = (day: number) => {
    const guess = Date.UTC(get("year"), get("month") - 1, day);
    // One correction pass is enough: DST changes at night, never at midnight.
    return new Date(guess - parisOffsetMs(new Date(guess - parisOffsetMs(new Date(guess)))));
  };
  return { start: midnight(get("day")), end: midnight(get("day") + 1) };
}

/** Runs `worker` over `items` with at most `limit` in flight, keeping input order in the result. */
export async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i]);
      }
    })
  );
  return out;
}

/** Readable text of an HTML page: no scripts, styles or tags, single-spaced. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips the secret key (and any other query-string secret) from text bound for the logs. */
export function redactSecrets(text: string, secret?: string | null | Array<string | null>): string {
  let out = text.replace(/(cle_ws=)[^&\s"']+/gi, "$1***");
  // AZZUR's documentation page prints the key on its own too (not only as cle_ws=),
  // so every configured key (the main one and each team's) is removed wherever it appears.
  for (const s of Array.isArray(secret) ? secret : [secret]) {
    if (s && s.length >= 8) out = out.split(s).join("***");
  }
  return out;
}

/** The configured cle_ws, for redaction. */
export function azzurSecret(config: { url: URL | null }): string | null {
  return config.url?.searchParams.get("cle_ws") ?? null;
}

/** Keeps the last 3 digits only: enough to find a call, not a phone book in the logs. */
function maskForLog(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 3 ? `${"*".repeat(digits.length - 3)}${digits.slice(-3)}` : "***";
}

export type PushResult = {
  reference: string;
  /** duplicate: AZZUR already holds this lead — not an error, but nothing new was created. */
  outcome: "sent" | "duplicate" | "skipped" | "failed";
  status?: number;
  attempts?: number;
  detail: string;
  at: string;
  /** The link used (AUTO_ALM …), or "non classé" when the adviser's team could not be placed. */
  route?: string;
  /** Caller's number as sent (national form). */
  number?: string;
  /** Adviser who took the call, as known to Assurpilot. */
  adviserId?: string | null;
  adviserName?: string | null;
  /** id_user put in the MER request (AZZUR links only) and why that one. */
  idUser?: string | null;
  idUserWhy?: string;
  /** AZZUR's answer: the new fiche's id, or the EXISTING fiche's id on "DOUBLON:<id>". */
  azzurFicheId?: string | null;
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
  options: { config?: AzzurConfig; fetchImpl?: FetchLike; now?: Date; routes?: RouteSettings; ignoreMaxAge?: boolean } = {}
): Promise<PushResult> {
  const config = options.config ?? readAzzurConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  // Keys to scrub from anything shown or logged: the main one, plus the one of the
  // link actually used once it is known (each team has its own cle_ws).
  const secrets: Array<string | null> = [azzurSecret(config)];
  let routeName: string | undefined;
  let idUser: { id: string; why: string } | null = null;
  const finish = (r: Omit<PushResult, "reference" | "at">): PushResult => {
    // The detail can be AZZUR's documentation page, which contains the key: it is
    // scrubbed BEFORE it is stored or shown, not only before it is logged.
    const detail = redactSecrets(r.detail, secrets);
    const result: PushResult = {
      reference: event.reference, at: new Date().toISOString(), route: routeName, ...r,
      detail,
      number: normalizePhone(event.callerNumber),
      adviserId: event.conseiller?.id ?? null,
      adviserName: event.conseiller ? `${event.conseiller.prenom} ${event.conseiller.nom}`.trim() : null,
      idUser: idUser?.id ?? null,
      idUserWhy: idUser?.why,
      azzurFicheId: detail.match(/fiche créée, id (\d+)/)?.[1] ?? detail.match(/doublon\s*:\s*(\d+)/i)?.[1] ?? null,
    };
    remember(result);
    const line = `[azzur] ${result.outcome} ref=${event.reference}${routeName ? ` route=${routeName}` : ""} tel=${maskForLog(event.callerNumber)}` +
      `${result.status ? ` status=${result.status}` : ""}${result.attempts ? ` attempts=${result.attempts}` : ""}` +
      ` ${result.detail.length > 400 ? `${result.detail.slice(0, 400)}…` : result.detail}`;
    if (result.outcome === "failed") console.error(redactSecrets(line, secrets));
    else console.log(redactSecrets(line, secrets));
    return result;
  };

  try {
    if (!config.ready) return finish({ outcome: "skipped", detail: "intégration désactivée" });
    if (!normalizePhone(event.callerNumber)) return finish({ outcome: "skipped", detail: "numéro absent ou masqué" });
    if (config.onlyAnswered && event.isMissed) return finish({ outcome: "skipped", detail: "appel manqué" });
    const ageHours = (now.getTime() - event.startedAt.getTime()) / 3_600_000;
    // The age limit protects the AUTOMATIC push from flooding the CRM with history; a send the
    // administrator confirmed after a review is deliberate and is not second-guessed.
    if (!options.ignoreMaxAge && ageHours > config.maxAgeHours) {
      return finish({ outcome: "skipped", detail: `appel trop ancien (${Math.round(ageHours)} h > ${config.maxAgeHours} h)` });
    }

    const payload = buildAzzurPayload(event, config);
    // Which AZZUR link: the one of the adviser's team and product. There is no default:
    // without a configured link nothing is sent and the call stays in the local database.
    const endpoint = resolveEndpoint(routeKeyFor(event.teamName, event.lineLabel), options.routes ?? {});
    routeName = endpoint.routeKey ?? "non classé";
    if (!endpoint.url) {
      return finish({ outcome: "skipped", detail: `${endpoint.why} : fiche conservée localement, non envoyée` });
    }
    secrets.push(endpoint.url.searchParams.get("cle_ws"));
    const isTemplate = endpoint.kind === "template";
    let url = new URL(endpoint.url.toString());
    let method: "GET" | "POST" = config.method;
    let body: string | undefined;
    const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };

    if (isTemplate) {
      // A supplier script (ProAssur…): exactly the template's query, variables filled in,
      // and nothing else — the MER parameters mean nothing there.
      url = fillTemplateUrl(endpoint.template!, templateValues(event, config));
      method = "GET";
    } else {
    // Recorded with the result, so every fiche says which AZZUR user it was sent for.
    idUser = resolveAzzurUserId(event, config);
    // ws=mer selects the mise-en-relation service; the documentation lists it as
    // required, so it is always present whatever the configured URL says.
    url.searchParams.set("ws", "mer");
    if (config.retourWs) url.searchParams.set("retour_ws", config.retourWs);
    if (config.method === "GET") {
      for (const [k, v] of Object.entries(payload)) url.searchParams.set(k, v);
    } else if (config.format === "json") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(payload).toString();
    }
    }

    const delays = [500, 1500];
    let lastDetail = "";
    for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const res = await fetchImpl(url, { method, headers, body, signal: controller.signal, redirect: "follow" });
        const raw = await res.text().catch(() => "");
        const looksHtml = /html/i.test(res.headers.get("content-type") ?? "") || /^\s*<(!doctype|html)/i.test(raw);
        // AZZUR wraps even its short answers ("ERREUR : …", the fiche id) in a page.
        const pageText = looksHtml ? htmlToText(raw) : "";
        // An HTML page with a 200 is AZZUR's web-service documentation (or a login
        // page), not an answer to our request: nothing was inserted. Reporting it
        // as "sent" hid exactly that. Its text is kept, longer than a normal
        // answer, because it usually names the fields the service expects.
        if (isTemplate) {
          // A supplier script has no documented answer: its HTTP status decides, with its
          // own words as a safety net (an error or a duplicate said in a 200).
          const said = (looksHtml ? pageText : raw.replace(/\s+/g, " ").trim()).slice(0, 300);
          if (res.ok) {
            if (/doublon|d[ée]j[àa] (pr[ée]sent|existant|enregistr)/i.test(said)) {
              return finish({ outcome: "duplicate", status: res.status, attempts: attempt, detail: `déjà présent : ${said}` });
            }
            if (/\b(erreur|error|refus|invalide|manquant|interdit|forbidden)\b/i.test(said)) {
              return finish({ outcome: "failed", status: res.status, attempts: attempt, detail: `refusé : ${said}` });
            }
            return finish({ outcome: "sent", status: res.status, attempts: attempt, detail: `envoyé, réponse : ${said || "(vide)"}` });
          }
          lastDetail = `HTTP ${res.status} réponse: ${said || "(vide)"}`;
          if (!(res.status === 429 || res.status >= 500)) {
            return finish({ outcome: "failed", status: res.status, attempts: attempt, detail: lastDetail });
          }
        } else {
        if (looksHtml && pageText.length > 600) {
          return finish({
            outcome: "failed", status: res.status, attempts: attempt,
            detail: `AZZUR a renvoyé une page HTML, pas une confirmation : la requête n'a pas été prise en compte (champs ou paramètres non reconnus ?). Texte de la page : ${pageText.slice(0, 8000) || "(vide)"}`,
          });
        }
        const text = (looksHtml ? pageText : raw.replace(/\s+/g, " ").trim()).slice(0, 300);
        if (res.ok) {
          // AZZUR's documented default answers (text format): the fiche id on
          // success, "DOUBLON:identifiant" for a duplicate, otherwise a message
          // describing the error — all with HTTP 200, so the body decides. When
          // the answer format was customised we cannot tell, and trust the status.
          if (!config.retourWs) {
            if (/^\d+$/.test(text)) return finish({ outcome: "sent", status: res.status, attempts: attempt, detail: `fiche créée, id ${text}` });
            if (/^doublon/i.test(text)) return finish({ outcome: "duplicate", status: res.status, attempts: attempt, detail: `déjà dans AZZUR : ${text}` });
            return finish({ outcome: "failed", status: res.status, attempts: attempt, detail: `refusé par AZZUR : ${text || "(réponse vide)"}` });
          }
          return finish({ outcome: "sent", status: res.status, attempts: attempt, detail: `réponse: ${text || "(vide)"}` });
        }
        lastDetail = `HTTP ${res.status} réponse: ${text || "(vide)"}`;
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) return finish({ outcome: "failed", status: res.status, attempts: attempt, detail: lastDetail });
        }
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

    const work = (async () => {
      // The switches are read now, not at startup: "Envois automatiques" on /admin/azzur
      // (or AZZUR_AUTO_PUSH) decides, and by default calls are only saved locally and sent
      // on request from the review.
      const store = await import("@/lib/azzurRoutesStore");
      const { config } = await store.loadEffectiveConfig();
      if (!config.ready || !config.autoPush) return;

      // One lookup of the four links for the whole batch. If it fails, no link is known
      // and nothing is sent (the calls stay in the database).
      let routes: RouteSettings = {};
      try {
        routes = (await store.loadAzzurRoutes()).routes;
      } catch (error) {
        console.error(redactSecrets(`[azzur] liens par équipe illisibles, rien n'est envoyé: ${error instanceof Error ? error.message : String(error)}`));
      }
      const sends = await import("@/lib/azzurSendsStore");
      // A number already filed in AZZUR is not sent again: a second fiche would be a "Doublon
      // Fiche", which AZZUR files under ITS choice of user, not the adviser's.
      const already = await sends.alreadySent(events.map((e) => ({ number: normalizePhone(e.callerNumber), route: routeKeyFor(e.teamName, e.lineLabel) })));
      const fresh = events.filter((e) => !already.has(`${routeKeyFor(e.teamName, e.lineLabel)}|${normalizePhone(e.callerNumber)}`));
      const results: PushResult[] = [];
      await pool(fresh, 4, async (event) => { results.push(await pushCallToAzzur(event, { config, routes })); });
      await sends.recordAzzurSends(results);
    })().catch((error) =>
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
