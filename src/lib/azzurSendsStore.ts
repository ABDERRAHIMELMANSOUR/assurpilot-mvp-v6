// src/lib/azzurSendsStore.ts
//
// The journal of what was actually sent to the CRMs (table azzur_sends): for every fiche, the
// number, the link, the adviser, the id_user put in the request and AZZUR's answer — the new
// fiche's id, or "DOUBLON:<id>" naming the fiche AZZUR already had. It answers "why is this
// fiche under that adviser?" from the facts, and it stops a number from being sent twice:
// AZZUR files a second fiche as "Doublon Fiche" under a user of ITS choosing, whatever
// id_user says.
//
// New table, created on first use (CREATE TABLE IF NOT EXISTS), no existing table touched.
// Writing is best effort: a journal failure never fails or undoes a send.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PushResult } from "@/lib/azzur";

export const AZZUR_SENDS_SQL = `CREATE TABLE IF NOT EXISTS public.azzur_sends (
  "id" BIGSERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reference" TEXT NOT NULL,
  "number" TEXT NOT NULL DEFAULT '',
  "route" TEXT,
  "adviserId" TEXT,
  "adviserName" TEXT,
  "idUser" TEXT,
  "idUserWhy" TEXT,
  "outcome" TEXT NOT NULL,
  "status" INTEGER,
  "azzurFicheId" TEXT,
  "detail" TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "azzur_sends_number_idx" ON public.azzur_sends ("number", "route");
CREATE INDEX IF NOT EXISTS "azzur_sends_createdAt_idx" ON public.azzur_sends ("createdAt");
ALTER TABLE public.azzur_sends ENABLE ROW LEVEL SECURITY;`;

export type AzzurSendRow = {
  id: string;
  createdAt: string;
  reference: string;
  number: string;
  route: string | null;
  adviserName: string | null;
  idUser: string | null;
  idUserWhy: string | null;
  outcome: string;
  azzurFicheId: string | null;
  detail: string;
};

let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  // One statement per call: the driver does not run several in one prepared statement.
  for (const statement of AZZUR_SENDS_SQL.split(/;\s*\n?/).map((x) => x.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
  ensured = true;
}

/** Journals the results of a dispatch. Never throws. */
export async function recordAzzurSends(results: PushResult[]): Promise<void> {
  const rows = results.filter((r) => r.outcome !== "skipped");
  if (!rows.length) return;
  try {
    await ensureTable();
    const values = rows.map((r) =>
      Prisma.sql`(${r.reference}, ${r.number ?? ""}, ${r.route ?? null}, ${r.adviserId ?? null}, ${r.adviserName ?? null}, ${r.idUser ?? null}, ${r.idUserWhy ?? null}, ${r.outcome}, ${r.status ?? null}, ${r.azzurFicheId ?? null}, ${r.detail.slice(0, 1000)})`
    );
    await prisma.$executeRaw`INSERT INTO public.azzur_sends ("reference", "number", "route", "adviserId", "adviserName", "idUser", "idUserWhy", "outcome", "status", "azzurFicheId", "detail") VALUES ${Prisma.join(values)}`;
  } catch (error) {
    console.error("[azzur] journal des envois non écrit:", error instanceof Error ? error.message : error);
  }
}

/**
 * Numbers already filed in AZZUR (sent or answered DOUBLON) on the same link, keyed
 * "<route>|<number>", with when. A number with no journal entry (or an unreadable journal)
 * is not in the map: the journal can only prevent a resend, never block a first send.
 */
export async function alreadySent(
  items: Array<{ number: string; route: string | null }>,
  days = Number(process.env.AZZUR_MER_DEDUPE_DAYS) || 7
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const numbers = [...new Set(items.map((i) => i.number).filter(Boolean))];
  if (!numbers.length) return out;
  try {
    await ensureTable();
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await prisma.$queryRaw<Array<{ number: string; route: string | null; at: Date }>>`
      SELECT "number", "route", MAX("createdAt") AS at FROM public.azzur_sends
      WHERE "number" IN (${Prisma.join(numbers)}) AND "outcome" IN ('sent', 'duplicate') AND "createdAt" >= ${since}
      GROUP BY "number", "route"`;
    for (const r of rows) out.set(`${r.route}|${r.number}`, r.at.toISOString());
  } catch (error) {
    console.error("[azzur] journal des envois illisible:", error instanceof Error ? error.message : error);
  }
  return out;
}

/** The latest journal entries, newest first, for /admin/azzur. */
export async function loadAzzurSends(limit = 200): Promise<{ rows: AzzurSendRow[]; available: boolean }> {
  try {
    await ensureTable();
    const rows = await prisma.$queryRaw<Array<Omit<AzzurSendRow, "id" | "createdAt"> & { id: bigint; createdAt: Date }>>`
      SELECT "id", "createdAt", "reference", "number", "route", "adviserName", "idUser", "idUserWhy", "outcome", "azzurFicheId", "detail"
      FROM public.azzur_sends ORDER BY "createdAt" DESC, "id" DESC LIMIT ${Math.min(Math.max(limit, 1), 1000)}`;
    return { rows: rows.map((r) => ({ ...r, id: String(r.id), createdAt: r.createdAt.toISOString() })), available: true };
  } catch (error) {
    console.error("[azzur] journal des envois illisible:", error instanceof Error ? error.message : error);
    return { rows: [], available: false };
  }
}
