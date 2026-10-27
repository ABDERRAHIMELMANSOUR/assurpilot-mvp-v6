// src/lib/routingNotificationsStore.ts
//
// Writes and reads the coach-action journal behind the alerts on
// /admin/demandes-routage (table routing_notifications, prisma/sql/010).
//
// Recording is BEST EFFORT: a coach's switch is saved first, and a journal that
// cannot be written (table not created yet, database hiccup) is logged and never
// turns the coach's save into an error. If the table is missing, it is created
// on the spot — CREATE TABLE IF NOT EXISTS, nothing else touched — so the
// feature works without anyone running SQL by hand.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ROUTING_EVENT_KINDS,
  routingMessage,
  type RoutingEventDraft,
  type RoutingEventKind,
  type RoutingNotification,
} from "@/lib/routingEvents";

/**
 * Brings routing_notifications to the shape the app needs, from any starting point.
 * Same text as prisma/sql/010-routing-notifications.sql — keep the two in step.
 * A table of that name made by another tool with a required column the app never
 * fills is RENAMED aside (routing_notifications_old_<timestamp>), never dropped.
 */
export const ROUTING_NOTIFICATIONS_SQL = `DO $routing_notifications$
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
$routing_notifications$`;

export const ROUTING_NOTIFICATIONS_HINT =
  "Le journal des actions des coachs n'a pas pu être créé dans la base (droits insuffisants ?) : " +
  "exécutez prisma/sql/010-routing-notifications.sql dans le SQL editor de Supabase.";

function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022", "P2011"].includes(error.code);
}

export async function ensureRoutingNotificationsTable(): Promise<void> {
  await prisma.$executeRawUnsafe(ROUTING_NOTIFICATIONS_SQL);
}

/** Runs `fn`; when the table is missing, creates it once and runs `fn` again. */
async function withTable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    await ensureRoutingNotificationsTable();
    return fn();
  }
}

const fullName = (u: { prenom: string; nom: string }) => `${u.prenom} ${u.nom}`.trim();

/**
 * Journals what `actorId` just did to `adviserId`. Never throws: the action itself
 * has already been saved, and losing a notification must not undo or fail it.
 * An administrator's own actions are journaled already read — they are history,
 * not something to alert the administrators about.
 */
export async function recordRoutingEvents(
  actorId: string,
  adviserId: string,
  drafts: RoutingEventDraft[]
): Promise<void> {
  if (!drafts.length) return;
  try {
    const people = await prisma.user.findMany({
      where: { id: { in: [actorId, adviserId] } },
      select: { id: true, nom: true, prenom: true, role: true },
    });
    const actor = people.find((p) => p.id === actorId);
    const adviser = people.find((p) => p.id === adviserId);
    const actorName = actor ? fullName(actor) : "Utilisateur inconnu";
    const actorRole = actor?.role ?? "";
    const adviserName = adviser ? fullName(adviser) : null;
    const now = new Date();
    const fromAdmin = actorRole === "ADMINISTRATEUR";

    await withTable(() =>
      prisma.routingNotification.createMany({
        data: drafts.map((d) => ({
          kind: d.kind,
          message: routingMessage(d.kind, { name: actorName, role: actorRole }, adviserName, d.details),
          actorId,
          actorName,
          actorRole,
          adviserId,
          adviserName,
          details: d.details ? (d.details as Prisma.InputJsonValue) : Prisma.JsonNull,
          readAt: fromAdmin ? now : null,
          readById: fromAdmin ? actorId : null,
        })),
      })
    );
  } catch (error) {
    console.error("[routing-notifications] journal non écrit:", error instanceof Error ? error.message : error);
  }
}

type Row = {
  id: string;
  createdAt: Date;
  kind: string;
  message: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  adviserId: string | null;
  adviserName: string | null;
  details: Prisma.JsonValue;
  readAt: Date | null;
};

function toNotification(r: Row): RoutingNotification {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    kind: ((ROUTING_EVENT_KINDS as readonly string[]).includes(r.kind) ? r.kind : "ADVISER_UPDATED") as RoutingEventKind,
    message: r.message,
    actorId: r.actorId,
    actorName: r.actorName,
    actorRole: r.actorRole,
    adviserId: r.adviserId,
    adviserName: r.adviserName,
    details: r.details && typeof r.details === "object" && !Array.isArray(r.details) ? (r.details as Record<string, unknown>) : null,
    readAt: r.readAt ? r.readAt.toISOString() : null,
  };
}

export type NotificationFeed = {
  notifications: RoutingNotification[];
  /** Unread alerts in total, not only in this page of history. */
  unread: number;
  tableAvailable: boolean;
  hint?: string;
};

/**
 * The newest `limit` entries (optionally only those after `after`, for polling),
 * plus the unread count. Creates the table on first read, so the page works on a
 * fresh database.
 */
export async function loadNotificationFeed(options: {
  limit?: number;
  after?: Date | null;
  unreadOnly?: boolean;
  countOnly?: boolean;
}): Promise<NotificationFeed> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  try {
    return await withTable(async () => {
      const unread = await prisma.routingNotification.count({ where: { readAt: null } });
      if (options.countOnly) return { notifications: [], unread, tableAvailable: true };
      const where: Prisma.RoutingNotificationWhereInput = {
        ...(options.after ? { createdAt: { gt: options.after } } : {}),
        ...(options.unreadOnly ? { readAt: null } : {}),
      };
      const rows = await prisma.routingNotification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return { notifications: rows.map(toNotification), unread, tableAvailable: true };
    });
  } catch (error) {
    if (!isMissingTable(error) && !(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    console.error("[routing-notifications] lecture impossible:", error instanceof Error ? error.message : error);
    return { notifications: [], unread: 0, tableAvailable: false, hint: ROUTING_NOTIFICATIONS_HINT };
  }
}

/** Marks the given alerts (or every unread one) as read by `adminId`. Returns how many changed. */
export async function markNotificationsRead(adminId: string, ids: string[] | "all"): Promise<number> {
  const res = await withTable(() =>
    prisma.routingNotification.updateMany({
      where: { readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
      data: { readAt: new Date(), readById: adminId },
    })
  );
  return res.count;
}
