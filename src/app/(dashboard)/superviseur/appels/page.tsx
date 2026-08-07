"use client";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import CallsTable from "@/components/ui/CallsTable";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";
import { errorMessage } from "@/lib/fetchJson";

const EMPTY: DateFilterState = { period: "", dateFrom: "", dateTo: "" };

type Scope = "all" | "mine" | "transferred";

export default function SuperviseurAppelsPage() {
  const { data: session } = useSession();
  const currentUserId = (session?.user as { userId?: string } | undefined)?.userId;

  const [calls,   setCalls]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);
  const [scope,   setScope]   = useState<Scope>("all");
  const [error,   setError]   = useState("");

  const fetchCalls = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/calls" + buildQueryString(filter));
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json();
      setCalls(Array.isArray(data) ? data : []);
    } catch (err) {
      setCalls([]);
      setError(errorMessage(err, "Impossible de charger les appels."));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  // "Mes appels" = calls that landed on the coach's own line and have not been
  // handed off yet. "Transférés" = the ones they passed to a conseiller, which
  // stay here on purpose so the coach keeps sight of them.
  const visible = calls.filter((c) => {
    if (scope === "mine") return c.assignedUser?.id === currentUserId && !c.transferredBy;
    if (scope === "transferred") return c.transferredBy?.id === currentUserId;
    return true;
  });

  const mineCount = calls.filter((c) => c.assignedUser?.id === currentUserId && !c.transferredBy).length;
  const transferredCount = calls.filter((c) => c.transferredBy?.id === currentUserId).length;

  const TABS: { key: Scope; label: string }[] = [
    { key: "all",         label: `Tous (${calls.length})` },
    { key: "mine",        label: `Mes appels (${mineCount})` },
    { key: "transferred", label: `Transférés (${transferredCount})` },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Appels de l&apos;équipe</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {visible.length} appel{visible.length > 1 ? "s" : ""}
          </p>
        </div>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setScope(t.key)}
            className={`btn text-xs py-1.5 ${scope === t.key ? "btn-primary" : "btn-secondary"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading
        ? <div className="card p-8 text-center text-gray-400 animate-pulse">Chargement...</div>
        : <CallsTable
            calls={visible}
            showAgent
            showNotes
            allowResult
            allowTransfer
            currentUserId={currentUserId}
            onRefresh={fetchCalls}
          />
      }
    </div>
  );
}
