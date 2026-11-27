// src/lib/whatsapp/tables.ts
//
// Creates the WhatsApp tables on first use, as the Keyyo and routing journals do,
// so the feature works without anyone running SQL by hand. CREATE ... IF NOT
// EXISTS only: nothing else is touched. Same text as prisma/sql/011-whatsapp.sql.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const WHATSAPP_SQL = `DO $whatsapp$
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
$whatsapp$`;

export const WHATSAPP_TABLES_HINT =
  "Les tables WhatsApp n'ont pas pu être créées dans la base (droits insuffisants ?) : " +
  "exécutez prisma/sql/011-whatsapp.sql dans le SQL editor.";

let ready: Promise<void> | null = null;

/** Runs the CREATE once per process; a failure is retried on the next call. */
export function ensureWhatsAppTables(): Promise<void> {
  if (!ready) {
    ready = prisma.$executeRawUnsafe(WHATSAPP_SQL).then(
      () => undefined,
      (error) => {
        ready = null;
        console.error("[whatsapp] table creation failed:", error);
        throw error;
      }
    );
  }
  return ready;
}

/** True when Prisma says a WhatsApp table does not exist (yet). */
export function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

/**
 * Runs `fn`; if a WhatsApp table is missing, creates the tables and tries once more.
 * The common path costs nothing: no DDL runs while the tables exist.
 */
export async function withWhatsAppTables<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    await ensureWhatsAppTables();
    return fn();
  }
}
