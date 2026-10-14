-- prisma/sql/006-advisor-call-settings.sql
--
-- Per-advisor call-distribution switches, set by the coach from the coach
-- dashboard: "Appels entrants" (is the adviser taking calls?) and "Booster"
-- (does the adviser get priority?).
--
-- PURELY ADDITIVE: one new table. `users` and every other existing table are
-- left exactly as they are, and no existing row is read or written. Safe to run
-- more than once.
--
-- No row for an adviser means the defaults — taking calls, not boosted — so
-- there is nothing to backfill.
--
-- RUN THIS BEFORE (or immediately after) deploying the matching code. Until it
-- has run, only the coach dashboard's action buttons are affected; login and
-- every other screen keep working, which is why this lives in its own table
-- instead of as columns on `users`.

CREATE TABLE IF NOT EXISTS advisor_call_settings (
  "userId"           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  "isActiveForCalls" BOOLEAN       NOT NULL DEFAULT true,
  "isBoosted"        BOOLEAN       NOT NULL DEFAULT false,
  "updatedAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById"      TEXT
);

-- A table created in Supabase's `public` schema is reachable through the REST
-- API with the anon key unless row-level security is on, and this one controls
-- who receives calls. Enabling RLS with no policy denies that route entirely;
-- the app is unaffected because Prisma connects with the privileged `postgres`
-- role, which bypasses RLS.
--
-- (Worth checking that your other tables are locked down the same way — this
-- file only handles the table it creates.)
ALTER TABLE advisor_call_settings ENABLE ROW LEVEL SECURITY;

-- Verify.
SELECT count(*) AS rows_in_advisor_call_settings FROM advisor_call_settings;
