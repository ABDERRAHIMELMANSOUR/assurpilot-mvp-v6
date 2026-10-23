-- prisma/sql/009-azzur-routes.sql
--
-- The table behind /admin/azzur: the four CRM links (keys AUTO_ALM, SANTE_ALM, AUTO_CPA,
-- SANTE_CPA), the two runtime switches (setting:enabled, setting:autoPush) and each adviser's
-- AZZUR id (user:<id>). A category with no row has no link: nothing is sent for it.
--
-- ONE statement, identical to AZZUR_ROUTES_REPAIR_SQL in src/lib/azzurRoutesStore.ts, which the
-- "Créer / réparer la table" button on /admin/azzur runs. It creates the table, completes it, or —
-- if a table of this name exists with another shape (e.g. a required "id" column made by another
-- tool, which makes every save fail) — renames that one aside (azzur_routes_old_<date>, nothing is
-- deleted), creates the right one and copies the links it held. Safe to run any number of times.
-- Row-level security is on: the anon key cannot read the links (they hold secret keys).

DO $repair$
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
$repair$;

SELECT count(*) AS lignes_dans_azzur_routes FROM azzur_routes;
