"use client";
import { useEffect, useState, useCallback } from "react";
import StatCard from "@/components/ui/StatCard";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";
import ScopeFilter, { EMPTY_SCOPE, ScopeFilterState, withScope } from "@/components/ui/ScopeFilter";
import Link from "next/link";
import { errorMessage } from "@/lib/fetchJson";

const EMPTY: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

export default function AdminPage() {
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);
  const [scope,   setScope]   = useState<ScopeFilterState>(EMPTY_SCOPE);
  const [error,   setError]   = useState("");

  // Date range and scope are combined into one query string, so the metric
  // cards and the leaderboard are always computed from the same filter set.
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
      setError(errorMessage(err, "Impossible de charger les statistiques."));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const tauxGlobal = stats && (stats.totalAppels - stats.totalManques) > 0
    ? Math.round((stats.totalDevis / (stats.totalAppels - stats.totalManques)) * 100)
    : 0;
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Vue globale</h1>
          <p className="text-sm text-slate-500 mt-0.5">Statistiques de toute la plateforme</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopeFilter value={scope} onChange={setScope} />
          <DateFilter value={filter} onChange={setFilter} />
          <Link href="/admin/appels/import" className="btn btn-secondary text-xs">↑ Importer</Link>
          <Link href="/admin/appels/nouveau" className="btn btn-primary text-xs">+ Appel manuel</Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
        </div>
      ) : stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatCard label="Total appels" tone="brand"   value={stats.totalAppels} />
            <StatCard label="Devis réalisés" tone="emerald" value={stats.totalDevis}   subColor="text-emerald-600" />
            <StatCard label="Appels manqués" tone="rose" value={stats.totalManques} subColor="text-rose-500" />
            <StatCard label="Conseillers" tone="indigo"    value={stats.totalAgents}  sub="actifs" />
            <StatCard label="Taux global" tone="indigo"    value={`${tauxGlobal}%`}
              sub="conversion" subColor={tauxGlobal >= 25 ? "text-emerald-600" : "text-amber-600"} />
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Classement des conseillers</h2>
              <Link href="/admin/classement" className="text-xs text-brand-600 hover:underline">Voir tout →</Link>
            </div>
            <div className="divide-y divide-slate-100">
              {(stats.leaderboard ?? []).length === 0 && (
                <p className="px-5 py-8 text-center text-sm text-slate-400">
                  Aucun conseiller dans ce périmètre.
                </p>
              )}
              {(stats.leaderboard ?? []).slice(0, 5).map((agent: any, i: number) => {
                const pct = agent.tauxConversion;
                return (
                  <div key={agent.id} className="px-5 py-3 flex items-center gap-4">
                    <span className="w-6 text-center text-base">
                      {i < 3 ? medals[i] : <span className="text-sm text-slate-300">{i+1}</span>}
                    </span>
                    <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-xs font-semibold text-brand-700 flex-shrink-0">
                      {agent.prenom[0]}{agent.nom[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{agent.prenom} {agent.nom}</p>
                      <p className="text-xs text-slate-400">{agent.team} · {agent.total} appels · {agent.devis} devis</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct>=40?"bg-emerald-500":pct>=20?"bg-amber-400":"bg-red-400"}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-sm font-semibold min-w-[3rem] text-right ${pct>=40?"text-emerald-600":pct>=20?"text-amber-600":"text-rose-500"}`}>
                        {pct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
