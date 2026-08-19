"use client";
import { useEffect, useState, useCallback } from "react";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";
import ScopeFilter, { EMPTY_SCOPE, ScopeFilterState, withScope } from "@/components/ui/ScopeFilter";
import { errorMessage } from "@/lib/fetchJson";

const EMPTY: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

export default function ClassementPage() {
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);
  const [scope,   setScope]   = useState<ScopeFilterState>(EMPTY_SCOPE);
  const [error,   setError]   = useState("");

  // Date range and entity/line scope travel as one query string, so the ranking
  // is always computed from the full filter set.
  const query = withScope(buildQueryString(filter), scope);

  const fetchStats = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/analytics" + query);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      setStats(await res.json());
    } catch (err) {
      setStats(null);
      setError(errorMessage(err, "Impossible de charger le classement."));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Classement des conseillers</h1>
          <p className="text-sm text-slate-500 mt-0.5">Classé par taux de conversion sur appels répondus</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopeFilter value={scope} onChange={setScope} />
          <DateFilter value={filter} onChange={setFilter} />
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card p-8 animate-pulse text-center text-slate-400">Chargement...</div>
      ) : stats && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="table-th w-12">#</th>
                <th className="table-th">Conseiller</th>
                <th className="table-th">Équipe</th>
                <th className="table-th text-right">Appels</th>
                <th className="table-th text-right">Répondus</th>
                <th className="table-th text-right">Manqués</th>
                <th className="table-th text-right">Devis</th>
                <th className="table-th text-right">Taux</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(stats.leaderboard ?? []).map((agent: any, i: number) => {
                const pct = agent.tauxConversion;
                return (
                  <tr key={agent.id} className={`hover:bg-slate-50 ${i === 0 ? "bg-amber-50/40" : ""}`}>
                    <td className="table-td text-center">
                      {i < 3
                        ? <span className="text-lg">{medals[i]}</span>
                        : <span className="text-sm text-slate-400">{i+1}</span>}
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-brand-50 flex items-center justify-center text-xs font-semibold text-brand-700 flex-shrink-0">
                          {agent.prenom[0]}{agent.nom[0]}
                        </div>
                        <span className="font-medium text-slate-900">{agent.prenom} {agent.nom}</span>
                      </div>
                    </td>
                    <td className="table-td text-slate-500 text-xs">{agent.team}</td>
                    <td className="table-td text-right text-sm">{agent.total}</td>
                    <td className="table-td text-right text-sm text-emerald-600">{agent.repondus}</td>
                    <td className="table-td text-right text-sm text-rose-500">{agent.manques}</td>
                    <td className="table-td text-right text-sm font-medium">{agent.devis}</td>
                    <td className="table-td text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct>=40?"bg-emerald-500":pct>=20?"bg-amber-400":"bg-red-400"}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-sm font-semibold ${pct>=40?"text-emerald-600":pct>=20?"text-amber-600":"text-rose-500"}`}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(stats.leaderboard ?? []).length === 0 && (
            <p className="p-8 text-center text-sm text-slate-400">
              {scope.entity || scope.lineType
                ? "Aucun conseiller dans ce périmètre sur cette période."
                : "Aucun appel sur cette période."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
