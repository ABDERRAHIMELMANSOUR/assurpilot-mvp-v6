"use client";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import CallsTable from "@/components/ui/CallsTable";
import StatCard from "@/components/ui/StatCard";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";

const EMPTY_FILTER: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

export default function ConseillerPage() {
  const { data: session } = useSession();
  const [calls,   setCalls]   = useState<any[]>([]);
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY_FILTER);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const qs = buildQueryString(filter);
    const [callsRes, statsRes] = await Promise.all([
      fetch("/api/calls" + qs),
      fetch("/api/analytics" + qs),
    ]);
    setCalls(await callsRes.json());
    setStats(await statsRes.json());
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const user         = session?.user as any;
  const pendingCount = calls.filter((c) => !c.isMissed && !c.result).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Bonjour, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      {pendingCount > 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-800">
            <strong>{pendingCount} appel{pendingCount > 1 ? "s" : ""}</strong> {pendingCount > 1 ? "nécessitent" : "nécessite"} un résultat.
          </p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      ) : stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total appels"  value={stats.total}    sub={`${stats.repondus} répondus`} />
          <StatCard label="Appels manqués" value={stats.manques}
            sub={stats.total > 0 ? `${Math.round((stats.manques / stats.total) * 100)}% du total` : "0%"}
            subColor={stats.manques > 0 ? "text-red-500" : "text-gray-400"} />
          <StatCard label="Devis réalisés" value={stats.devis}
            sub={`Taux ${stats.tauxConversion}%`} subColor="text-green-600" />
          <StatCard label="Durée moyenne"
            value={`${Math.floor(stats.dureeMoyenne / 60)}:${(stats.dureeMoyenne % 60).toString().padStart(2, "0")}`}
            sub="min:sec par appel" />
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Mes appels</h2>
        <span className="text-xs text-gray-400">{calls.length} appel{calls.length > 1 ? "s" : ""}</span>
      </div>

      {loading
        ? <div className="card p-8 text-center text-gray-400 text-sm animate-pulse">Chargement...</div>
        : <CallsTable calls={calls} allowResult showNotes onRefresh={fetchData} />
      }
    </div>
  );
}
