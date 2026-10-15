-- prisma/sql/006-advisor-call-settings.sql
--
-- Per-advisor call-distribution switches, set by the coach from the coach
-- dashboard: "Appels entrants" (is the adviser taking calls?) and "Booster"
-- (does the adviser get priority?).
--
-- CONVERGENT, not just idempotent. `CREATE TABLE IF NOT EXISTS` alone skips a
-- table that already exists WHATEVER its shape, so a table left half-built — a
-- stub with only "userId", say — would be silently accepted and the app would
-- then fail on the missing columns. This file therefore brings the table to the
-- exact shape the Prisma model expects from ANY starting point: create it if
-- absent, add every missing column, backfill, tighten, repair the keys, and
-- finally ASSERT the result, raising an error if it is still not right. The whole
-- script is one transaction, so it either converges completely or changes
-- nothing. Safe to run any number of times.
--
-- What it can touch is limited to this one table (a feature table nobody could
-- have used yet): `users` and every other table are left alone. The only rows it
-- can remove are ones that could never be shown or used — no adviser at all, a
-- second row for the same adviser, or an adviser who no longer exists.
--
-- No row for an adviser means the defaults (taking calls, not boosted), so
-- nothing needs backfilling for advisers who have never been touched.

BEGIN;

-- 0. Refuse early, in plain words, if "userId" already exists as something that
--    cannot be turned into text (a uuid, say): it cannot be reconciled with
--    users.id automatically, and Postgres's own error ("operator does not exist:
--    uuid = text") would not say why. A varchar is fine — step 5 converts it.
DO $$
DECLARE t text;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'advisor_call_settings' AND column_name = 'userId';
  IF t IS NOT NULL AND t NOT IN ('text', 'character varying', 'character') THEN
    RAISE EXCEPTION 'advisor_call_settings."userId" est de type %, attendu text : cette table n''est pas celle de l''application. Renommez-la (ALTER TABLE advisor_call_settings RENAME TO advisor_call_settings_old) puis relancez ce fichier.', t;
  END IF;
END $$;

-- 1. Create the table if it does not exist at all.
CREATE TABLE IF NOT EXISTS advisor_call_settings (
  "userId"           TEXT          NOT NULL,
  "isActiveForCalls" BOOLEAN       NOT NULL DEFAULT true,
  "isBoosted"        BOOLEAN       NOT NULL DEFAULT false,
  "updatedAt"        TIMESTAMP(3)  NOT NULL,
  "updatedById"      TEXT
);

-- 2. If it already existed in some other shape, add whatever is missing. Added
--    nullable first so this works on a table that already has rows; tightened
--    below once they have been given values.
ALTER TABLE advisor_call_settings ADD COLUMN IF NOT EXISTS "userId"           TEXT;
ALTER TABLE advisor_call_settings ADD COLUMN IF NOT EXISTS "isActiveForCalls" BOOLEAN;
ALTER TABLE advisor_call_settings ADD COLUMN IF NOT EXISTS "isBoosted"        BOOLEAN;
ALTER TABLE advisor_call_settings ADD COLUMN IF NOT EXISTS "updatedAt"        TIMESTAMP(3);
ALTER TABLE advisor_call_settings ADD COLUMN IF NOT EXISTS "updatedById"      TEXT;

-- 3. Give rows that predate a column its default.
UPDATE advisor_call_settings SET "isActiveForCalls" = true            WHERE "isActiveForCalls" IS NULL;
UPDATE advisor_call_settings SET "isBoosted"        = false           WHERE "isBoosted"        IS NULL;
UPDATE advisor_call_settings SET "updatedAt"        = CURRENT_TIMESTAMP WHERE "updatedAt"      IS NULL;

-- 4. Remove rows that could never be used, so the key and the foreign key below
--    can be established: no adviser, a duplicate of an adviser's row (the first
--    physical row wins), or an adviser who no longer exists.
--    In a DO block so that no SQL-editor statement splitter can cut the multi-line
--    DELETEs apart (Supabase's editor did: "syntax error at or near WHERE").
DO $$
BEGIN
  DELETE FROM advisor_call_settings WHERE "userId" IS NULL;
  DELETE FROM advisor_call_settings WHERE ctid IN (SELECT d.ctid FROM (SELECT ctid, row_number() OVER (PARTITION BY "userId" ORDER BY ctid) AS rn FROM advisor_call_settings) d WHERE d.rn > 1);
  DELETE FROM advisor_call_settings WHERE "userId" NOT IN (SELECT id FROM users);
END $$;

-- 5. Types, nullability and defaults exactly as the Prisma model declares them.
--    "updatedAt" deliberately has NO default: Prisma's @updatedAt supplies it on
--    every write and expects the column to have none.
-- Column TYPES first, converted explicitly: a table made by hand often has
-- TIMESTAMP (microseconds) where Prisma uses TIMESTAMP(3), or varchar for text.
-- A no-op when the column is already right.
ALTER TABLE advisor_call_settings ALTER COLUMN "userId" TYPE TEXT;
ALTER TABLE advisor_call_settings ALTER COLUMN "isActiveForCalls" TYPE BOOLEAN;
ALTER TABLE advisor_call_settings ALTER COLUMN "isBoosted" TYPE BOOLEAN;
ALTER TABLE advisor_call_settings ALTER COLUMN "updatedAt" TYPE TIMESTAMP(3);
ALTER TABLE advisor_call_settings ALTER COLUMN "updatedById" TYPE TEXT;

ALTER TABLE advisor_call_settings ALTER COLUMN "userId"           SET NOT NULL;
ALTER TABLE advisor_call_settings ALTER COLUMN "isActiveForCalls" SET DEFAULT true;
ALTER TABLE advisor_call_settings ALTER COLUMN "isActiveForCalls" SET NOT NULL;
ALTER TABLE advisor_call_settings ALTER COLUMN "isBoosted"        SET DEFAULT false;
ALTER TABLE advisor_call_settings ALTER COLUMN "isBoosted"        SET NOT NULL;
ALTER TABLE advisor_call_settings ALTER COLUMN "updatedAt"        DROP DEFAULT;
ALTER TABLE advisor_call_settings ALTER COLUMN "updatedAt"        SET NOT NULL;

-- 6. Keys. Whatever primary key or foreign keys exist (a table made by hand often
--    has them under other names) are replaced by the ones Prisma expects, so a
--    later `prisma db push` finds nothing to rewrite.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.advisor_call_settings'::regclass AND contype IN ('p', 'f')
  LOOP
    EXECUTE format('ALTER TABLE advisor_call_settings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE advisor_call_settings
  ADD CONSTRAINT "advisor_call_settings_pkey" PRIMARY KEY ("userId");
ALTER TABLE advisor_call_settings
  ADD CONSTRAINT "advisor_call_settings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- 6b. Columns the application does not know about must never be able to block its
--     inserts. A stray NOT NULL column with no default would make every write
--     fail, so relax those; they are kept (and reported in step 8), not dropped.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'advisor_call_settings'
      AND column_name NOT IN ('userId', 'isActiveForCalls', 'isBoosted', 'updatedAt', 'updatedById')
      AND is_nullable = 'NO' AND column_default IS NULL
  LOOP
    EXECUTE format('ALTER TABLE advisor_call_settings ALTER COLUMN %I DROP NOT NULL', c.column_name);
  END LOOP;
END $$;

-- 7. A table created in Supabase's `public` schema is reachable through the REST
--    API with the anon key unless row-level security is on, and this one controls
--    who receives calls. Enabling RLS with no policy denies that route entirely;
--    the app is unaffected because Prisma connects with the privileged `postgres`
--    role, which bypasses RLS. (Worth checking that your other tables are locked
--    down the same way — this file only handles the table it creates.)
ALTER TABLE advisor_call_settings ENABLE ROW LEVEL SECURITY;

-- 8. ASSERT the final shape. If anything is still not as the app expects, fail
--    here — rolling the whole script back — rather than leaving a table that
--    looks fine and breaks at runtime.
DO $$
DECLARE
  problems text;
  extras   text;
BEGIN
  SELECT string_agg(e.col || ' (attendu ' || e.typ || ', ' ||
                    CASE e.nullable WHEN 'NO' THEN 'NOT NULL' ELSE 'nullable' END || ')', ', ')
    INTO problems
  FROM (VALUES
    ('userId',           'text',                        'NO'),
    ('isActiveForCalls', 'boolean',                     'NO'),
    ('isBoosted',        'boolean',                     'NO'),
    ('updatedAt',        'timestamp without time zone', 'NO'),
    ('updatedById',      'text',                        'YES')
  ) AS e(col, typ, nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = 'advisor_call_settings'
   AND c.column_name = e.col AND c.data_type = e.typ AND c.is_nullable = e.nullable
  WHERE c.column_name IS NULL;

  SELECT string_agg(column_name || ' (précision ' || datetime_precision || ', attendu 3)', ', ')
    INTO extras
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'advisor_call_settings'
    AND data_type = 'timestamp without time zone' AND datetime_precision <> 3;
  IF extras IS NOT NULL THEN
    problems := coalesce(problems || ', ', '') || extras;
  END IF;

  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'advisor_call_settings : colonnes incorrectes ou manquantes -> %', problems;
  END IF;

  SELECT string_agg(column_name, ', ') INTO extras
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'advisor_call_settings'
    AND column_name NOT IN ('userId', 'isActiveForCalls', 'isBoosted', 'updatedAt', 'updatedById');
  IF extras IS NOT NULL THEN
    RAISE WARNING 'advisor_call_settings : colonnes inattendues laissées en place -> %', extras;
  END IF;
END $$;

COMMIT;

-- Verify.
SELECT count(*) AS rows_in_advisor_call_settings FROM advisor_call_settings;
