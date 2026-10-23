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
  "La table azzur_routes n'existe pas encore dans la base utilisée par l'application : cliquez sur « Créer la table maintenant » " +
  "(section Liens AZZUR), ou exécutez prisma/sql/009-azzur-routes.sql dans le SQL editor de Supabase, puis réessayez.";

/**
 * The precise reason behind a "table not usable" error. P2021 is a missing table; P2022 a
 * missing COLUMN — the table exists but was made by hand or half-made — which deserves a
 * different message than "run the migration", or the admin re-runs it convinced it failed.
 */
export function missingTableMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    const column = (error.meta as { column?: string } | undefined)?.column;
    return `La table azzur_routes existe mais est incomplète${column ? ` (colonne ${column} manquante)` : ""} : ` +
      "cliquez sur « Créer la table maintenant », qui la complète sans rien effacer.";
  }
  return MIGRATION_HINT;
}

/**
 * Creates (or completes) azzur_routes — the SAME statements as prisma/sql/009-azzur-routes.sql,
 * kept in step with it. Additive only: CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, no row
 * or other table is touched, safe to run any number of times. Run on an administrator's explicit
 * request from /admin/azzur, so the SQL-editor step is not required.
 */
export async function ensureAzzurRoutesTable(): Promise<{ columns: string[]; schema: string }> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS azzur_routes (
      "key" TEXT NOT NULL,
      "url" TEXT NOT NULL DEFAULT '',
      "updatedAt" TIMESTAMP(3) NOT NULL,
      "updatedById" TEXT,
      CONSTRAINT "azzur_routes_pkey" PRIMARY KEY ("key")
    )`,
    `ALTER TABLE azzur_routes ADD COLUMN IF NOT EXISTS "url" TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE azzur_routes ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE azzur_routes ALTER COLUMN "updatedAt" DROP DEFAULT`,
    `ALTER TABLE azzur_routes ADD COLUMN IF NOT EXISTS "updatedById" TEXT`,
    // Holds secret keys: not reachable through Supabase's REST API with the anon key.
    `ALTER TABLE azzur_routes ENABLE ROW LEVEL SECURITY`,
  ];
  for (const sql of statements) await prisma.$executeRawUnsafe(sql);

  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string; schema: string }>>(
    `SELECT column_name, table_schema AS schema FROM information_schema.columns
     WHERE table_name = 'azzur_routes' AND table_schema = current_schema() ORDER BY ordinal_position`
  );
  return { columns: rows.map((r) => r.column_name), schema: rows[0]?.schema ?? "?" };
}

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

// ── Adviser -> AZZUR id_user ─────────────────────────────────────────────────────────
// Rows keyed "user:<Assurpilot user id>", url = the AZZUR id_user (digits).
const USER_PREFIX = "user:";

export async function loadAzzurUserMap(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.azzurRoute.findMany({ where: { key: { startsWith: USER_PREFIX } } });
    return Object.fromEntries(rows.filter((r) => /^\d+$/.test(r.url)).map((r) => [r.key.slice(USER_PREFIX.length), r.url]));
  } catch (error) {
    if (isMissingTable(error)) return {};
    throw error;
  }
}

/** Sets (digits) or clears ("") the AZZUR id_user of one adviser. */
export async function saveAzzurUserId(userId: string, azzurId: string, by: string | null): Promise<void> {
  const key = `${USER_PREFIX}${userId}`;
  if (!azzurId) {
    await prisma.azzurRoute.deleteMany({ where: { key } });
    return;
  }
  await prisma.azzurRoute.upsert({
    where: { key },
    create: { key, url: azzurId, updatedById: by },
    update: { url: azzurId, updatedById: by },
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
  let userMapById: Record<string, string> = {};
  try {
    userMapById = await loadAzzurUserMap();
  } catch {
    // Unreadable: no per-adviser ids, AZZUR applies its default user.
  }
  const enabled = settings.enabled ?? base.enabled;
  const autoPush = settings.autoPush ?? base.autoPush;
  return {
    config: { ...base, enabled, ready: enabled, autoPush, userMapById },
    tableAvailable: settings.tableAvailable,
    source: { enabled: settings.enabled === null ? "env" : "base", autoPush: settings.autoPush === null ? "env" : "base" },
  };
}
