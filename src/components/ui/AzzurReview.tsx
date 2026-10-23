"use client";

// Pre-send review for AZZUR: pick calls (an Excel import or today), see how many leads
// go to each of the four links and which repeated numbers are ignored, then send —
// one link at a time or all at once — only when the administrator asks.
// The rules are in src/lib/azzurReview.ts; the server recomputes them on every send.
import { useCallback, useEffect, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";

type Source = { source: string; label: string; calls: number; at?: string };
type Sources = { today: Source; batches: Source[] };

type Adviser = { name: string; leads: number; duplicates: number; alreadyReceived: number };
type Category = {
  id: string; label: string; calls: number; leads: number; duplicates: number; alreadyReceived: number;
  advisers: Adviser[]; target: string; dedicated: boolean; sample: Record<string, string> | null;
};
type LeadRow = {
  number: string; category: string; conseiller: string | null; team: string | null;
  firstAt: string; calls: number; duplicates: number; fromHistory: boolean;
};
type Review = {
  ready: boolean; problem: string | null;
  selection: { label: string; calls: number; from: string | null; to: string | null };
  includeHistory: boolean; historyDays: number; truncated: boolean;
  totals: { calls: number; leads: number; duplicates: number; alreadyReceived: number };
  noNumber: number; categories: Category[]; leads: LeadRow[]; leadsTruncated: boolean;
};

type Outcome = { reference: string; category: string; outcome: "sent" | "duplicate" | "skipped" | "failed"; status?: number; detail: string };
type SendSummary = { sent: number; duplicates: number; failed: number; skipped: number; failures: Outcome[] };
type SendResponse = {
  total: number; processed: number; nextOffset: number | null;
  sent: number; duplicates: number; failed: number; skipped: number; results: Outcome[];
};

const SLICE = 50;

export default function AzzurReview({ ready }: { ready: boolean }) {
  const [sources, setSources] = useState<Sources | null>(null);
  const [source, setSource] = useState("");
  const [includeHistory, setIncludeHistory] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  // Sending state: which category is going out, how far, and what came back.
  const [sending, setSending] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<Record<string, SendSummary>>({});

  const analyze = useCallback(async (src: string, history: boolean) => {
    setLoading(true); setError(""); setDone({}); setOpen(null);
    try {
      setReview(await fetchJson<Review>("/api/admin/azzur/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: src, includeHistory: history }),
      }));
    } catch (e) { setReview(null); setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchJson<Sources>("/api/admin/azzur/sources");
        setSources(s);
        // /admin/azzur?source=batch:ID comes from the import page; else the latest import.
        const wanted = new URLSearchParams(window.location.search).get("source");
        const known = [s.today, ...s.batches].map((x) => x.source);
        const initial = wanted && known.includes(wanted) ? wanted : s.batches[0]?.source ?? s.today.source;
        setSource(initial);
        if (wanted && known.includes(wanted)) void analyze(initial, false);
      } catch (e) { setError(errorMessage(e)); }
    })();
  }, [analyze]);

  async function send(category: string, label: string, count: number) {
    if (!review || sending) return;
    const what = category === "ALL" ? "TOUTES les fiches" : `les fiches ${label}`;
    if (!window.confirm(
      `Envoyer ${count} fiche(s) vers AZZUR (${what}) ?\n\nLes fiches seront réellement créées dans le CRM. ` +
      `Les doublons ignorés et les numéros déjà reçus ne sont pas envoyés.`)) return;

    setSending(category); setError("");
    const total: SendSummary = { sent: 0, duplicates: 0, failed: 0, skipped: 0, failures: [] };
    try {
      let offset: number | null = 0;
      while (offset !== null) {
        const res: SendResponse = await fetchJson<SendResponse>("/api/admin/azzur/send", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source, includeHistory, category, exclude: Object.keys(done).filter((k) => k !== "ALL"), offset, limit: SLICE, confirm: true }),
        });
        total.sent += res.sent; total.duplicates += res.duplicates; total.failed += res.failed; total.skipped += res.skipped;
        total.failures.push(...res.results.filter((r) => r.outcome === "failed" || r.outcome === "skipped"));
        setProgress({ done: (res.nextOffset ?? res.total), total: res.total });
        offset = res.nextOffset;
      }
      // Remember what went out so the same button cannot be pressed twice by accident.
      const marks = category === "ALL" ? review.categories.map((c) => c.id) : [category];
      setDone((d) => {
        const next = { ...d };
        if (category === "ALL") {
          for (const r of marks) next[r] = { sent: 0, duplicates: 0, failed: 0, skipped: 0, failures: [] };
          next.ALL = total;
        } else next[category] = total;
        return next;
      });
    } catch (e) {
      setError(errorMessage(e, "L'envoi a été interrompu.") + " Certaines fiches ont peut-être déjà été envoyées : AZZUR les reconnaît comme doublons si vous relancez.");
    } finally { setSending(null); setProgress(null); }
  }

  // What "send all" would still send: the leads of the links not already sent.
  const sendable = review ? review.categories.filter((c) => !done[c.id]).reduce((n, c) => n + c.leads, 0) : 0;

  return (
    <div className="card p-4 mb-5">
      <h2 className="text-sm font-semibold text-slate-800 mb-1">Envoi vers AZZUR : vérification avant envoi</h2>
      <p className="text-xs text-slate-500 mb-3">
        Rien n&apos;est envoyé à l&apos;import. Choisissez les appels, vérifiez la répartition par lien, puis lancez l&apos;envoi.
        Un numéro n&apos;est envoyé qu&apos;une fois, au <b>premier conseiller</b> qui l&apos;a reçu ; ses autres appels sont des doublons ignorés.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-xs text-slate-500">
          <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Appels à examiner</span>
          <select value={source} onChange={(e) => { setSource(e.target.value); setReview(null); setDone({}); }}
            className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white min-w-[280px]">
            {sources?.batches.map((b) => (
              <option key={b.source} value={b.source}>
                Import : {b.label} — {b.at ? new Date(b.at).toLocaleString("fr-FR") : ""} ({b.calls} appels)
              </option>
            ))}
            {sources && <option value={sources.today.source}>Appels d&apos;aujourd&apos;hui ({sources.today.calls})</option>}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 pb-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={includeHistory}
            onChange={(e) => { setIncludeHistory(e.target.checked); setReview(null); setDone({}); }}
            className="w-3.5 h-3.5 rounded border-slate-300" />
          Inclure les numéros déjà reçus avant (au premier conseiller)
        </label>
        <button className="btn-primary" disabled={!source || loading || !!sending} onClick={() => analyze(source, includeHistory)}>
          {loading ? "Analyse…" : "Analyser"}
        </button>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {review && !review.ready && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Envoi impossible : {review.problem ?? "intégration AZZUR désactivée (AZZUR_WEBHOOK_ENABLED / AZZUR_MER_URL)."}
        </div>
      )}
      {review?.truncated && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Volume très élevé : l&apos;analyse est partielle. Réduisez la sélection.
        </div>
      )}

      {review && (
        <>
          <p className="text-sm text-slate-700 mb-1">
            <b>{review.selection.label}</b> : {review.selection.calls} appel(s) →{" "}
            <b>{review.totals.leads} fiche(s) à envoyer</b>, {review.totals.duplicates} doublon(s) ignoré(s)
            {review.totals.alreadyReceived > 0 && <>, {review.totals.alreadyReceived} déjà reçu(s) avant</>}
            {review.noNumber > 0 && <>, {review.noNumber} sans numéro</>}.
          </p>
          <p className="text-[11px] text-slate-400 mb-3">
            Historique pris en compte : {review.historyDays} jours avant la sélection.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: "860px" }}>
              <thead className="bg-slate-50/70 border-b border-slate-100">
                <tr>
                  <th className="table-th">Lien</th>
                  <th className="table-th">Destination</th>
                  <th className="table-th text-right">Appels</th>
                  <th className="table-th text-right">Fiches à envoyer</th>
                  <th className="table-th text-right">Doublons ignorés</th>
                  <th className="table-th text-right">Déjà reçus</th>
                  <th className="table-th">Conseillers</th>
                  <th className="table-th text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {review.categories.map((c) => {
                  const sent = done[c.id] ?? (done.ALL ? { sent: 0, duplicates: 0, failed: 0, skipped: 0, failures: [] } : undefined);
                  return (
                    <Row key={c.id} c={c} review={review} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)}
                      sendingThis={sending === c.id || sending === "ALL"}
                      disabled={!review.ready || !!sending || c.leads === 0 || !!sent}
                      sentFlag={!!sent}
                      onSend={() => send(c.id, c.label, c.leads)} />
                  );
                })}
                <tr className="bg-slate-50/70 font-semibold">
                  <td className="table-td" colSpan={2}>Total</td>
                  <td className="table-td text-right">{review.totals.calls}</td>
                  <td className="table-td text-right">{review.totals.leads}</td>
                  <td className="table-td text-right">{review.totals.duplicates}</td>
                  <td className="table-td text-right">{review.totals.alreadyReceived}</td>
                  <td className="table-td" />
                  <td className="table-td text-right">
                    <button className="btn-primary" disabled={!review.ready || !!sending || sendable === 0 || !!done.ALL}
                      onClick={() => send("ALL", "toutes", sendable)}>
                      {sending === "ALL" ? "Envoi…" : done.ALL ? "Tout envoyé ✓" : "Confirmer et envoyer tout"}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {sending && progress && (
            <div className="mt-3">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
              </div>
              <p className="text-xs text-slate-500 mt-1">Envoi : {progress.done} / {progress.total}</p>
            </div>
          )}

          {Object.keys(done).length > 0 && <SendReport done={done} />}
        </>
      )}
    </div>
  );
}

function Row({ c, review, open, onToggle, sendingThis, disabled, sentFlag, onSend }: {
  c: Category; review: Review; open: boolean; onToggle: () => void;
  sendingThis: boolean; disabled: boolean; sentFlag: boolean; onSend: () => void;
}) {
  const leads = review.leads.filter((l) => l.category === c.id).slice(0, 100);
  const names = c.advisers.slice(0, 3).map((a) => `${a.name} (${a.leads + a.alreadyReceived})`).join(", ") + (c.advisers.length > 3 ? ` +${c.advisers.length - 3}` : "");
  return (
    <>
      <tr className="hover:bg-slate-50/60">
        <td className="table-td font-semibold whitespace-nowrap">{c.label}</td>
        <td className="table-td text-xs font-mono">
          {c.target}
          {!c.dedicated && c.id !== "PRINCIPAL" && <span className="ml-1 badge badge-gray" style={{ fontSize: "10px", padding: "1px 5px" }}>lien principal</span>}
        </td>
        <td className="table-td text-right">{c.calls}</td>
        <td className="table-td text-right font-semibold">{c.leads}</td>
        <td className="table-td text-right">{c.duplicates}</td>
        <td className="table-td text-right">{c.alreadyReceived}</td>
        <td className="table-td text-xs text-slate-600">{names || "—"}</td>
        <td className="table-td text-right whitespace-nowrap">
          <button className="text-xs text-brand-600 hover:underline mr-3" onClick={onToggle}>{open ? "Masquer" : "Détails"}</button>
          <button className="btn-secondary" disabled={disabled} onClick={onSend}>
            {sendingThis ? "Envoi…" : sentFlag ? "Envoyé ✓" : "Envoyer vers AZZUR"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="px-4 pb-4 bg-slate-50/40">
            <div className="grid md:grid-cols-2 gap-4 pt-3">
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Conseillers (premier appel)</p>
                {c.advisers.length === 0 ? <p className="text-xs text-slate-400">Aucun.</p> : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-slate-400"><th className="text-left font-medium">Conseiller</th><th className="text-right font-medium">Fiches</th><th className="text-right font-medium">Doublons</th><th className="text-right font-medium">Déjà reçus</th></tr></thead>
                    <tbody>{c.advisers.map((a) => (
                      <tr key={a.name}><td>{a.name}</td><td className="text-right">{a.leads}</td><td className="text-right">{a.duplicates}</td><td className="text-right">{a.alreadyReceived}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Exemple de fiche envoyée</p>
                {c.sample ? <pre className="bg-white border border-slate-100 rounded-lg p-2 text-[11px] overflow-x-auto">{JSON.stringify(c.sample, null, 1)}</pre> : <p className="text-xs text-slate-400">Aucune fiche.</p>}
              </div>
            </div>
            {leads.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Fiches ({leads.length}{c.leads > leads.length ? ` premières sur ${c.leads}` : ""})
                </p>
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-400"><th className="text-left font-medium">Numéro</th><th className="text-left font-medium">Premier conseiller</th><th className="text-left font-medium">Premier appel</th><th className="text-right font-medium">Appels</th><th className="text-right font-medium">Doublons</th></tr></thead>
                  <tbody>{leads.map((l) => (
                    <tr key={l.number}>
                      <td className="font-mono">{l.number}</td>
                      <td>{l.conseiller ?? "—"}{l.fromHistory && <span className="ml-1 badge badge-yellow" style={{ fontSize: "10px", padding: "1px 5px" }}>historique</span>}</td>
                      <td>{new Date(l.firstAt).toLocaleString("fr-FR")}</td>
                      <td className="text-right">{l.calls}</td><td className="text-right">{l.duplicates}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function SendReport({ done }: { done: Record<string, SendSummary> }) {
  const entries = Object.entries(done).filter(([, s]) => s.sent + s.duplicates + s.failed + s.skipped > 0);
  if (entries.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm">
      <p className="font-semibold text-slate-800 mb-1">Résultat de l&apos;envoi</p>
      {entries.map(([k, s]) => (
        <div key={k} className="mb-2">
          <p className="text-slate-700">
            {k === "ALL" ? "Tout" : k.replace("_", " ")} : <b>{s.sent}</b> créée(s) · {s.duplicates} déjà dans AZZUR · <b className={s.failed ? "text-rose-600" : ""}>{s.failed}</b> échec(s)
            {s.skipped > 0 && <> · {s.skipped} ignorée(s)</>}
          </p>
          {s.failures.slice(0, 5).map((f) => (
            <p key={f.reference} className="text-xs font-mono text-rose-700 break-all">{f.category} {f.reference} — {f.detail}</p>
          ))}
          {s.failures.length > 5 && <p className="text-xs text-slate-400">… {s.failures.length - 5} autre(s) échec(s) : voir « Derniers envois » ci-dessous.</p>}
        </div>
      ))}
    </div>
  );
}
