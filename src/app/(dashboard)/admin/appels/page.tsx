"use client";
import { useEffect, useState, useCallback } from "react";
import CallsTable from "@/components/ui/CallsTable";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";
import ExportCallsButton from "@/components/ui/ExportCallsButton";
import { errorMessage } from "@/lib/fetchJson";
import Link from "next/link";

// "Tout" by default: this list is the record of every call, so a default period
// would silently hide imported history and make the page disagree with the
// dashboard totals.
const EMPTY: DateFilterState = { period: "", dateFrom: "", dateTo: "" };

export default function AdminAppelsPage() {
  const [calls,   setCalls]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);
  const [statut,  setStatut]  = useState("all");
  const [error,   setError]   = useState("");
  const [truncated, setTruncated] = useState<{ shown: number; total: number } | null>(null);

  const fetchCalls = useCallback(async () => {
    setLoading(true); setError(""); setTruncated(null);
    try {
      // A failed request used to fall through to an empty array, which rendered
      // as "Aucun appel pour cette période" — indistinguishable from no data.
      const res = await fetch("/api/calls" + buildQueryString(filter));
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json();
      setCalls(Array.isArray(data) ? data : []);
      if (res.headers.get("X-Truncated") === "true") {
        setTruncated({
          shown: Number(res.headers.get("X-Returned-Count") ?? 0),
          total: Number(res.headers.get("X-Total-Count") ?? 0),
        });
      }
    } catch (err) {
      setCalls([]);
      setError(errorMessage(err, "Impossible de charger les appels."));
    } finally {
      setLoading(false);
    }
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
          <h1 className="text-xl font-semibold text-slate-900">Tous les appels</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} appel{filtered.length > 1 ? "s" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateFilter value={filter} onChange={setFilter} />
          {/* Exports exactly what the filters above select. */}
          <ExportCallsButton query={buildQueryString(filter)} />
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
        <div className="mb-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-2.5 text-xs text-brand-700 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Les appels marqués <strong className="mx-1">Import</strong> peuvent être modifiés ou supprimés via le bouton <strong className="ml-1">Modifier</strong>.
        </div>
      )}

      {error && (
        <div className="mb-3 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      {truncated && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
          Affichage des {truncated.shown} appels les plus récents sur {truncated.total}.
          Affinez la période pour voir les autres.
        </div>
      )}

      {loading
        ? <div className="card p-8 text-center text-slate-400 animate-pulse">Chargement...</div>
        : <CallsTable calls={filtered} showAgent showNotes isAdmin onRefresh={fetchCalls} />
      }
    </div>
  );
}
