"use client";
import { useEffect, useState, useCallback } from "react";
import StatCard from "@/components/ui/StatCard";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";

const EMPTY: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

export default function ConseillerStatsPage() {
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    const res  = await fetch("/api/analytics" + buildQueryString(filter));
    setStats(await res.json());
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Mes statistiques</h1>
          <p className="text-sm text-gray-500 mt-0.5">Votre performance sur la période sélectionnée</p>
        </div>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 animate-pulse">
          {[...Array(6)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      ) : stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <StatCard label="Total appels"        value={stats.total} />
            <StatCard label="Répondus"             value={stats.repondus}   subColor="text-green-600" />
            <StatCard label="Manqués"              value={stats.manques}    subColor="text-red-500" />
            <StatCard label="Devis réalisés"       value={stats.devis}      subColor="text-green-600" />
            <StatCard label="Taux de conversion"
              value={`${stats.tauxConversion}%`}
              sub="sur appels répondus"
              subColor={stats.tauxConversion >= 30 ? "text-green-600" : "text-amber-600"} />
            <StatCard label="Durée moyenne"
              value={`${Math.floor(stats.dureeMoyenne/60)}:${(stats.dureeMoyenne%60).toString().padStart(2,"0")}`}
              sub="min:sec par appel" />
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Répartition des résultats</h3>
            <div className="space-y-3">
              {[
                { label: "Devis réalisés",  count: stats.devis,                        color: "bg-green-500", total: stats.repondus },
                { label: "Autres résultats",count: Math.max(0, stats.repondus - stats.devis), color: "bg-blue-400",  total: stats.repondus },
                { label: "Appels manqués",  count: stats.manques,                      color: "bg-red-400",   total: stats.total },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600">{item.label}</span>
                    <span className="text-gray-500">{item.count} / {item.total}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`}
                      style={{ width: item.total > 0 ? `${Math.round((item.count/item.total)*100)}%` : "0%" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
