// src/lib/azzurReviewData.ts
//
// Loads what the AZZUR review needs from the database and hands it to the pure
// logic in azzurReview.ts. Shared by the review and the send endpoints, so a send
// is ALWAYS computed from the same rules the admin just looked at — the browser
// never supplies the list of calls to send.
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/api";
import { normalizePhone } from "@/lib/phone";
import { parisDayBounds, type AzzurCallEvent } from "@/lib/azzur";
import { buildReview, type Lead, type Review, type ReviewCall } from "@/lib/azzurReview";

export type ReviewSource = { kind: "batch"; id: string } | { kind: "today" };

/** Calls scanned per review; beyond this the review says it is partial. */
const MAX_SCAN = 100_000;

export function parseSource(raw: unknown): ReviewSource {
  if (raw === "today") return { kind: "today" };
  if (typeof raw === "string" && raw.startsWith("batch:") && raw.length > 6) return { kind: "batch", id: raw.slice(6) };
  throw badRequest('source doit être "today" ou "batch:<id>"');
}

/** How many days before the selection a number may already have been received. */
export function historyDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.AZZUR_MER_DEDUPE_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 60) : 7;
}

export type LoadedReview = {
  review: Review;
  selection: { label: string; calls: number; from: string | null; to: string | null };
  historyDays: number;
  /** The scan hit its cap: figures are partial. */
  truncated: boolean;
};

export async function loadReview(source: ReviewSource, includeHistory: boolean): Promise<LoadedReview> {
  const days = historyDays();

  let label: string;
  let where: { importBatchId: string } | { startedAt: { gte: Date; lt: Date } };
  if (source.kind === "batch") {
    const batch = await prisma.importBatch.findUnique({ where: { id: source.id }, select: { fileName: true, createdAt: true } });
    if (!batch) throw badRequest("Import introuvable");
    label = `Import « ${batch.fileName} » du ${batch.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`;
    where = { importBatchId: source.id };
  } else {
    const { start, end } = parisDayBounds();
    label = "Appels d'aujourd'hui";
    where = { startedAt: { gte: start, lt: end } };
  }

  const select = {
    id: true, callerNumber: true, startedAt: true, durationSeconds: true, isMissed: true,
    phoneLineId: true, assignedUserId: true,
  } as const;

  const selected = await prisma.call.findMany({ where, select, take: MAX_SCAN + 1 });
  let truncated = selected.length > MAX_SCAN;
  if (truncated) selected.pop();

  if (selected.length === 0) {
    return { review: buildReview([]), selection: { label, calls: 0, from: null, to: null }, historyDays: days, truncated };
  }

  const times = selected.map((c) => c.startedAt.getTime());
  const from = new Date(Math.min(...times));
  const to = new Date(Math.max(...times));
  const selectedIds = new Set(selected.map((c) => c.id));
  const numbers = new Set(selected.map((c) => normalizePhone(c.callerNumber)).filter(Boolean));

  // Earlier calls on the same numbers, to find who really took each one FIRST.
  const windowStart = new Date(from.getTime() - days * 86_400_000);
  const around = await prisma.call.findMany({
    where: { startedAt: { gte: windowStart, lte: to } },
    select,
    take: MAX_SCAN + 1,
  });
  if (around.length > MAX_SCAN) { truncated = true; around.pop(); }
  const history = around.filter((c) => !selectedIds.has(c.id) && numbers.has(normalizePhone(c.callerNumber)));

  const [users, teams, lines] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true, nom: true, prenom: true, teamId: true } }),
    prisma.team.findMany({ select: { id: true, nom: true } }),
    prisma.phoneLine.findMany({ select: { id: true, label: true } }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.nom]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const lineLabel = new Map(lines.map((l) => [l.id, l.label]));

  const toReviewCall = (c: (typeof selected)[number], inSelection: boolean): ReviewCall => {
    const u = c.assignedUserId ? userById.get(c.assignedUserId) : undefined;
    return {
      id: c.id,
      callerNumber: c.callerNumber,
      startedAt: c.startedAt,
      durationSeconds: c.durationSeconds,
      isMissed: c.isMissed,
      inSelection,
      conseiller: u ? { id: u.id, email: u.email, nom: u.nom, prenom: u.prenom } : null,
      teamName: u?.teamId ? teamName.get(u.teamId) ?? null : null,
      lineLabel: lineLabel.get(c.phoneLineId) ?? null,
    };
  };

  const review = buildReview(
    [...selected.map((c) => toReviewCall(c, true)), ...history.map((c) => toReviewCall(c, false))],
    { includeHistory }
  );
  return {
    review,
    selection: { label, calls: selected.length, from: from.toISOString(), to: to.toISOString() },
    historyDays: days,
    truncated,
  };
}

/** The event pushed to AZZUR for a lead: its first attempt. */
export function eventForLead(lead: Lead): AzzurCallEvent {
  const c = lead.owner;
  return {
    reference: `call:${c.id}`,
    externalId: c.id.slice(-24),
    callerNumber: c.callerNumber,
    startedAt: c.startedAt,
    isMissed: c.isMissed,
    lineLabel: c.lineLabel,
    conseiller: c.conseiller ? { email: c.conseiller.email, nom: c.conseiller.nom, prenom: c.conseiller.prenom } : null,
    teamName: c.teamName,
  };
}
