-- prisma/sql/010-routing-notifications.sql
--
-- Journal of coach actions shown as alerts and history on /admin/demandes-routage
-- (activation / coupure des appels entrants, boost, conseiller créé / modifié /
-- désactivé). A NEW table: no existing table or row is touched.
--
-- Optional: the application creates this table itself the first time it needs it.
-- Run this file only if that failed (the page then says so), e.g. when the
-- database user may not create tables. Safe to run any number of times. A table
-- of the same name made by another tool, with a shape the app cannot write to, is
-- renamed routing_notifications_old_<timestamp> — never dropped.
--
-- Generated from ROUTING_NOTIFICATIONS_SQL in src/lib/routingNotificationsStore.ts:
-- keep the two identical.

DO $routing_notifications$
DECLARE
  v_suffix text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  r record;
BEGIN
  IF to_regclass('public.routing_notifications') IS NOT NULL AND (
       NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'routing_notifications' AND column_name = 'id' AND data_type = 'text')
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'routing_notifications'
                  AND column_name NOT IN ('id', 'createdAt', 'kind', 'message', 'actorId', 'actorName', 'actorRole', 'adviserId', 'adviserName', 'details', 'readAt', 'readById')
                  AND is_nullable = 'NO' AND column_default IS NULL)
     ) THEN
    EXECUTE format('ALTER TABLE public.routing_notifications RENAME TO %I', 'routing_notifications_old_' || v_suffix);
    FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = format('public.%I', 'routing_notifications_old_' || v_suffix)::regclass LOOP
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', 'routing_notifications_old_' || v_suffix, r.conname, left(r.conname, 40) || '_old_' || v_suffix);
    END LOOP;
    RAISE NOTICE 'routing_notifications avait une autre forme : renommée routing_notifications_old_% (rien n''est supprimé)', v_suffix;
  END IF;

  CREATE TABLE IF NOT EXISTS public.routing_notifications (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "actorRole" TEXT NOT NULL DEFAULT '',
    "adviserId" TEXT,
    "adviserName" TEXT,
    "details" JSONB,
    "readAt" TIMESTAMP(3),
    "readById" TEXT,
    CONSTRAINT "routing_notifications_pkey" PRIMARY KEY ("id")
  );
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "message" TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "actorId" TEXT;
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "actorName" TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "actorRole" TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "adviserId" TEXT;
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "adviserName" TEXT;
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "details" JSONB;
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);
  ALTER TABLE public.routing_notifications ADD COLUMN IF NOT EXISTS "readById" TEXT;
  CREATE INDEX IF NOT EXISTS "routing_notifications_createdAt_idx" ON public.routing_notifications ("createdAt");
  -- Names and actions of staff: not reachable through Supabase's REST API with the anon key.
  ALTER TABLE public.routing_notifications ENABLE ROW LEVEL SECURITY;
END
$routing_notifications$;
