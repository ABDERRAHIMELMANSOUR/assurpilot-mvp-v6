// src/lib/keyyoStore.ts
//
// Storage for the Keyyo "Notification d'appels" webhook:
//   - its secret token and on/off switch, as rows of the settings table azzur_routes
//     ("setting:keyyoWebhookToken", "setting:keyyoWebhookEnabled") — no schema change;
//   - the journal of notifications received (table keyyo_events, created on first use, no
//     existing table touched): what Keyyo sent, which adviser and call it gave, so the mapping
//     can be checked against real traffic. The token is never stored in it.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const TOKEN_KEY = "setting:keyyoWebhookToken";
const ENABLED_KEY = "setting:keyyoWebhookEnabled";

export type KeyyoWebhookSettings = { token: string | null; enabled: boolean };

export async function loadKeyyoWebhookSettings(): Promise<KeyyoWebhookSettings> {
  const rows = await prisma.azzurRoute.findMany({ where: { key: { in: [TOKEN_KEY, ENABLED_KEY] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.url ?? null;
  // KEYYO_WEBHOOK_TOKEN, when set in the environment, wins over the stored one.
  const envToken = (process.env.KEYYO_WEBHOOK_TOKEN ?? "").trim();
  return { token: envToken || get(TOKEN_KEY), enabled: get(ENABLED_KEY) === "true" };
}

async function saveSetting(key: string, url: string, by: string | null) {
  await prisma.azzurRoute.upsert({ where: { key }, create: { key, url, updatedById: by }, update: { url, updatedById: by } });
}

/** A new random token (the previous URL stops working at once). */
export async function regenerateKeyyoToken(by: string | null): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await saveSetting(TOKEN_KEY, token, by);
  return token;
}

export async function setKeyyoWebhookEnabled(enabled: boolean, by: string | null): Promise<void> {
  await saveSetting(ENABLED_KEY, enabled ? "true" : "false", by);
}

/** Constant-time comparison, so the token cannot be guessed from response times. */
export function tokenMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Journal ─────────────────────────────────────────────────────────────────────────
export const KEYYO_EVENTS_SQL = `CREATE TABLE IF NOT EXISTS public.keyyo_events (
  "id" BIGSERIAL PRIMARY KEY,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type" TEXT NOT NULL DEFAULT '',
  "callRef" TEXT,
  "customer" TEXT NOT NULL DEFAULT '',
  "adviserId" TEXT,
  "adviserName" TEXT,
  "callId" TEXT,
  "outcome" TEXT NOT NULL DEFAULT '',
  "params" TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "keyyo_events_receivedAt_idx" ON public.keyyo_events ("receivedAt");
ALTER TABLE public.keyyo_events ENABLE ROW LEVEL SECURITY;`;

let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  for (const statement of KEYYO_EVENTS_SQL.split(/;\s*\n?/).map((x) => x.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
  ensured = true;
}

export type KeyyoEventRow = {
  id: string;
  receivedAt: string;
  type: string;
  callRef: string | null;
  customer: string;
  adviserName: string | null;
  callId: string | null;
  outcome: string;
  params: string;
};

/** Journals one notification. Never throws: the call itself is what matters. */
export async function recordKeyyoEvent(e: {
  type: string; callRef: string | null; customer: string; adviserId: string | null; adviserName: string | null;
  callId: string | null; outcome: string; params: Record<string, unknown>;
}): Promise<void> {
  try {
    await ensureTable();
    // The token is a secret: never journaled.
    const params = Object.fromEntries(Object.entries(e.params).filter(([k]) => !/^(token|key|secret)$/i.test(k)));
    await prisma.$executeRaw`INSERT INTO public.keyyo_events ("type", "callRef", "customer", "adviserId", "adviserName", "callId", "outcome", "params")
      VALUES (${e.type}, ${e.callRef}, ${e.customer}, ${e.adviserId}, ${e.adviserName}, ${e.callId}, ${e.outcome.slice(0, 500)}, ${JSON.stringify(params).slice(0, 2000)})`;
  } catch (error) {
    console.error("[keyyo] journal non écrit:", error instanceof Error ? error.message : error);
  }
}

export async function loadKeyyoEvents(limit = 100): Promise<KeyyoEventRow[]> {
  try {
    await ensureTable();
    const rows = await prisma.$queryRaw<Array<Omit<KeyyoEventRow, "id" | "receivedAt"> & { id: bigint; receivedAt: Date }>>(
      Prisma.sql`SELECT "id", "receivedAt", "type", "callRef", "customer", "adviserName", "callId", "outcome", "params"
        FROM public.keyyo_events ORDER BY "receivedAt" DESC, "id" DESC LIMIT ${Math.min(Math.max(limit, 1), 500)}`
    );
    return rows.map((r) => ({ ...r, id: String(r.id), receivedAt: r.receivedAt.toISOString() }));
  } catch (error) {
    console.error("[keyyo] journal illisible:", error instanceof Error ? error.message : error);
    return [];
  }
}
