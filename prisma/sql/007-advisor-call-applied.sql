-- prisma/sql/007-advisor-call-applied.sql
--
-- Records what an administrator has actually APPLIED on the telephony system
-- (Keyyo / PBX) for each adviser, for the admin page /admin/demandes-routage.
--
-- advisor_call_settings (006) holds what a coach REQUESTED. This holds what is
-- really on the PBX, so the page can show exactly which advisers still need a
-- change: requested != applied.
--
-- PURELY ADDITIVE: one new table. advisor_call_settings, `users` and every other
-- table are untouched. No row for an adviser means the defaults (taking calls,
-- not boosted) — the same as the requested defaults — so nothing needs
-- backfilling and nobody is flagged by the migration itself. Safe to run more
-- than once.
--
-- Run after 006. Only the admin page reads this table: the coach dashboard and
-- every other screen never touch it, so they keep working whether or not it has
-- been created.

CREATE TABLE IF NOT EXISTS advisor_call_applied (
  "userId"           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "isActiveForCalls" BOOLEAN       NOT NULL DEFAULT true,
  "isBoosted"        BOOLEAN       NOT NULL DEFAULT false,
  "appliedAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedById"      TEXT
);

-- Same reason as 006: a table in Supabase's `public` schema is reachable with
-- the anon key unless row-level security is on. Enabling it with no policy
-- denies that route; the app is unaffected because Prisma connects with the
-- privileged `postgres` role, which bypasses RLS.
ALTER TABLE advisor_call_applied ENABLE ROW LEVEL SECURITY;

-- Reconcile advisor_call_settings (006) with what Prisma expects.
--
-- The first version of 006 created that table with a DEFAULT on "updatedAt" and
-- a foreign key without ON UPDATE CASCADE. Neither changes behaviour — ids never
-- change and Prisma always supplies updatedAt — but they differ from the Prisma
-- schema, so a later `prisma db push` would quietly rewrite them. This brings an
-- already-created table into line; on a database where the corrected 006 just
-- ran, it changes nothing. Touches only constraint/default metadata, no rows.
ALTER TABLE advisor_call_settings ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE advisor_call_settings DROP CONSTRAINT IF EXISTS "advisor_call_settings_userId_fkey";
ALTER TABLE advisor_call_settings
  ADD CONSTRAINT "advisor_call_settings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- Verify.
SELECT count(*) AS rows_in_advisor_call_applied FROM advisor_call_applied;
