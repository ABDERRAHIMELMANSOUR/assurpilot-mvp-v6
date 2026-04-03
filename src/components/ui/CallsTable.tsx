"use client";
import { useState, useEffect } from "react";
import ResultModal   from "./ResultModal";
import EditCallModal from "./EditCallModal";

type ResultOption = { value: string; label: string; color: string };

type Call = {
  id:             string;
  callerNumber:   string;
  isMissed:       boolean;
  durationSeconds:number;
  startedAt:      string;
  statut:         string;
  isManual?:      boolean;
  assignedUserId?:string | null;
  phoneLineId?:   string;
  phoneLine:      { label: string };
  assignedUser?:  { id?: string; nom: string; prenom: string } | null;
  result?:        { resultat: string; notes?: string | null } | null;
};

const statutConfig: Record<string, { label: string; cls: string }> = {
  REPONDU:  { label: "Répondu",  cls: "badge-green"  },
  MANQUE:   { label: "Manqué",   cls: "badge-red"    },
  EN_COURS: { label: "En cours", cls: "badge-yellow" },
};

const COLOR_BADGE: Record<string, string> = {
  green:  "badge-green",
  blue:   "badge-blue",
  red:    "badge-red",
  yellow: "badge-yellow",
  purple: "bg-purple-100 text-purple-800",
  gray:   "badge-gray",
};

function formatDuration(s: number) {
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatDate(d: string) {
  const date  = new Date(d);
  const today = new Date();
  const yest  = new Date(today); yest.setDate(today.getDate() - 1);
  const time  = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Auj. ${time}`;
  if (date.toDateString() === yest.toDateString())  return `Hier ${time}`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) + ` ${time}`;
}

interface Props {
  calls:        Call[];
  showAgent?:   boolean;
  showNotes?:   boolean;
  allowResult?: boolean;
  isAdmin?:     boolean;   // enables edit/delete on manual calls
  onRefresh?:   () => void;
}

export default function CallsTable({
  calls,
  showAgent    = false,
  showNotes    = false,
  allowResult  = false,
  isAdmin      = false,
  onRefresh,
}: Props) {
  const [resultModal, setResultModal]   = useState<Call | null>(null);
  const [editModal,   setEditModal]     = useState<Call | null>(null);
  const [resultOptions, setOptions]     = useState<ResultOption[]>([]);

  useEffect(() => {
    fetch("/api/call-result-options")
      .then((r) => r.json())
      .then((d) => setOptions(Array.isArray(d) ? d : []));
  }, []);

  function getResultBadge(value: string) {
    const opt = resultOptions.find((o) => o.value === value);
    if (!opt) return { label: value, cls: "badge-gray" };
    return { label: opt.label, cls: COLOR_BADGE[opt.color] ?? "badge-gray" };
  }

  // Determine which columns need an actions cell
  const hasActions = allowResult || isAdmin;

  if (calls.length === 0) {
    return (
      <div className="card p-12 text-center">
        <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        <p className="text-gray-500 text-sm">Aucun appel pour cette période</p>
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: hasActions ? "820px" : "620px" }}>
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-th" style={{ minWidth: "140px" }}>Appelant</th>
                {showAgent  && <th className="table-th" style={{ minWidth: "120px" }}>Conseiller</th>}
                <th className="table-th" style={{ minWidth: "120px" }}>Ligne</th>
                <th className="table-th" style={{ minWidth: "110px" }}>Date & Heure</th>
                <th className="table-th" style={{ minWidth: "70px"  }}>Durée</th>
                <th className="table-th" style={{ minWidth: "85px"  }}>Statut</th>
                <th className="table-th" style={{ minWidth: "110px" }}>Résultat</th>
                {showNotes && <th className="table-th" style={{ minWidth: "150px" }}>Notes</th>}
                {hasActions && (
                  <th
                    className="table-th text-right bg-gray-50"
                    style={{ minWidth: "140px", position: "sticky", right: 0, boxShadow: "-1px 0 0 #f3f4f6" }}
                  >
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {calls.map((call) => {
                const statut      = statutConfig[call.statut] ?? { label: call.statut, cls: "badge-gray" };
                const resBadge    = call.result ? getResultBadge(call.result.resultat) : null;
                const needsResult = !call.isMissed && !call.result && allowResult;
                const canManage   = isAdmin && call.isManual;

                return (
                  <tr
                    key={call.id}
                    className={`hover:bg-gray-50 transition-colors ${needsResult ? "bg-amber-50/40" : ""}`}
                  >
                    {/* Appelant */}
                    <td className="table-td">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-sm text-gray-800 whitespace-nowrap">
                          {call.callerNumber || "—"}
                        </span>
                        {call.isManual && (
                          <span className="badge badge-gray" style={{ fontSize: "10px", padding: "1px 5px" }}>
                            Import
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Conseiller */}
                    {showAgent && (
                      <td className="table-td">
                        {call.assignedUser
                          ? <span className="text-sm whitespace-nowrap">{call.assignedUser.prenom} {call.assignedUser.nom}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                    )}

                    {/* Ligne */}
                    <td className="table-td">
                      <span className="text-xs text-gray-500 whitespace-nowrap">{call.phoneLine.label}</span>
                    </td>

                    {/* Date */}
                    <td className="table-td text-gray-500 text-xs whitespace-nowrap">
                      {formatDate(call.startedAt)}
                    </td>

                    {/* Durée */}
                    <td className="table-td font-mono text-sm whitespace-nowrap">
                      {formatDuration(call.durationSeconds)}
                    </td>

                    {/* Statut */}
                    <td className="table-td">
                      <span className={`badge ${statut.cls}`}>{statut.label}</span>
                    </td>

                    {/* Résultat */}
                    <td className="table-td">
                      {resBadge ? (
                        <span className={`badge ${resBadge.cls}`}>{resBadge.label}</span>
                      ) : call.isMissed ? (
                        <span className="text-gray-300 text-xs">—</span>
                      ) : (
                        <span className="text-amber-600 text-xs font-medium">À qualifier</span>
                      )}
                    </td>

                    {/* Notes */}
                    {showNotes && (
                      <td className="table-td" style={{ maxWidth: "180px" }}>
                        {call.result?.notes
                          ? <span className="text-xs text-gray-600 line-clamp-2">{call.result.notes}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                    )}

                    {/* Actions — sticky */}
                    {hasActions && (
                      <td
                        className="table-td bg-white"
                        style={{ position: "sticky", right: 0, boxShadow: "-1px 0 0 #f3f4f6" }}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Result button (conseillers / all roles on non-missed) */}
                          {allowResult && !call.isMissed && !canManage && (
                            <button
                              onClick={() => setResultModal(call)}
                              className={`btn text-xs py-1 px-2.5 whitespace-nowrap ${needsResult ? "btn-primary" : "btn-secondary"}`}
                            >
                              {call.result ? "Résultat" : "+ Résultat"}
                            </button>
                          )}

                          {/* Admin edit/delete on manual calls */}
                          {canManage && (
                            <>
                              <button
                                onClick={() => setEditModal(call)}
                                className="btn btn-secondary text-xs py-1 px-2.5 whitespace-nowrap"
                              >
                                Modifier
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Result modal (for conseillers qualifying calls) */}
      {resultModal && (
        <ResultModal
          callId={resultModal.id}
          currentResult={resultModal.result}
          onClose={() => setResultModal(null)}
          onSaved={() => { setResultModal(null); onRefresh?.(); }}
        />
      )}

      {/* Edit modal (admin only, manual calls) */}
      {editModal && (
        <EditCallModal
          call={{
            id:             editModal.id,
            callerNumber:   editModal.callerNumber,
            assignedUserId: editModal.assignedUserId ?? null,
            phoneLineId:    editModal.phoneLineId ?? "",
            startedAt:      editModal.startedAt,
            durationSeconds:editModal.durationSeconds,
            statut:         editModal.statut,
            isMissed:       editModal.isMissed,
            result:         editModal.result,
          }}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); onRefresh?.(); }}
          onDeleted={() => { setEditModal(null); onRefresh?.(); }}
        />
      )}
    </>
  );
}
