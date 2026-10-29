// src/lib/azzurRouting.ts
//
// Which AZZUR endpoint a call goes to. Pure (no database, no request).
//
// AZZUR is reached through four links, one per team and product:
//
//   AUTO_ALM   SANTE_ALM   AUTO_CPA   SANTE_CPA
//
// The key comes from the ADVISER who took the call: their team name carries both
// halves ("Équipe auto CPA" -> CPA + Auto). If the team names only one half, or none,
// the label of the line the call arrived on ("Ligne santé CPA") fills the gap.
//
// There is NO default link. A category whose link has not been configured on
// /admin/azzur — and a call whose team cannot be placed at all — has no destination:
// nothing is sent for it, and the calls stay in the local database for the admin to
// review. Configuring a link is the only thing that makes a category sendable.
import { entityOfTeamName, subTeamOfTeamName } from "@/lib/entity";

export const ROUTE_KEYS = ["AUTO_ALM", "SANTE_ALM", "AUTO_CPA", "SANTE_CPA"] as const;
export type RouteKey = (typeof ROUTE_KEYS)[number];

export const ROUTE_LABEL: Record<RouteKey, string> = {
  AUTO_ALM: "AUTO ALM",
  SANTE_ALM: "SANTÉ ALM",
  AUTO_CPA: "AUTO CPA",
  SANTE_CPA: "SANTÉ CPA",
};

/** Raw settings: a full MER URL or a bare id_prov per key; missing or empty = main link. */
export type RouteSettings = Partial<Record<RouteKey, string>>;

export function isRouteKey(value: unknown): value is RouteKey {
  return typeof value === "string" && (ROUTE_KEYS as readonly string[]).includes(value);
}

/** The link a call belongs to, or null when its team and line do not say. */
export function routeKeyFor(
  teamName: string | null | undefined,
  lineLabel: string | null | undefined
): RouteKey | null {
  const entity = entityOfTeamName(teamName) ?? entityOfTeamName(lineLabel);
  const product = subTeamOfTeamName(teamName) ?? subTeamOfTeamName(lineLabel);
  if (!entity || !product) return null;
  return `${product}_${entity}` as RouteKey;
}

/** Host and path plus id_prov: what may be shown. The secret key is never included. */
export function describeUrl(url: URL): string {
  const idProv = url.searchParams.get("id_prov");
  return `${url.host}${url.pathname}${idProv ? ` (id_prov=${idProv})` : ""}`;
}

/** Servers a link may point at unless AZZUR_MER_ALLOWED_HOSTS says otherwise. */
export const DEFAULT_ALLOWED_HOSTS = [
  // AZZUR MER web service
  "www.gestfiches.com", "gestfiches.com",
  // Supplier lead scripts of the ProAssur / ALM CRMs (…/leads_cpa/FournisseurA8003/A4.php)
  "gestion-proassur.fr", "www.gestion-proassur.fr",
  "gestion-alm.com", "www.gestion-alm.com",
];

/**
 * Hosts a link may use. Customer phone numbers are posted to it, so a typo or a hostile
 * paste must not be able to send them elsewhere. AZZUR_MER_ALLOWED_HOSTS (comma separated,
 * host[:port]) replaces the default; the host of the optional reference AZZUR_MER_URL is
 * always allowed too.
 */
export function allowedHosts(env: Record<string, string | undefined> = process.env): string[] {
  const configured = (env.AZZUR_MER_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const hosts = configured.length ? configured : [...DEFAULT_ALLOWED_HOSTS];
  try {
    const reference = (env.AZZUR_MER_URL ?? "").trim();
    if (reference) hosts.push(new URL(reference).host.toLowerCase());
  } catch {
    // An unparseable reference URL adds nothing.
  }
  return [...new Set(hosts)];
}

// ── Template links ───────────────────────────────────────────────────────────────────
// Besides AZZUR MER, a link can be a TEMPLATE: any GET URL whose query values contain
// variables, filled in for each lead, e.g. the ProAssur supplier script
//   https://gestion-proassur.fr/leads_cpa/FournisseurA8003/A4.php?TelGsmTxt=$telephone&Conseiller=$conseiller
// Only what the template asks for is sent — none of the MER parameters.

/** Variables a template may use, with what they become. */
export const TEMPLATE_VARIABLES: Record<string, string> = {
  telephone: "numéro de l'appelant, complet, forme 06…",
  conseiller: "prénom et nom du conseiller qui a reçu l'appel",
  conseiller_email: "e-mail du conseiller",
  nom: "nom de la fiche (« Appel Assurpilot »)",
  prenom: "prénom de la fiche (« reçu par <conseiller> »)",
  date: "date et heure de l'appel (AAAA-MM-JJ HH:MM:SS, Paris)",
  ligne: "ligne d'arrivée (« Ligne santé CPA »)",
  commentaire: "« Appel entrant - … : coordonnées à compléter »",
  id: "identifiant de l'appel dans Assurpilot",
  id_us: "ID_US ProAssur du conseiller (Intégration ProAssur ou fiche du conseiller)",
  id_eq: "ID_EQ ProAssur du conseiller (son équipe ProAssur), sinon celui de son équipe Auto",
};

const VARIABLE_RE = /\$([a-z_]+)/g;

export function isTemplate(raw: string): boolean {
  return /\$[a-z_]+/.test(raw);
}

/** The variables a template uses, in order. */
export function templateVariables(raw: string): string[] {
  return [...raw.matchAll(VARIABLE_RE)].map((m) => m[1]);
}

/** Fills a template with the values of one lead. Values are URL-encoded by URLSearchParams. */
export function fillTemplateUrl(template: string, values: Record<string, string>): URL {
  const url = new URL(template);
  const filled = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    filled.append(key, value.replace(VARIABLE_RE, (_, name: string) => values[name] ?? ""));
  }
  url.search = filled.toString();
  return url;
}

export type ParsedRoute = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates what an administrator typed for one link.
 *   ""                         clears it: the category then has no destination and sends nothing
 *   "https://…?A=$telephone"   a TEMPLATE (see above): allowed host, known variables, $telephone
 *                              required, variables only in the query string
 *   "https://…/ws/index.php…"  an AZZUR MER URL, which must carry id_prov and cle_ws
 */
export function parseRouteValue(raw: string, hosts: string[]): ParsedRoute {
  const value = raw.trim();
  if (!value) return { ok: true, value: "" };
  if (/^\d+$/.test(value)) {
    return { ok: false, error: "Collez l'URL complète : un id_prov seul ne suffit pas." };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Ce n'est pas une URL valide." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "L'URL doit commencer par https://" };
  if (!hosts.includes(url.host.toLowerCase())) {
    return { ok: false, error: `Serveur non autorisé (${url.host}). Autorisés : ${hosts.join(", ")}.` };
  }

  if (isTemplate(value)) {
    if (isTemplate(url.origin + url.pathname)) {
      return { ok: false, error: "Les variables ($telephone…) ne peuvent être que dans les paramètres, après le « ? »." };
    }
    const unknown = templateVariables(value).filter((v) => !(v in TEMPLATE_VARIABLES));
    if (unknown.length) {
      return { ok: false, error: `Variable(s) inconnue(s) : ${unknown.map((v) => "$" + v).join(", ")}. Disponibles : ${Object.keys(TEMPLATE_VARIABLES).map((v) => "$" + v).join(", ")}.` };
    }
    if (!templateVariables(value).includes("telephone")) {
      return { ok: false, error: "Le modèle doit contenir $telephone (par ex. ?TelGsmTxt=$telephone)." };
    }
    return { ok: true, value };
  }

  const key = url.searchParams.get("cle_ws");
  if (!key || key.includes("*")) {
    return {
      ok: false,
      error: "Lien AZZUR MER : l'URL doit contenir la clé complète (cle_ws=…). Pour un script fournisseur (ProAssur…), " +
        "ajoutez les variables, par ex. …/A4.php?TelGsmTxt=$telephone&Conseiller=$conseiller",
    };
  }
  if (!url.searchParams.get("id_prov")) return { ok: false, error: "Lien AZZUR MER : l'URL doit contenir id_prov=…" };
  return { ok: true, value: url.toString() };
}

export type Endpoint = {
  /** Where to send, or null when this category has no usable link: nothing is sent. */
  url: URL | null;
  /** "mer": AZZUR MER (its parameters are added); "template": only the template's own query. */
  kind: "mer" | "template" | null;
  /** The raw template, for kind "template". */
  template: string | null;
  /** The category, or null when the call's team and product could not be placed. */
  routeKey: RouteKey | null;
  /** Why there is no destination, when there is none. */
  why: string | null;
};

/** Picks the destination for a call. Never throws, never borrows another category's link. */
export function resolveEndpoint(routeKey: RouteKey | null, routes: RouteSettings): Endpoint {
  const none = (why: string): Endpoint => ({ url: null, kind: null, template: null, routeKey, why });
  if (!routeKey) return none("équipe ou produit du conseiller non identifié");

  const raw = (routes[routeKey] ?? "").trim();
  if (!raw) return none(`lien ${ROUTE_LABEL[routeKey]} non configuré`);

  try {
    const url = new URL(raw);
    if (isTemplate(raw)) {
      if (!templateVariables(raw).includes("telephone")) throw new Error("no phone");
      return { url, kind: "template", template: raw, routeKey, why: null };
    }
    if (!url.searchParams.get("cle_ws") || !url.searchParams.get("id_prov")) throw new Error("incomplete");
    return { url, kind: "mer", template: null, routeKey, why: null };
  } catch {
    return none(`lien ${ROUTE_LABEL[routeKey]} invalide`);
  }
}

/** What may be shown of a destination: host, path, and for a template its parameters with their variables. */
export function describeEndpoint(ep: Endpoint): string | null {
  if (!ep.url) return null;
  if (ep.kind !== "template") return describeUrl(ep.url);
  // Values that are not variables (a supplier code, a key…) are masked.
  const params = [...ep.url.searchParams].map(([k, v]) => `${k}=${isTemplate(v) ? v : "***"}`).join("&");
  return `${ep.url.host}${ep.url.pathname}?${params}`;
}
