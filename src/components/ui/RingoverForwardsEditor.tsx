"use client";
// /admin/keyyo — Ringover numbers fed by the Keyyo standard, SEPARATED BY AGENCY (CPA / ALM).
// Each Ringover number is paired with the standard line it receives the calls of: that line gives
// the agency and the space (Santé / Auto), so the call is filed in the right agency, with the
// adviser of that agency and the right CRM link. A number without its line counts for nothing.
import { useEffect, useMemo, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { useToast } from "@/components/ui/Toast";

export type StandardLine = { numero: string; label: string; agency: "CPA" | "ALM" | null; space: "SANTE" | "AUTO" | null };
export type ForwardRow = {
  ringover: string; keyyo: string | null; label: string | null; agency: StandardLine["agency"]; space: StandardLine["space"]; problem: string | null;
};

type Draft = { key: number; ringover: string; keyyo: string; agency: "CPA" | "ALM" | "AUTRE" };

const AGENCIES: Array<{ id: Draft["agency"]; title: string; tone: string }> = [
  { id: "CPA", title: "Agence CPA", tone: "border-sky-200 bg-sky-50/60" },
  { id: "ALM", title: "Agence ALM", tone: "border-violet-200 bg-violet-50/60" },
];
const SPACE: Record<string, string> = { SANTE: "Santé", AUTO: "Auto" };

let seq = 0;
const toDrafts = (rows: ForwardRow[]): Draft[] =>
  rows.map((r) => ({ key: ++seq, ringover: r.ringover, keyyo: r.keyyo ?? "", agency: r.agency ?? "AUTRE" }));
const signature = (ds: Draft[]) => ds.filter((d) => d.ringover.trim() || d.keyyo).map((d) => `${d.ringover.trim()}=${d.keyyo}`).join("|");

export default function RingoverForwardsEditor({
  rows, envRows, standardLines, onSaved,
}: { rows: ForwardRow[]; envRows: ForwardRow[]; standardLines: StandardLine[]; onSaved: () => void }) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  // Set from the server once; the page refresh every 10 s must not overwrite what is being typed.
  useEffect(() => {
    if (drafts !== null) return;
    const d = toDrafts(rows);
    setDrafts(d);
    setSaved(signature(d));
  }, [rows, drafts]);

  const linesOf = useMemo(() => (agency: Draft["agency"]) => standardLines.filter((l) => (l.agency ?? "AUTRE") === agency), [standardLines]);
  const otherLines = linesOf("AUTRE");
  const groups = otherLines.length || drafts?.some((d) => d.agency === "AUTRE")
    ? [...AGENCIES, { id: "AUTRE" as const, title: "Lignes sans agence", tone: "border-slate-200 bg-white" }]
    : AGENCIES;

  if (!drafts) return null;
  const dirty = signature(drafts) !== saved;
  const update = (key: number, patch: Partial<Draft>) => setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  async function save() {
    setBusy(true);
    try {
      const r = await fetchJson<{ ringoverForwards: ForwardRow[] }>("/api/admin/keyyo/webhook", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ringoverNumbers", entries: drafts!.map((d) => ({ ringover: d.ringover, keyyo: d.keyyo })) }),
      });
      const d = toDrafts(r.ringoverForwards);
      setDrafts(d);
      setSaved(signature(d));
      onSaved();
      toast.success("Numéros Ringover enregistrés, chacun avec sa ligne du standard.");
    } catch (e) { toast.error(errorMessage(e, "Enregistrement impossible.")); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-slate-700">Numéros Ringover qui reçoivent les renvois du standard Keyyo</p>
      <p className="text-[11px] text-slate-500">
        Chaque numéro Ringover est associé à <b>la ligne du standard Keyyo</b> dont il reçoit les appels : elle fixe l&apos;agence (CPA / ALM) et l&apos;espace
        (Santé / Auto). L&apos;appel est classé sur cette ligne, attribué au conseiller de cette agence et envoyé au CRM de cette agence. Un numéro sans
        sa ligne n&apos;est pas pris en compte.
      </p>

      <div className="grid gap-2 md:grid-cols-2 mt-2">
        {groups.map((g) => {
          const lines = linesOf(g.id);
          const mine = drafts.filter((d) => d.agency === g.id);
          return (
            <div key={g.id} className={`rounded-lg border p-2 ${g.tone}`}>
              <p className="text-[11px] font-semibold text-slate-700 mb-1">{g.title}</p>
              {mine.length === 0 && <p className="text-[11px] text-slate-400 mb-1">Aucun numéro Ringover.</p>}
              {mine.map((d) => {
                const row = rows.find((r) => r.ringover === d.ringover.trim() && (r.keyyo ?? "") === d.keyyo);
                return (
                  <div key={d.key} className="mb-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        aria-label={`Numéro Ringover (${g.title})`} className="input text-xs font-mono w-36" placeholder="N° Ringover"
                        value={d.ringover} onChange={(e) => update(d.key, { ringover: e.target.value })}
                      />
                      <span className="text-[11px] text-slate-500">reçoit</span>
                      <select
                        aria-label={`Ligne du standard Keyyo (${g.title})`} className="input text-xs flex-1 min-w-[170px]"
                        value={d.keyyo} onChange={(e) => update(d.key, { keyyo: e.target.value })}
                      >
                        <option value="">— ligne du standard {g.id !== "AUTRE" ? g.id : ""} —</option>
                        {lines.map((l) => (
                          <option key={l.numero} value={l.numero}>{l.space && l.agency ? `Standard ${SPACE[l.space]} ${l.agency} — ` : ""}{l.label} · {l.numero}</option>
                        ))}
                        {d.keyyo && !lines.some((l) => l.numero === d.keyyo) && <option value={d.keyyo}>{d.keyyo} (pas une ligne de cette agence)</option>}
                      </select>
                      <button type="button" className="btn btn-secondary text-xs" onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}>Retirer</button>
                    </div>
                    {(row?.problem || (!d.keyyo && d.ringover.trim())) && (
                      <p className="text-[11px] text-amber-700 mt-0.5">{row?.problem ?? "Choisissez la ligne du standard Keyyo."}</p>
                    )}
                  </div>
                );
              })}
              {g.id !== "AUTRE" && (
                <button
                  type="button" className="text-[11px] font-medium text-brand-600 hover:underline disabled:opacity-40" disabled={!lines.length}
                  onClick={() => setDrafts([...drafts, { key: ++seq, ringover: "", keyyo: lines.length === 1 ? lines[0].numero : "", agency: g.id }])}
                >
                  + Ajouter un numéro Ringover {g.id}
                </button>
              )}
              {g.id !== "AUTRE" && !lines.length && <p className="text-[11px] text-slate-400">Aucune ligne {g.id} active dans le standard.</p>}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <button className="btn btn-primary text-xs" disabled={busy || !dirty} onClick={save}>Enregistrer</button>
        {dirty && <span className="text-[11px] text-amber-700">Modifications non enregistrées.</span>}
      </div>

      {envRows.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-2">
          Aussi, depuis Vercel (RINGOVER_KEYYO_NUMBERS) :{" "}
          {envRows.map((r) => (
            <span key={r.ringover} className="font-mono mr-2">
              {r.ringover} → {r.label ?? r.keyyo ?? "?"}{r.agency ? ` (${r.agency})` : ""}{r.problem ? ` — ${r.problem}` : ""}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
