// src/lib/azzurDispatch.ts
//
// Browser-side driver of a dispatch to the CRMs: calls /api/admin/azzur/send slice by slice
// (the server recomputes the leads each time — one per number, first adviser, configured
// links only) and reports progress. Used right after an Excel import when
// "Envois automatiques" is on.
import { fetchJson } from "@/lib/fetchJson";

export type DispatchOutcome = {
  reference: string; category: string; route?: string;
  outcome: "sent" | "duplicate" | "skipped" | "failed"; status?: number; detail: string;
};
export type DispatchSummary = {
  total: number; sent: number; duplicates: number; failed: number; skipped: number;
  /** Leads of categories without a configured link: kept in the database, not sent. */
  keptLocal: number;
  byCategory: Record<string, { sent: number; duplicates: number; failed: number; skipped: number }>;
  problems: DispatchOutcome[];
};

type SendResponse = {
  total: number; nextOffset: number | null; keptLocal?: number;
  sent: number; duplicates: number; failed: number; skipped: number; results: DispatchOutcome[];
};

const SLICE = 50;

export async function dispatchAll(
  source: string,
  onProgress: (done: number, total: number) => void
): Promise<DispatchSummary> {
  const sum: DispatchSummary = { total: 0, sent: 0, duplicates: 0, failed: 0, skipped: 0, keptLocal: 0, byCategory: {}, problems: [] };
  let offset: number | null = 0;
  while (offset !== null) {
    const res: SendResponse = await fetchJson<SendResponse>("/api/admin/azzur/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, category: "ALL", offset, limit: SLICE, confirm: true }),
    });
    sum.total = res.total;
    sum.keptLocal = res.keptLocal ?? sum.keptLocal;
    sum.sent += res.sent; sum.duplicates += res.duplicates; sum.failed += res.failed; sum.skipped += res.skipped;
    for (const r of res.results) {
      const c = (sum.byCategory[r.category] ??= { sent: 0, duplicates: 0, failed: 0, skipped: 0 });
      if (r.outcome === "sent") c.sent++;
      else if (r.outcome === "duplicate") c.duplicates++;
      else if (r.outcome === "failed") c.failed++;
      else c.skipped++;
      if (r.outcome === "failed" || r.outcome === "skipped") sum.problems.push(r);
    }
    onProgress(res.nextOffset ?? res.total, res.total);
    offset = res.nextOffset;
  }
  return sum;
}
