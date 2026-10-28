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
  // P2021 table missing, P2022 column missing, P2011 a required column the app does not fill
  // (a table of that name made by another tool).
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022", "P2011"].includes(error.code);
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
  "La table azzur_routes n'existe pas encore dans la base utilisée par l'application : cliquez sur « Créer / réparer la table » " +
  "(section Liens AZZUR), ou exécutez prisma/sql/009-azzur-routes.sql dans le SQL editor de Supabase, puis réessayez.";

/**
 * The precise reason behind a "table not usable" error. P2021 is a missing table; P2022 a
 * missing COLUMN — the table exists but was made by hand or half-made — which deserves a
 * different message than "run the migration", or the admin re-runs it convinced it failed.
 */
export function missingTableMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2011") return WRONG_SHAPE_HINT;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    const column = (error.meta as { column?: string } | undefined)?.column;
    return `La table azzur_routes existe mais est incomplète${column ? ` (colonne ${column} manquante)` : ""} : ` +
      "cliquez sur « Créer / réparer la table », qui la complète sans rien effacer.";
  }
  return MIGRATION_HINT;
}

/**
 * The ONE statement that brings azzur_routes to the shape the app needs, from any starting
 * point. Same text as prisma/sql/009-azzur-routes.sql — keep the two in step.
 *
 * A table of that name made by hand or by another tool (an "id" column that is required with no
 * default, a primary key on something other than "key"…) makes every save fail with a NULL
 * violation. Such a table is not modified: it is RENAMED azzur_routes_old_<timestamp> (its
 * constraints renamed too, so their names are free), a correct table is created, and every
 * key/url pair it held is copied across. Nothing is deleted. On a table that is already right
 * this only adds what is missing — safe to run any number of times.
 */
export const AZZUR_ROUTES_REPAIR_SQL = `DO $repair$
DECLARE
  v_old text;
  v_suffix text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  v_bad boolean := false;
  r record;
BEGIN
  IF to_regclass('public.azzur_routes') IS NOT NULL THEN
    -- Unusable shape: no "key" column, a required column the app never fills, or a primary key
    -- that is not exactly ("key").
    v_bad := NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'azzur_routes' AND column_name = 'key')
      OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'azzur_routes'
                 AND column_name NOT IN ('key', 'url', 'updatedAt', 'updatedById') AND is_nullable = 'NO' AND column_default IS NULL)
      OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.azzur_routes'::regclass AND c.contype = 'p'
                     AND array_length(c.conkey, 1) = 1
                     AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = 'key');
    IF v_bad THEN
      v_old := 'azzur_routes_old_' || v_suffix;
      EXECUTE format('ALTER TABLE public.azzur_routes RENAME TO %I', v_old);
      FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = format('public.%I', v_old)::regclass LOOP
        EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', v_old, r.conname, left(r.conname, 40) || '_old_' || v_suffix);
      END LOOP;
      RAISE NOTICE 'azzur_routes avait une autre forme : renommée % (rien n''est supprimé)', v_old;
    END IF;
  END IF;

  CREATE TABLE IF NOT EXISTS public.azzur_routes (
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "azzur_routes_pkey" PRIMARY KEY ("key")
  );
  ALTER TABLE public.azzur_routes ADD COLUMN IF NOT EXISTS "url" TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.azzur_routes ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  ALTER TABLE public.azzur_routes ALTER COLUMN "updatedAt" DROP DEFAULT;
  ALTER TABLE public.azzur_routes ADD COLUMN IF NOT EXISTS "updatedById" TEXT;
  -- Holds secret keys: not reachable through Supabase's REST API with the anon key.
  ALTER TABLE public.azzur_routes ENABLE ROW LEVEL SECURITY;

  -- Keep whatever links the set-aside table held.
  IF v_old IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = v_old AND column_name = 'key')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = v_old AND column_name = 'url') THEN
    EXECUTE format('INSERT INTO public.azzur_routes ("key", "url", "updatedAt") SELECT DISTINCT ON ("key") "key"::text, "url"::text, CURRENT_TIMESTAMP FROM public.%I WHERE "key" IS NOT NULL AND COALESCE("url"::text, %L) <> %L ON CONFLICT ("key") DO NOTHING', v_old, '', '');
  END IF;
END
$repair$`;

/** Why the table cannot be written to as it stands, or null when it can. */
export async function azzurRoutesTableProblem(): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ problem: string | null }>>(
    `SELECT CASE
       WHEN to_regclass('public.azzur_routes') IS NULL THEN 'missing'
       WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'azzur_routes'
                    AND column_name NOT IN ('key', 'url', 'updatedAt', 'updatedById') AND is_nullable = 'NO' AND column_default IS NULL)
         THEN 'extra-required'
       WHEN NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.azzur_routes'::regclass AND c.contype = 'p'
                        AND array_length(c.conkey, 1) = 1
                        AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = 'key')
         THEN 'wrong-key'
       ELSE NULL END AS problem`
  );
  const p = rows[0]?.problem ?? null;
  if (p === "missing") return MIGRATION_HINT;
  if (p) return WRONG_SHAPE_HINT;
  return null;
}

export const WRONG_SHAPE_HINT =
  "La table azzur_routes existe mais n'a pas la forme attendue (créée par un autre outil : colonne id obligatoire, autre clé…), " +
  "donc aucun enregistrement n'est possible. Cliquez sur « Créer / réparer la table » : l'ancienne table est mise de côté " +
  "(renommée, rien n'est supprimé), la bonne est créée et les liens déjà présents sont recopiés.";

export async function ensureAzzurRoutesTable(): Promise<{ columns: string[]; schema: string }> {
  await prisma.$executeRawUnsafe(AZZUR_ROUTES_REPAIR_SQL);
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string; schema: string }>>(
    `SELECT column_name, table_schema AS schema FROM information_schema.columns
     WHERE table_name = 'azzur_routes' AND table_schema = 'public' ORDER BY ordinal_position`
  );
  return { columns: rows.map((r) => r.column_name), schema: rows[0]?.schema ?? "?" };
}

export { isMissingTable };

// ── Runtime switches ─────────────────────────────────────────────────────────────────
export type SwitchName = "enabled" | "autoPush";
const SETTING_PREFIX = "setting:";

/**
 * Name written on the AZZUR fiche:
 *   "conseiller"  Nom "Appel Assurpilot", Prénom "reçu par <conseiller>" (default)
 *   "ape"         Nom "APE", Prénom = the caller's number
 * AZZUR's de-duplication compares the fiche's identity (name / first name / birth date), not
 * the number: with "APE" + a first name made only of digits, every fiche looks like the same
 * person, AZZUR answers DOUBLON:<one fiche> and files it under a user of its own choosing.
 * "ape" is therefore only safe once AZZUR de-duplicates on the phone number
 * (Administration › Provenances › AE › Dédoublonnage).
 */
export type FicheFormat = "conseiller" | "ape";
export const FICHE_FORMAT_PLACEHOLDERS: Record<FicheFormat, { nom: string; prenom: string }> = {
  conseiller: { nom: "Appel Assurpilot", prenom: "reçu par {conseiller}" },
  ape: { nom: "APE", prenom: "{telephone}" },
};

export type AzzurSettings = {
  /** null = never set from the page: the environment decides. */
  enabled: boolean | null;
  autoPush: boolean | null;
  /** null = never set from the page: AZZUR_MER_DEFAULTS (or the built-in default) decides. */
  ficheFormat: FicheFormat | null;
  tableAvailable: boolean;
};

export async function loadAzzurSettings(): Promise<AzzurSettings> {
  const out: AzzurSettings = { enabled: null, autoPush: null, ficheFormat: null, tableAvailable: true };
  try {
    const rows = await prisma.azzurRoute.findMany({ where: { key: { startsWith: SETTING_PREFIX } } });
    for (const row of rows) {
      const name = row.key.slice(SETTING_PREFIX.length);
      if (name === "enabled" || name === "autoPush") out[name] = row.url === "true";
      if (name === "ficheFormat" && (row.url === "ape" || row.url === "conseiller")) out.ficheFormat = row.url;
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

/** Saves the fiche name format chosen on /admin/azzur (applies to the next send). */
export async function saveFicheFormat(format: FicheFormat, userId: string | null): Promise<void> {
  const key = `${SETTING_PREFIX}ficheFormat`;
  await prisma.azzurRoute.upsert({
    where: { key },
    create: { key, url: format, updatedById: userId },
    update: { url: format, updatedById: userId },
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

// ── Default id_user per AZZUR space ──────────────────────────────────────────────────
// Rows keyed "setting:defaultUserId:<ROUTE KEY>", url = the AZZUR id_user (digits). Used for an
// adviser who has no id of their own. One per space: ALM and CPA number their users separately.
const DEFAULT_USER_PREFIX = "setting:defaultUserId:";

export async function loadAzzurDefaultUserIds(): Promise<Partial<Record<RouteKey, string>>> {
  try {
    const rows = await prisma.azzurRoute.findMany({ where: { key: { startsWith: DEFAULT_USER_PREFIX } } });
    const out: Partial<Record<RouteKey, string>> = {};
    for (const r of rows) {
      const key = r.key.slice(DEFAULT_USER_PREFIX.length);
      if ((ROUTE_KEYS as readonly string[]).includes(key) && /^\d+$/.test(r.url)) out[key as RouteKey] = r.url;
    }
    return out;
  } catch (error) {
    if (isMissingTable(error)) return {};
    throw error;
  }
}

/** Sets (digits) or clears ("") the default id_user of one space. */
export async function saveAzzurDefaultUserId(routeKey: RouteKey, azzurId: string, by: string | null): Promise<void> {
  const key = `${DEFAULT_USER_PREFIX}${routeKey}`;
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
  /** Fiche name format in force. */
  ficheFormat: FicheFormat;
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
  let settings: AzzurSettings = { enabled: null, autoPush: null, ficheFormat: null, tableAvailable: false };
  try {
    settings = await loadAzzurSettings();
  } catch {
    // Unreadable: fall back to the environment.
  }
  let userMapById: Record<string, string> = {};
  let defaultUserIds: Partial<Record<RouteKey, string>> = {};
  try {
    [userMapById, defaultUserIds] = await Promise.all([loadAzzurUserMap(), loadAzzurDefaultUserIds()]);
  } catch {
    // Unreadable: no per-adviser ids, AZZUR applies its default user.
  }
  const enabled = settings.enabled ?? base.enabled;
  const autoPush = settings.autoPush ?? base.autoPush;
  return {
    config: {
      ...base, enabled, ready: enabled, autoPush, userMapById, defaultUserIds,
      // The format chosen on the page wins over AZZUR_MER_DEFAULTS for nom / prénom.
      placeholders: settings.ficheFormat ? { ...base.placeholders, ...FICHE_FORMAT_PLACEHOLDERS[settings.ficheFormat] } : base.placeholders,
    },
    ficheFormat: settings.ficheFormat ?? (base.placeholders.nom === "APE" ? "ape" : "conseiller"),
    tableAvailable: settings.tableAvailable,
    source: { enabled: settings.enabled === null ? "env" : "base", autoPush: settings.autoPush === null ? "env" : "base" },
  };
}
