"use client";

// Reconciliation of the CPA / ALM standard lines against the advisers who
// answered on them, with duplicate counts. The counting rules are in
// src/lib/lineStats.ts; this page only asks for them and lays them out.
import { useCallback, useEffect, useMemo, useState } from "react";
import StatCard from "@/components/ui/StatCard";
import { errorMessage, fetchJson } from "@/lib/fetchJson";

type Period = "today" | "week" | "month" | "custom";
type Entity = "" | "ALM" | "CPA";
type View = "gross" | "net";
type CategoryKey = "CPA>ALM" | "ALM>ALM" | "CPA>CPA" | "ALM>CPA";

type CategoryStats = {
  key: CategoryKey;
  source: "ALM" | "CPA";
  adviser: "ALM" | "CPA";
  label: string;
  gross: number;
  unique: number;
  doublons: number;
};

type Row = {
  id: string;
  callerNumber: string;
  startedAt: string;
  durationSeconds: number;
  categorie: CategoryKey;
  ligne: string;
  conseiller: { nom: string; prenom: string } | null;
  equipe: string | null;
  attemptCount: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
};

type Report = {
  scanned: number;
  truncated: boolean;
  categories: CategoryStats[];
  totals: { gross: number; unique: number; doublons: number };
  other: { manques: number; sansConseiller: number; entiteConseillerInconnue: number; ligneInconnue: number };
  rows: Row[];
  rowsTotal: number;
  rowsTruncated: boolean;
};

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Aujourd'hui" },
  { key: "week", label: "7 derniers jours" },
  { key: "month", label: "Ce mois" },
  { key: "custom", label: "Personnalisé" },
];

const TONE: Record<CategoryKey, "brand" | "indigo" | "emerald" | "amber"> = {
  "CPA>ALM": "amber",
  "ALM>ALM": "brand",
  "CPA>CPA": "emerald",
  "ALM>CPA": "indigo",
};

const SELECT =
  "px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-400";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function StatistiquesLignesPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ligne, setLigne] = useState<Entity>("");
  const [equipe, setEquipe] = useState<Entity>("");
  const [view, setView] = useState<View>("gross");
  const [categorie, setCategorie] = useState<CategoryKey | "">("");

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A custom range is only requested once both ends are chosen; until then the
  // previous figures stay on screen rather than flashing an unbounded query.
  const customReady = period !== "custom" || (dateFrom !== "" && dateTo !== "");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (period === "custom") {
      p.set("dateFrom", dateFrom);
      p.set("dateTo", dateTo);
    } else {
      p.set("period", period);
    }
    if (ligne) p.set("ligne", ligne);
    if (equipe) p.set("equipe", equipe);
    p.set("view", view);
    if (categorie) p.set("categorie", categorie);
    return "?" + p.toString();
  }, [period, dateFrom, dateTo, ligne, equipe, view, categorie]);

  const load = useCallback(async () => {
    if (!customReady) return;
    setLoading(true);
    setError("");
    try {
      setReport(await fetchJson<Report>("/api/admin/stats-lignes" + query));
    } catch (err) {
      setReport(null);
      setError(errorMessage(err, "Impossible de charger les statistiques."));
    } finally {
      setLoading(false);
    }
  }, [query, customReady]);

  useEffect(() => { load(); }, [load]);

  const net = view === "net";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Statistiques des lignes</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Appels répondus, par ligne standard d&apos;arrivée et par entité du conseiller qui a décroché.
        </p>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-5 flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Période</p>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  period === p.key ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-1.5 mt-2">
              <input type="date" aria-label="Du" value={dateFrom} max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)} className={SELECT} />
              <span className="text-xs text-slate-400">→</span>
              <input type="date" aria-label="Au" value={dateTo} min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)} className={SELECT} />
            </div>
          )}
        </div>

        <label className="text-xs text-slate-500">
          <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Ligne source</span>
          <select value={ligne} onChange={(e) => setLigne(e.target.value as Entity)} className={SELECT}>
            <option value="">Toutes (ALM + CPA)</option>
            <option value="ALM">Standard ALM</option>
            <option value="CPA">Standard CPA</option>
          </select>
        </label>

        <label className="text-xs text-slate-500">
          <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Équipe conseiller</span>
          <select value={equipe} onChange={(e) => setEquipe(e.target.value as Entity)} className={SELECT}>
            <option value="">Toutes (ALM + CPA)</option>
            <option value="ALM">Conseillers ALM</option>
            <option value="CPA">Conseillers CPA</option>
          </select>
        </label>

        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Comptage</p>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5" role="group" aria-label="Comptage">
            <button
              onClick={() => setView("gross")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                !net ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
              }`}
              title="Tous les appels, doublons compris"
            >
              Brut
            </button>
            <button
              onClick={() => setView("net")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                net ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
              }`}
              title="Un appel par appelant, doublons retirés"
            >
              Net (sans doublons)
            </button>
          </div>
        </div>

        {categorie && (
          <button onClick={() => setCategorie("")} className="text-xs text-brand-600 hover:underline pb-1.5">
            Retirer le filtre de carte ✕
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      {report?.truncated && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Période trop large : seuls les {report.scanned.toLocaleString("fr-FR")} appels les plus récents sont comptés.
          Réduisez la période pour des chiffres complets.
        </div>
      )}

      {/* Summary cards */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4 ${loading ? "opacity-60" : ""}`}>
        {(report?.categories ?? []).map((c) => {
          const excluded = (ligne && ligne !== c.source) || (equipe && equipe !== c.adviser);
          const selected = categorie === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setCategorie(selected ? "" : c.key)}
              className={`text-left rounded-2xl transition ${selected ? "ring-2 ring-brand-400" : ""} ${excluded ? "opacity-40" : ""}`}
              title="Cliquer pour n'afficher que ces appels dans le tableau"
            >
              <StatCard
                label={c.label}
                tone={TONE[c.key]}
                value={net ? c.unique : c.gross}
                sub={
                  net
                    ? `${c.gross} appels bruts · ${c.doublons} doublon${c.doublons > 1 ? "s" : ""}`
                    : `${c.unique} uniques · ${c.doublons} doublon${c.doublons > 1 ? "s" : ""}`
                }
              />
            </button>
          );
        })}
      </div>

      {/* Totals + duplicates */}
      {report && (
        <div className="card p-4 mb-5">
          <div className="flex flex-wrap gap-x-8 gap-y-3 items-end">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Appels répondus</p>
              <p className="text-2xl font-bold text-slate-900">{report.totals.gross}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Appelants uniques</p>
              <p className="text-2xl font-bold text-slate-900">{report.totals.unique}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total doublons</p>
              <p className="text-2xl font-bold text-amber-600">{report.totals.doublons}</p>
            </div>
            <p className="text-xs text-slate-500 max-w-md">
              Un doublon est un appel répété d&apos;un numéro déjà compté dans la même catégorie sur la période
              (+33 6… et 06… sont le même appelant).
            </p>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Hors des quatre catégories : {report.other.manques} manqué{report.other.manques > 1 ? "s" : ""},{" "}
            {report.other.sansConseiller} sans conseiller, {report.other.entiteConseillerInconnue} conseiller
            sans équipe ALM/CPA, {report.other.ligneInconnue} ligne inconnue.
          </p>
        </div>
      )}

      {/* Detail table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Détail des appels {net ? "(un par appelant)" : "(tous les appels)"}
          </h2>
          {report && (
            <span className="text-xs text-slate-400">
              {report.rowsTruncated
                ? `${report.rows.length} affichés sur ${report.rowsTotal}`
                : `${report.rowsTotal} ligne${report.rowsTotal > 1 ? "s" : ""}`}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: "860px" }}>
            <thead className="bg-slate-50/70 border-b border-slate-100">
              <tr>
                <th className="table-th">Appelant</th>
                <th className="table-th">Catégorie</th>
                <th className="table-th">Ligne source</th>
                <th className="table-th">Conseiller</th>
                <th className="table-th">Équipe</th>
                <th className="table-th">Date &amp; heure</th>
                <th className="table-th">Durée</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !report && (
                <tr><td colSpan={7} className="table-td text-center text-slate-400">Chargement…</td></tr>
              )}
              {report && report.rows.length === 0 && (
                <tr><td colSpan={7} className="table-td text-center text-slate-400">Aucun appel sur cette période.</td></tr>
              )}
              {report?.rows.map((r) => (
                <tr key={`${r.categorie}-${r.id}`} className="hover:bg-slate-50/80">
                  <td className="table-td">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Full number, exactly as stored. */}
                      <span className="font-mono text-sm text-slate-800 whitespace-nowrap">{r.callerNumber || "—"}</span>
                      {r.attemptCount > 1 && (
                        <span
                          className="badge badge-blue whitespace-nowrap"
                          style={{ fontSize: "10px", padding: "1px 5px" }}
                          title={`${r.attemptCount} appels de ce numéro dans cette catégorie, du ${new Date(r.firstAttemptAt).toLocaleString("fr-FR")} au ${new Date(r.lastAttemptAt).toLocaleString("fr-FR")}. La ligne affiche le plus long.`}
                        >
                          ({r.attemptCount})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="table-td whitespace-nowrap">
                    <span className="badge badge-gray">{r.categorie.replace(">", " → ")}</span>
                  </td>
                  <td className="table-td whitespace-nowrap">{r.ligne}</td>
                  <td className="table-td whitespace-nowrap">
                    {r.conseiller ? `${r.conseiller.prenom} ${r.conseiller.nom}` : "—"}
                  </td>
                  <td className="table-td whitespace-nowrap">{r.equipe ?? "—"}</td>
                  <td className="table-td whitespace-nowrap">{new Date(r.startedAt).toLocaleString("fr-FR")}</td>
                  <td className="table-td whitespace-nowrap font-mono">{formatDuration(r.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
