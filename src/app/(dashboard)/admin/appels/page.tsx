"use client";
import { useEffect, useState, useCallback } from "react";
import CallsTable from "@/components/ui/CallsTable";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";
import Link from "next/link";

const EMPTY: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

export default function AdminAppelsPage() {
  const [calls,   setCalls]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);
  const [statut,  setStatut]  = useState("all");

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    const data = await fetch("/api/calls" + buildQueryString(filter)).then((r) => r.json());
    setCalls(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  const filtered =
    statut === "manques"  ? calls.filter((c) => c.isMissed) :
    statut === "devis"    ? calls.filter((c) => c.result?.resultat === "DEVIS_REALISE") :
    statut === "pending"  ? calls.filter((c) => !c.isMissed && !c.result) :
    statut === "manual"   ? calls.filter((c) => c.isManual) :
    calls;

  return (
    <div className="p-6 max-w-full mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tous les appels</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} appel{filtered.length > 1 ? "s" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateFilter value={filter} onChange={setFilter} />
          <Link href="/admin/appels/import" className="btn btn-secondary text-xs">
            ↑ Importer
          </Link>
          <Link href="/admin/appels/nouveau" className="btn btn-primary text-xs">
            + Manuel
          </Link>
        </div>
      </div>

      {/* Statut filters */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[
          { key: "all",     label: "Tous" },
          { key: "manques", label: "Manqués" },
          { key: "devis",   label: "Devis" },
          { key: "pending", label: "À qualifier" },
          { key: "manual",  label: "Importés / Manuels" },
        ].map((f) => (
          <button key={f.key} onClick={() => setStatut(f.key)}
            className={`btn text-xs py-1.5 ${statut === f.key ? "btn-primary" : "btn-secondary"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Admin note for manual calls */}
      {(statut === "manual" || statut === "all") && filtered.some((c) => c.isManual) && (
        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-700 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Les appels marqués <strong className="mx-1">Import</strong> peuvent être modifiés ou supprimés via le bouton <strong className="ml-1">Modifier</strong>.
        </div>
      )}

      {loading
        ? <div className="card p-8 text-center text-gray-400 animate-pulse">Chargement...</div>
        : <CallsTable calls={filtered} showAgent showNotes isAdmin onRefresh={fetchCalls} />
      }
    </div>
  );
}
