-- prisma/sql/007-advisor-call-applied.sql
--
-- Records what an administrator has actually APPLIED on the telephony system
-- (Keyyo / PBX) for each adviser, for the admin page /admin/demandes-routage.
--
-- advisor_call_settings (006) holds what a coach REQUESTED. This holds what is
-- really on the PBX, so the page can show exactly which advisers still need a
-- change: requested != applied. Independent of 006's shape, but the page reads
-- both, so run 006 first.
--
-- CONVERGENT, not just idempotent — see 006 for why `CREATE TABLE IF NOT EXISTS`
-- alone is not enough. From ANY starting point (absent, a stub with only
-- "userId", missing keys, nullable columns…) this brings the table to the exact
-- shape the Prisma model expects, then ASSERTS it and fails if it is still not
-- right. One transaction: it converges completely or changes nothing. Safe to run
-- any number of times.
--
-- It touches only this table. The only rows it can remove are ones that could
-- never be used: no adviser, a duplicate for the same adviser, or an adviser who
-- no longer exists.
--
-- No row for an adviser means the defaults (taking calls, not boosted) — the same
-- as the requested defaults — so nothing needs backfilling and nobody is flagged
-- by the migration itself.

BEGIN;

-- 0. Refuse early, in plain words, if "userId" already exists as something that
--    cannot be turned into text (a uuid, say): it cannot be reconciled with
--    users.id automatically, and Postgres's own error ("operator does not exist:
--    uuid = text") would not say why. A varchar is fine — step 5 converts it.
DO $$
DECLARE t text;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'advisor_call_applied' AND column_name = 'userId';
  IF t IS NOT NULL AND t NOT IN ('text', 'character varying', 'character') THEN
    RAISE EXCEPTION 'advisor_call_applied."userId" est de type %, attendu text : cette table n''est pas celle de l''application. Renommez-la (ALTER TABLE advisor_call_applied RENAME TO advisor_call_applied_old) puis relancez ce fichier.', t;
  END IF;
END $$;

-- 1. Create the table if it does not exist at all.
CREATE TABLE IF NOT EXISTS advisor_call_applied (
  "userId"           TEXT          NOT NULL,
  "isActiveForCalls" BOOLEAN       NOT NULL DEFAULT true,
  "isBoosted"        BOOLEAN       NOT NULL DEFAULT false,
  "appliedAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedById"      TEXT
);

-- 1b. Recognise columns left under the WRONG NAME by a hand-written "fix" script
--     (for example "appliedActive" instead of "isActiveForCalls") and RENAME them,
--     so any values they hold are kept rather than re-created from defaults. Only
--     when the correctly named column is absent: if both exist, the misnamed one is
--     left alone (see step 6b) rather than overwriting real data with a stale copy.
DO $$
DECLARE pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['appliedActive',         'isActiveForCalls'],
    ARRAY['appliedActiveForCalls', 'isActiveForCalls'],
    ARRAY['appliedBoosted',        'isBoosted']
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'advisor_call_applied' AND column_name = pair[1])
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'advisor_call_applied' AND column_name = pair[2])
    THEN
      EXECUTE format('ALTER TABLE advisor_call_applied RENAME COLUMN %I TO %I', pair[1], pair[2]);
      RAISE NOTICE 'advisor_call_applied : colonne % renommée en %', pair[1], pair[2];
    END IF;
  END LOOP;
END $$;

-- 2. Add whatever is missing (nullable first, so it works with existing rows).
ALTER TABLE advisor_call_applied ADD COLUMN IF NOT EXISTS "userId"           TEXT;
ALTER TABLE advisor_call_applied ADD COLUMN IF NOT EXISTS "isActiveForCalls" BOOLEAN;
ALTER TABLE advisor_call_applied ADD COLUMN IF NOT EXISTS "isBoosted"        BOOLEAN;
ALTER TABLE advisor_call_applied ADD COLUMN IF NOT EXISTS "appliedAt"        TIMESTAMP(3);
ALTER TABLE advisor_call_applied ADD COLUMN IF NOT EXISTS "appliedById"      TEXT;

-- 3. Give rows that predate a column its default.
UPDATE advisor_call_applied SET "isActiveForCalls" = true              WHERE "isActiveForCalls" IS NULL;
UPDATE advisor_call_applied SET "isBoosted"        = false             WHERE "isBoosted"        IS NULL;
UPDATE advisor_call_applied SET "appliedAt"        = CURRENT_TIMESTAMP WHERE "appliedAt"        IS NULL;

-- 4. Remove rows that could never be used, so the keys below can be established.
DELETE FROM advisor_call_applied WHERE "userId" IS NULL;
DELETE FROM advisor_call_applied a
  USING advisor_call_applied b
  WHERE a.ctid > b.ctid AND a."userId" = b."userId";
DELETE FROM advisor_call_applied WHERE "userId" NOT IN (SELECT id FROM users);

-- 5. Types, nullability and defaults exactly as the Prisma model declares them.
-- Column TYPES first, converted explicitly: a table made by hand often has
-- TIMESTAMP (microseconds) where Prisma uses TIMESTAMP(3), or varchar for text.
-- A no-op when the column is already right.
ALTER TABLE advisor_call_applied ALTER COLUMN "userId" TYPE TEXT;
ALTER TABLE advisor_call_applied ALTER COLUMN "isActiveForCalls" TYPE BOOLEAN;
ALTER TABLE advisor_call_applied ALTER COLUMN "isBoosted" TYPE BOOLEAN;
ALTER TABLE advisor_call_applied ALTER COLUMN "appliedAt" TYPE TIMESTAMP(3);
ALTER TABLE advisor_call_applied ALTER COLUMN "appliedById" TYPE TEXT;

ALTER TABLE advisor_call_applied ALTER COLUMN "userId"           SET NOT NULL;
ALTER TABLE advisor_call_applied ALTER COLUMN "isActiveForCalls" SET DEFAULT true;
ALTER TABLE advisor_call_applied ALTER COLUMN "isActiveForCalls" SET NOT NULL;
ALTER TABLE advisor_call_applied ALTER COLUMN "isBoosted"        SET DEFAULT false;
ALTER TABLE advisor_call_applied ALTER COLUMN "isBoosted"        SET NOT NULL;
ALTER TABLE advisor_call_applied ALTER COLUMN "appliedAt"        SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE advisor_call_applied ALTER COLUMN "appliedAt"        SET NOT NULL;

-- 6. Keys: replace whatever exists, under whatever names, with the ones Prisma
--    expects.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.advisor_call_applied'::regclass AND contype IN ('p', 'f')
  LOOP
    EXECUTE format('ALTER TABLE advisor_call_applied DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE advisor_call_applied
  ADD CONSTRAINT "advisor_call_applied_pkey" PRIMARY KEY ("userId");
ALTER TABLE advisor_call_applied
  ADD CONSTRAINT "advisor_call_applied_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- 6b. Columns the application does not know about must never be able to block its
--     inserts. A stray NOT NULL column with no default would make every write
--     fail, so relax those; they are kept (and reported in step 8), not dropped.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'advisor_call_applied'
      AND column_name NOT IN ('userId', 'isActiveForCalls', 'isBoosted', 'appliedAt', 'appliedById')
      AND is_nullable = 'NO' AND column_default IS NULL
  LOOP
    EXECUTE format('ALTER TABLE advisor_call_applied ALTER COLUMN %I DROP NOT NULL', c.column_name);
  END LOOP;
END $$;

-- 7. Same reason as 006: a table in Supabase's `public` schema is reachable with
--    the anon key unless row-level security is on. Enabling it with no policy
--    denies that route; the app is unaffected because Prisma connects with the
--    privileged `postgres` role, which bypasses RLS.
ALTER TABLE advisor_call_applied ENABLE ROW LEVEL SECURITY;

-- 8. ASSERT the final shape; fail (and roll everything back) if it is not right.
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
    ('appliedAt',        'timestamp without time zone', 'NO'),
    ('appliedById',      'text',                        'YES')
  ) AS e(col, typ, nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = 'advisor_call_applied'
   AND c.column_name = e.col AND c.data_type = e.typ AND c.is_nullable = e.nullable
  WHERE c.column_name IS NULL;

  SELECT string_agg(column_name || ' (précision ' || datetime_precision || ', attendu 3)', ', ')
    INTO extras
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'advisor_call_applied'
    AND data_type = 'timestamp without time zone' AND datetime_precision <> 3;
  IF extras IS NOT NULL THEN
    problems := coalesce(problems || ', ', '') || extras;
  END IF;

  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'advisor_call_applied : colonnes incorrectes ou manquantes -> %', problems;
  END IF;

  SELECT string_agg(column_name, ', ') INTO extras
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'advisor_call_applied'
    AND column_name NOT IN ('userId', 'isActiveForCalls', 'isBoosted', 'appliedAt', 'appliedById');
  IF extras IS NOT NULL THEN
    RAISE WARNING 'advisor_call_applied : colonnes inattendues laissées en place -> %', extras;
  END IF;
END $$;

COMMIT;

-- Verify.
SELECT count(*) AS rows_in_advisor_call_applied FROM advisor_call_applied;
