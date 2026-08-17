"use client";
import { useState, useEffect } from "react";
import ResultModal   from "./ResultModal";
import EditCallModal from "./EditCallModal";
import TransferModal from "./TransferModal";

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
  // Set once a coach has handed the call to a conseiller. The call stays in the
  // coach's list, badged with its new owner.
  transferredBy?: { id?: string; nom: string; prenom: string } | null;
  transferredAt?: string | null;
  team?:          { id: string; nom: string } | null;
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
  /** Shows the "Transférer" action (coach workspace / admin). */
  allowTransfer?: boolean;
  /** Viewer's own id — used to tell "I transferred this" from "sent to me". */
  currentUserId?: string;
  onRefresh?:   () => void;
}

export default function CallsTable({
  calls,
  showAgent    = false,
  showNotes    = false,
  allowResult  = false,
  isAdmin      = false,
  allowTransfer = false,
  currentUserId,
  onRefresh,
}: Props) {
  const [resultModal, setResultModal]   = useState<Call | null>(null);
  const [transferModal, setTransferModal] = useState<Call | null>(null);
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
  const hasActions = allowResult || isAdmin || allowTransfer;

  if (calls.length === 0) {
    return (
      <div className="card p-12 text-center">
        <svg className="w-10 h-10 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        <p className="text-slate-500 text-sm">Aucun appel pour cette période</p>
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          {/* The min width has to cover what the columns actually need. Set too low,
                the browser compresses to fit the container and starves the Notes
                column instead of overflowing — and overflowing is the intent
                here, which is why the Actions column is sticky. */}
            <table className="w-full" style={{ minWidth: hasActions ? "1200px" : "700px" }}>
            <thead className="bg-slate-50/70 border-b border-slate-100">
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
                    className="table-th text-right bg-slate-50/70"
                    style={{ minWidth: "140px", position: "sticky", right: 0, boxShadow: "-1px 0 0 #e2e8f0" }}
                  >
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {calls.map((call) => {
                const statut      = statutConfig[call.statut] ?? { label: call.statut, cls: "badge-gray" };
                const resBadge    = call.result ? getResultBadge(call.result.resultat) : null;
                // Missed calls are qualifiable too: an agent calls back and
                // records the outcome against the original missed call.
                const needsResult = !call.result && allowResult;
                const canManage   = isAdmin && call.isManual;

                return (
                  <tr
                    key={call.id}
                    className={`transition-colors hover:bg-slate-50/80 ${needsResult ? "bg-amber-50/40" : ""}`}
                  >
                    {/* Appelant */}
                    <td className="table-td">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-sm text-slate-800 whitespace-nowrap">
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
                        <div className="flex flex-col gap-0.5">
                          {call.assignedUser
                            ? <span className="text-sm whitespace-nowrap">{call.assignedUser.prenom} {call.assignedUser.nom}</span>
                            : <span className="text-slate-400">—</span>}
                          {call.transferredBy && call.assignedUser && (
                            <span
                              className="badge badge-blue whitespace-nowrap"
                              style={{ fontSize: "10px", padding: "1px 5px" }}
                              title={
                                call.transferredAt
                                  ? `Transféré le ${new Date(call.transferredAt).toLocaleString("fr-FR")}`
                                  : undefined
                              }
                            >
                              {call.transferredBy.id && call.transferredBy.id === currentUserId
                                ? `Transféré à ${call.assignedUser.prenom} ${call.assignedUser.nom}`
                                : `Transféré par ${call.transferredBy.prenom} ${call.transferredBy.nom}`}
                            </span>
                          )}
                        </div>
                      </td>
                    )}

                    {/* Ligne */}
                    <td className="table-td">
                      <span className="text-xs text-slate-500 whitespace-nowrap">{call.phoneLine.label}</span>
                    </td>

                    {/* Date */}
                    <td className="table-td text-slate-500 text-xs whitespace-nowrap">
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
                      ) : (
                        <span className="badge badge-yellow">À qualifier</span>
                      )}
                    </td>

                    {/* Notes */}
                    {showNotes && (
                      <td className="table-td">
                        {/* max-width, not w-full: a w-full block has zero
                            intrinsic width, so auto table layout starves the
                            column and the note collapses to a couple of
                            characters. A capped width lets the column bid for
                            space and `truncate` ellipsises what does not fit. */}
                        {call.result?.notes
                          ? (
                            <span
                              className="block max-w-[200px] truncate text-xs text-slate-600"
                              title={call.result.notes}
                            >
                              {call.result.notes}
                            </span>
                          )
                          : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                    )}

                    {/* Actions — sticky */}
                    {hasActions && (
                      <td
                        className="table-td bg-white"
                        style={{ position: "sticky", right: 0, boxShadow: "-1px 0 0 #e2e8f0" }}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Qualify + hand off to a conseiller (coach workspace) */}
                          {allowTransfer && (
                            <button
                              onClick={() => setTransferModal(call)}
                              className="btn btn-secondary text-xs py-1 px-2.5 whitespace-nowrap"
                            >
                              {call.transferredBy ? "Réassigner" : "Transférer"}
                            </button>
                          )}

                          {/* Result button (conseillers / all roles on non-missed) */}
                          {allowResult && !canManage && (
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
      {transferModal && (
        <TransferModal
          call={{
            id: transferModal.id,
            callerNumber: transferModal.callerNumber,
            startedAt: transferModal.startedAt,
            assignedUser: transferModal.assignedUser?.id
              ? { id: transferModal.assignedUser.id, prenom: transferModal.assignedUser.prenom, nom: transferModal.assignedUser.nom }
              : null,
            transferredBy: transferModal.transferredBy?.id
              ? { id: transferModal.transferredBy.id, prenom: transferModal.transferredBy.prenom, nom: transferModal.transferredBy.nom }
              : null,
            result: transferModal.result ?? null,
          }}
          onClose={() => setTransferModal(null)}
          onDone={() => { setTransferModal(null); onRefresh?.(); }}
        />
      )}

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
