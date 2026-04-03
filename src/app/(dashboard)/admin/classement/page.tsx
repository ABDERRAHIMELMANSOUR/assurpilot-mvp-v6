"use client";
import { useEffect, useState, useCallback } from "react";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";

const EMPTY: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

export default function ClassementPage() {
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

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Classement des conseillers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Classé par taux de conversion sur appels répondus</p>
        </div>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <div className="card p-8 animate-pulse text-center text-gray-400">Chargement...</div>
      ) : stats && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
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
            <tbody className="divide-y divide-gray-50">
              {stats.leaderboard.map((agent: any, i: number) => {
                const pct = agent.tauxConversion;
                return (
                  <tr key={agent.id} className={`hover:bg-gray-50 ${i === 0 ? "bg-amber-50/40" : ""}`}>
                    <td className="table-td text-center">
                      {i < 3
                        ? <span className="text-lg">{medals[i]}</span>
                        : <span className="text-sm text-gray-400">{i+1}</span>}
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-700 flex-shrink-0">
                          {agent.prenom[0]}{agent.nom[0]}
                        </div>
                        <span className="font-medium text-gray-900">{agent.prenom} {agent.nom}</span>
                      </div>
                    </td>
                    <td className="table-td text-gray-500 text-xs">{agent.team}</td>
                    <td className="table-td text-right text-sm">{agent.total}</td>
                    <td className="table-td text-right text-sm text-green-600">{agent.repondus}</td>
                    <td className="table-td text-right text-sm text-red-500">{agent.manques}</td>
                    <td className="table-td text-right text-sm font-medium">{agent.devis}</td>
                    <td className="table-td text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct>=40?"bg-green-500":pct>=20?"bg-amber-400":"bg-red-400"}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-sm font-semibold ${pct>=40?"text-green-600":pct>=20?"text-amber-600":"text-red-500"}`}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {stats.leaderboard.length === 0 && (
            <p className="p-8 text-center text-sm text-gray-400">Aucun appel sur cette période.</p>
          )}
        </div>
      )}
    </div>
  );
}
