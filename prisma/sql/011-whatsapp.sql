-- prisma/sql/011-whatsapp.sql
--
-- WhatsApp Cloud API: conversations, messages and the log of main/backup switches.
-- NEW tables only: no existing table or row is touched.
--
-- Optional: the application creates these tables itself the first time it needs
-- them (src/lib/whatsapp/tables.ts). Run this file only if that failed, e.g. when
-- the database user may not create tables. Safe to run any number of times.
--
-- Generated from WHATSAPP_SQL in src/lib/whatsapp/tables.ts: keep the two identical.

DO $whatsapp$
BEGIN
  CREATE TABLE IF NOT EXISTS public."wa_conversations" (
      "id" TEXT NOT NULL,
      "waId" TEXT NOT NULL,
      "clientPhone" TEXT NOT NULL DEFAULT '',
      "clientName" TEXT NOT NULL DEFAULT '',
      "ownerUserId" TEXT,
      "assignedAt" TIMESTAMP(3),
      "assignedById" TEXT,
      "lastInboundAt" TIMESTAMP(3),
      "lastInboundPhoneNumberId" TEXT,
      "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastMessagePreview" TEXT NOT NULL DEFAULT '',
      "unreadCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "wa_conversations_pkey" PRIMARY KEY ("id")
  );

  CREATE TABLE IF NOT EXISTS public."wa_messages" (
      "id" TEXT NOT NULL,
      "conversationId" TEXT NOT NULL,
      "direction" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'text',
      "body" TEXT NOT NULL DEFAULT '',
      "templateName" TEXT,
      "templateLanguage" TEXT,
      "templateParams" JSONB,
      "waMessageId" TEXT,
      "phoneNumberId" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL,
      "errorCode" TEXT,
      "errorTitle" TEXT,
      "sentById" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "statusAt" TIMESTAMP(3),

      CONSTRAINT "wa_messages_pkey" PRIMARY KEY ("id")
  );

  CREATE TABLE IF NOT EXISTS public."wa_switch_log" (
      "id" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "fromSlot" TEXT NOT NULL,
      "toSlot" TEXT NOT NULL,
      "actorId" TEXT,
      "actorName" TEXT NOT NULL DEFAULT '',

      CONSTRAINT "wa_switch_log_pkey" PRIMARY KEY ("id")
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "wa_conversations_waId_key" ON public."wa_conversations"("waId");
  CREATE INDEX IF NOT EXISTS "wa_conversations_ownerUserId_lastMessageAt_idx" ON public."wa_conversations"("ownerUserId", "lastMessageAt");
  CREATE INDEX IF NOT EXISTS "wa_conversations_lastMessageAt_idx" ON public."wa_conversations"("lastMessageAt");
  CREATE INDEX IF NOT EXISTS "wa_conversations_clientPhone_idx" ON public."wa_conversations"("clientPhone");
  CREATE UNIQUE INDEX IF NOT EXISTS "wa_messages_waMessageId_key" ON public."wa_messages"("waMessageId");
  CREATE INDEX IF NOT EXISTS "wa_messages_conversationId_createdAt_idx" ON public."wa_messages"("conversationId", "createdAt");
  CREATE INDEX IF NOT EXISTS "wa_switch_log_createdAt_idx" ON public."wa_switch_log"("createdAt");
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_conversations_ownerUserId_fkey') THEN
    ALTER TABLE public."wa_conversations" ADD CONSTRAINT "wa_conversations_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES public."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_messages_conversationId_fkey') THEN
    ALTER TABLE public."wa_messages" ADD CONSTRAINT "wa_messages_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES public."wa_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Client numbers and message content: not reachable through Supabase's REST API with the anon key.
  ALTER TABLE public."wa_conversations" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public."wa_messages" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public."wa_switch_log" ENABLE ROW LEVEL SECURITY;
END
$whatsapp$;
