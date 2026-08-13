"use client";
import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import UserFormModal from "./UserFormModal";

/**
 * Mirrors the payload of /api/users (see USER_SELECT in src/lib/selects.ts).
 * Field names match the Prisma model exactly: nom, prenom, phoneNumber.
 */
export type UserRow = {
  id: string; prenom: string; nom: string; email: string; phoneNumber?: string;
  role: string; teamId?: string | null; superviseurId?: string | null;
  isActive: boolean; createdAt: string; lastLoginAt?: string | null;
  team?:        { id: string; nom: string } | null;
  superviseur?: { id: string; nom: string; prenom: string; phoneNumber?: string } | null;
};

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff/60000), h = Math.floor(mins/60), days = Math.floor(h/24);
  if (mins < 2) return "À l'instant";
  if (mins < 60) return `${mins} min`;
  if (h < 24) return `${h}h`;
  if (days === 1) return "Hier";
  return `${days}j`;
}

interface Props {
  users: UserRow[];
  targetRole: "CONSEILLER" | "SUPERVISEUR";
  currentUserRole: string;
  onRefresh: () => void;
  showCreateButton?: boolean;
  /** Base path for the per-user call history; row names link there. */
  detailBasePath?: string;
}

export default function UsersTable({ users, targetRole, currentUserRole, onRefresh, showCreateButton = true, detailBasePath }: Props) {
  const { data: session }         = useSession();
  const currentUser               = session?.user as any;
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [selected,  setSelected]  = useState<UserRow | null>(null);
  const [deleting,  setDeleting]  = useState<string | null>(null);
  const [delError,  setDelError]  = useState("");

  const uiLabel  = targetRole === "CONSEILLER" ? "Conseiller" : "Coach";
  const btnLabel = `Nouveau ${uiLabel.toLowerCase()}`;
  const isConseiller = targetRole === "CONSEILLER";

  async function handleDelete(u: UserRow) {
    if (!confirm(`Désactiver ${u.prenom} ${u.nom} ?\nL'historique des appels est conservé.`)) return;
    setDeleting(u.id); setDelError("");
    try {
      await fetchJson(`/api/users/${u.id}`, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      setDelError(errorMessage(err, "La désactivation a échoué."));
    } finally {
      // Always clear the pending state — otherwise a failed request leaves the
      // row's buttons disabled forever.
      setDeleting(null);
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">
          {users.length} {uiLabel.toLowerCase()}{users.length > 1 ? "s" : ""}
          {" · "}{users.filter(u => u.isActive).length} actif{users.filter(u => u.isActive).length > 1 ? "s" : ""}
        </p>
        {showCreateButton && (
          <button
            onClick={() => { setSelected(null); setModalMode("create"); }}
            className="btn btn-primary text-xs"
          >
            + {btnLabel}
          </button>
        )}
      </div>

      {delError && (
        <div className="mb-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2 text-sm text-rose-700">
          {delError}
        </div>
      )}

      {users.length === 0 ? (
        <div className="card p-10 text-center text-slate-400 text-sm">Aucun utilisateur à afficher.</div>
      ) : (
        /* Outer card — overflow-hidden clips rounded corners; inner div scrolls */
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: isConseiller ? "780px" : "600px" }}>
              <thead className="bg-slate-50/70 border-b border-slate-100">
                <tr>
                  {/* Fixed-width avatar + name col */}
                  <th className="table-th" style={{ minWidth: "160px" }}>Nom</th>
                  <th className="table-th" style={{ minWidth: "130px" }}>Téléphone</th>
                  <th className="table-th" style={{ minWidth: "180px" }}>Email</th>
                  {isConseiller && <th className="table-th" style={{ minWidth: "120px" }}>Coach</th>}
                  {isConseiller && <th className="table-th" style={{ minWidth: "110px" }}>Équipe</th>}
                  <th className="table-th" style={{ minWidth: "80px"  }}>Connexion</th>
                  <th className="table-th" style={{ minWidth: "70px"  }}>Statut</th>
                  {/* Sticky actions column */}
                  <th
                    className="table-th text-right bg-slate-50/70"
                    style={{ minWidth: "150px", position: "sticky", right: 0, boxShadow: "-1px 0 0 #e2e8f0" }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className={`transition-colors hover:bg-slate-50/80 ${!u.isActive ? "opacity-55" : ""}`}
                  >
                    <td className="table-td">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
                          u.isActive ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"
                        }`}>
                          {u.prenom[0]}{u.nom[0]}
                        </div>
                        {detailBasePath ? (
                          <Link
                            href={`${detailBasePath}/${u.id}`}
                            className="text-sm font-medium text-brand-700 hover:underline truncate max-w-[110px]"
                            title={`Voir les appels de ${u.prenom} ${u.nom}`}
                          >
                            {u.prenom} {u.nom}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium text-slate-900 truncate max-w-[110px]" title={`${u.prenom} ${u.nom}`}>
                            {u.prenom} {u.nom}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-td">
                      <span className="font-mono text-sm text-slate-800 whitespace-nowrap">
                        {u.phoneNumber || <span className="text-slate-300 italic not-italic">—</span>}
                      </span>
                    </td>
                    <td className="table-td">
                      <span className="text-xs text-slate-400 truncate block max-w-[170px]" title={u.email}>
                        {u.email}
                      </span>
                    </td>
                    {isConseiller && (
                      <td className="table-td text-xs text-slate-600 whitespace-nowrap">
                        {u.superviseur
                          ? `${u.superviseur.prenom} ${u.superviseur.nom}`
                          : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {isConseiller && (
                      <td className="table-td text-xs text-slate-500 whitespace-nowrap">
                        {u.team?.nom ?? <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    <td className="table-td text-xs text-slate-500 whitespace-nowrap">
                      {u.lastLoginAt
                        ? <span title={new Date(u.lastLoginAt).toLocaleString("fr-FR")}>{timeAgo(u.lastLoginAt)}</span>
                        : <span className="text-slate-300 italic">Jamais</span>}
                    </td>
                    <td className="table-td">
                      <span className={`badge ${u.isActive ? "badge-green" : "badge-gray"}`}>
                        {u.isActive ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    {/* Sticky actions */}
                    <td
                      className="table-td bg-white"
                      style={{ position: "sticky", right: 0, boxShadow: "-1px 0 0 #e2e8f0" }}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => { setSelected(u); setModalMode("edit"); }}
                          className="btn btn-secondary text-xs py-1 px-2.5 whitespace-nowrap"
                        >
                          Modifier
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={deleting === u.id || !u.isActive}
                          className="btn btn-danger text-xs py-1 px-2.5 whitespace-nowrap disabled:opacity-40"
                        >
                          {deleting === u.id ? "..." : "Désactiver"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalMode && (
        <UserFormModal
          mode={modalMode}
          targetRole={targetRole}
          currentUserRole={currentUserRole}
          currentUserTeamId={currentUser?.teamId}
          currentUserId={currentUser?.userId}
          initialData={selected}
          onClose={() => { setModalMode(null); setSelected(null); }}
          onSaved={() => { setModalMode(null); setSelected(null); onRefresh(); }}
        />
      )}
    </>
  );
}
