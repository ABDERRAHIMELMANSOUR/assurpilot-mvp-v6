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
// Anything that still cannot be placed goes to the MAIN link (AZZUR_MER_URL) rather
// than being dropped: the lead reaches AZZUR, just not in a team-specific space.
//
// A link that is not set also falls back to the main link, so the feature can be
// switched on one team at a time.
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

export type ParsedRoute = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates what an administrator typed for one link.
 *   ""            clears it (back to the main link)
 *   "51"          a bare id_prov: the main link with that provenance
 *   "https://…"   a full MER URL: must carry id_prov and cle_ws, and point at the SAME
 *                 host as the main link — customer phone numbers are posted to it, so a
 *                 typo or a hostile paste must not be able to send them elsewhere.
 */
export function parseRouteValue(raw: string, main: URL | null): ParsedRoute {
  const value = raw.trim();
  if (!value) return { ok: true, value: "" };
  if (/^\d{1,9}$/.test(value)) {
    return main ? { ok: true, value } : { ok: false, error: "Un id_prov seul nécessite AZZUR_MER_URL (le lien principal)." };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Ce n'est ni une URL valide ni un id_prov (nombre)." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "L'URL doit commencer par https://" };
  const key = url.searchParams.get("cle_ws");
  if (!key || key.includes("*")) {
    return { ok: false, error: "L'URL doit contenir la clé complète (cle_ws=…). Une clé masquée (***) ne convient pas." };
  }
  if (!url.searchParams.get("id_prov")) return { ok: false, error: "L'URL doit contenir id_prov=…" };
  if (main && url.host !== main.host) {
    return { ok: false, error: `L'URL doit être sur le même serveur que le lien principal (${main.host}).` };
  }
  return { ok: true, value: url.toString() };
}

export type Endpoint = {
  url: URL;
  /** The key used, or null when the call could not be placed. */
  routeKey: RouteKey | null;
  /** dedicated: the link configured for this key; principal: the main link. */
  source: "dedicated" | "principal";
  /** Why the main link was used, when it was. */
  why: string | null;
};

/** Picks the URL for a call. Never throws; a bad stored value degrades to the main link. */
export function resolveEndpoint(
  routeKey: RouteKey | null,
  routes: RouteSettings,
  main: URL
): Endpoint {
  const principal = (why: string): Endpoint => ({ url: new URL(main.toString()), routeKey, source: "principal", why });
  if (!routeKey) return principal("équipe ou produit du conseiller inconnu");

  const raw = (routes[routeKey] ?? "").trim();
  if (!raw) return principal(`lien ${ROUTE_LABEL[routeKey]} non défini`);

  if (/^\d{1,9}$/.test(raw)) {
    const url = new URL(main.toString());
    url.searchParams.set("id_prov", raw);
    return { url, routeKey, source: "dedicated", why: null };
  }
  try {
    return { url: new URL(raw), routeKey, source: "dedicated", why: null };
  } catch {
    return principal(`lien ${ROUTE_LABEL[routeKey]} invalide`);
  }
}
