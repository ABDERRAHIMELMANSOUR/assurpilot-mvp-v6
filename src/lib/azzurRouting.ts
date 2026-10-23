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
export const DEFAULT_ALLOWED_HOSTS = ["www.gestfiches.com", "gestfiches.com"];

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

export type ParsedRoute = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates what an administrator typed for one link.
 *   ""            clears it: the category then has no destination and sends nothing
 *   "https://…"   a full MER URL, which must carry id_prov and cle_ws and point at an
 *                 allowed host
 * A bare id_prov is not accepted any more: it only made sense relative to a default link.
 */
export function parseRouteValue(raw: string, hosts: string[]): ParsedRoute {
  const value = raw.trim();
  if (!value) return { ok: true, value: "" };
  if (/^\d+$/.test(value)) {
    return { ok: false, error: "Collez l'URL MER complète (avec id_prov et cle_ws) : un id_prov seul ne suffit plus." };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Ce n'est pas une URL valide." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "L'URL doit commencer par https://" };
  const key = url.searchParams.get("cle_ws");
  if (!key || key.includes("*")) {
    return { ok: false, error: "L'URL doit contenir la clé complète (cle_ws=…). Une clé masquée (***) ne convient pas." };
  }
  if (!url.searchParams.get("id_prov")) return { ok: false, error: "L'URL doit contenir id_prov=…" };
  if (!hosts.includes(url.host.toLowerCase())) {
    return { ok: false, error: `Serveur non autorisé (${url.host}). Autorisés : ${hosts.join(", ")}.` };
  }
  return { ok: true, value: url.toString() };
}

export type Endpoint = {
  /** Where to send, or null when this category has no usable link: nothing is sent. */
  url: URL | null;
  /** The category, or null when the call's team and product could not be placed. */
  routeKey: RouteKey | null;
  /** Why there is no destination, when there is none. */
  why: string | null;
};

/** Picks the URL for a call. Never throws, and never falls back to another category's link. */
export function resolveEndpoint(routeKey: RouteKey | null, routes: RouteSettings): Endpoint {
  if (!routeKey) return { url: null, routeKey, why: "équipe ou produit du conseiller non identifié" };

  const raw = (routes[routeKey] ?? "").trim();
  if (!raw) return { url: null, routeKey, why: `lien ${ROUTE_LABEL[routeKey]} non configuré` };

  try {
    const url = new URL(raw);
    if (!url.searchParams.get("cle_ws") || !url.searchParams.get("id_prov")) throw new Error("incomplete");
    return { url, routeKey, why: null };
  } catch {
    return { url: null, routeKey, why: `lien ${ROUTE_LABEL[routeKey]} invalide` };
  }
}
