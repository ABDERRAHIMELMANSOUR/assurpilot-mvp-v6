"use client";
import { useEffect, useState, useCallback } from "react";
import StatCard from "@/components/ui/StatCard";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";
import Link from "next/link";

const EMPTY: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

export default function CoachDashboardPage() {
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    const data = await fetch("/api/analytics" + buildQueryString(filter)).then((r) => r.json());
    setStats(data);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const tauxGlobal = stats && (stats.totalAppels - stats.totalManques) > 0
    ? Math.round((stats.totalDevis / (stats.totalAppels - stats.totalManques)) * 100)
    : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Vue d'ensemble — Équipe</h1>
          <p className="text-sm text-gray-500 mt-0.5">Performances globales de votre équipe</p>
        </div>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      ) : stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total appels"   value={stats.totalAppels} />
            <StatCard label="Devis réalisés" value={stats.totalDevis}   subColor="text-green-600" />
            <StatCard label="Appels manqués" value={stats.totalManques} subColor="text-red-500" />
            <StatCard label="Taux global"    value={`${tauxGlobal}%`}  sub="conversion" subColor="text-blue-600" />
          </div>

          <div className="card overflow-hidden mb-4">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Performance des conseillers</h2>
              <Link href="/superviseur/equipe" className="text-xs text-blue-600 hover:underline">
                Gérer l'équipe →
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {(stats.leaderboard ?? []).map((agent: any, i: number) => {
                const pct = agent.tauxConversion;
                return (
                  <div key={agent.id} className="px-5 py-3.5 flex items-center gap-4">
                    <span className="text-sm font-semibold text-gray-300 w-5 text-center">{i + 1}</span>
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-700 flex-shrink-0">
                      {agent.prenom[0]}{agent.nom[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{agent.prenom} {agent.nom}</p>
                      <p className="text-xs text-gray-400">{agent.total} appels · {agent.devis} devis · {agent.manques} manqués</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 40 ? "bg-green-500" : pct >= 20 ? "bg-amber-400" : "bg-red-400"}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-sm font-semibold min-w-[3rem] text-right ${pct >= 40 ? "text-green-600" : pct >= 20 ? "text-amber-600" : "text-red-500"}`}>
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
