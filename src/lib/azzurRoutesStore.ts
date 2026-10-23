// src/lib/azzurRoutesStore.ts
//
// Reads and writes the four AZZUR links AND the two runtime switches (table azzur_routes,
// prisma/sql/009). A link is a row whose key is AUTO_ALM … SANTE_CPA; a switch is a row
// whose key is "setting:enabled" / "setting:autoPush" with url "true" / "false", so the
// switches need no extra table. If the table has not been created yet everything still
// works from the environment alone (no link configured: nothing is sent), and the settings
// page says what to run.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROUTE_KEYS, type RouteKey, type RouteSettings } from "@/lib/azzurRouting";
import { readAzzurConfig, type AzzurConfig } from "@/lib/azzur";

export type LoadedRoutes = {
  routes: RouteSettings;
  /** False when azzur_routes does not exist (migration 009 not run yet). */
  tableAvailable: boolean;
  /** Which keys come from the database and which from AZZUR_MER_URL_<KEY>. */
  origin: Partial<Record<RouteKey, "base" | "env">>;
};

function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

/** Database value first, then the AZZUR_MER_URL_<KEY> environment variable. */
export async function loadAzzurRoutes(env: Record<string, string | undefined> = process.env): Promise<LoadedRoutes> {
  const routes: RouteSettings = {};
  const origin: LoadedRoutes["origin"] = {};
  let tableAvailable = true;

  try {
    const rows = await prisma.azzurRoute.findMany();
    for (const row of rows) {
      if ((ROUTE_KEYS as readonly string[]).includes(row.key) && row.url.trim()) {
        routes[row.key as RouteKey] = row.url.trim();
        origin[row.key as RouteKey] = "base";
      }
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    tableAvailable = false;
  }

  for (const key of ROUTE_KEYS) {
    const fromEnv = (env[`AZZUR_MER_URL_${key}`] ?? "").trim();
    if (!routes[key] && fromEnv) {
      routes[key] = fromEnv;
      origin[key] = "env";
    }
  }
  return { routes, tableAvailable, origin };
}

/** Stores (or, with an empty value, clears) one link. */
export async function saveAzzurRoute(key: RouteKey, value: string, userId: string | null): Promise<void> {
  if (!value) {
    await prisma.azzurRoute.deleteMany({ where: { key } });
    return;
  }
  await prisma.azzurRoute.upsert({
    where: { key },
    create: { key, url: value, updatedById: userId },
    update: { url: value, updatedById: userId },
  });
}

/** The one message shown wherever a save fails because migration 009 has not been run. */
export const MIGRATION_HINT =
  "La table azzur_routes n'existe pas encore : exécutez prisma/sql/009-azzur-routes.sql dans le SQL editor de Supabase, puis réessayez.";

export { isMissingTable };

// ── Runtime switches ─────────────────────────────────────────────────────────────────
export type SwitchName = "enabled" | "autoPush";
const SETTING_PREFIX = "setting:";

export type AzzurSettings = {
  /** null = never set from the page: the environment decides. */
  enabled: boolean | null;
  autoPush: boolean | null;
  tableAvailable: boolean;
};

export async function loadAzzurSettings(): Promise<AzzurSettings> {
  const out: AzzurSettings = { enabled: null, autoPush: null, tableAvailable: true };
  try {
    const rows = await prisma.azzurRoute.findMany({ where: { key: { startsWith: SETTING_PREFIX } } });
    for (const row of rows) {
      const name = row.key.slice(SETTING_PREFIX.length);
      if (name === "enabled" || name === "autoPush") out[name] = row.url === "true";
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    out.tableAvailable = false;
  }
  return out;
}

export async function saveAzzurSetting(name: SwitchName, value: boolean, userId: string | null): Promise<void> {
  const key = `${SETTING_PREFIX}${name}`;
  const url = value ? "true" : "false";
  await prisma.azzurRoute.upsert({
    where: { key },
    create: { key, url, updatedById: userId },
    update: { url, updatedById: userId },
  });
}

export type EffectiveConfig = {
  config: AzzurConfig;
  tableAvailable: boolean;
  /** Where each switch's value comes from: the page ("base") or the environment ("env"). */
  source: { enabled: "base" | "env"; autoPush: "base" | "env" };
};

/**
 * The integration settings as they are RIGHT NOW: the environment, overridden by the two
 * switches saved from /admin/azzur. A change there applies immediately, without a redeploy.
 * If the database cannot be read, the environment alone is used.
 */
export async function loadEffectiveConfig(env: Record<string, string | undefined> = process.env): Promise<EffectiveConfig> {
  const base = readAzzurConfig(env);
  let settings: AzzurSettings = { enabled: null, autoPush: null, tableAvailable: false };
  try {
    settings = await loadAzzurSettings();
  } catch {
    // Unreadable: fall back to the environment.
  }
  const enabled = settings.enabled ?? base.enabled;
  const autoPush = settings.autoPush ?? base.autoPush;
  return {
    config: { ...base, enabled, ready: enabled, autoPush },
    tableAvailable: settings.tableAvailable,
    source: { enabled: settings.enabled === null ? "env" : "base", autoPush: settings.autoPush === null ? "env" : "base" },
  };
}
