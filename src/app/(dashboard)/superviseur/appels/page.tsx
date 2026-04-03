"use client";
import { useEffect, useState, useCallback } from "react";
import CallsTable from "@/components/ui/CallsTable";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";

const EMPTY: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

export default function SuperviseurAppelsPage() {
  const [calls,   setCalls]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    const res  = await fetch("/api/calls" + buildQueryString(filter));
    const data = await res.json();
    setCalls(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Appels de l'équipe</h1>
          <p className="text-sm text-gray-500 mt-0.5">{calls.length} appel{calls.length > 1 ? "s" : ""}</p>
        </div>
        <DateFilter value={filter} onChange={setFilter} />
      </div>
      {loading
        ? <div className="card p-8 text-center text-gray-400 animate-pulse">Chargement...</div>
        : <CallsTable calls={calls} showAgent showNotes onRefresh={fetchCalls} />
      }
    </div>
  );
}
