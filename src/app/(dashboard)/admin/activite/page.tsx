"use client";
import { useEffect, useState, useCallback } from "react";

type UserActivity = {
  id: string; prenom: string; nom: string; email: string; phoneNumber?: string;
  role: string; isActive: boolean; lastLoginAt: string | null;
  loginLogs: { id: string; createdAt: string; ip: string }[];
};

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff/60000), h = Math.floor(mins/60), days = Math.floor(h/24);
  if (mins < 2) return "À l'instant";
  if (mins < 60) return `Il y a ${mins} min`;
  if (h < 24) return `Il y a ${h}h`;
  if (days === 1) return "Hier";
  return `Il y a ${days} jours`;
}

function dot(last: string | null) {
  if (!last) return { cls: "bg-gray-300", label: "Jamais connecté" };
  const h = (Date.now() - new Date(last).getTime()) / 3600000;
  if (h < 1) return { cls: "bg-green-500", label: "En ligne récemment" };
  if (h < 8) return { cls: "bg-green-300", label: "Actif aujourd'hui" };
  if (h < 48) return { cls: "bg-yellow-400", label: "Actif hier" };
  return { cls: "bg-gray-300", label: "Inactif" };
}

export default function AdminActivitePage() {
  const [users,    setUsers]    = useState<UserActivity[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetch("/api/activity").then((r) => r.json());
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Activité des utilisateurs</h1>
        <p className="text-sm text-gray-500 mt-0.5">Dernières connexions et historique d'activité</p>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
        </div>
      ) : users.length === 0 ? (
        <div className="card p-10 text-center text-gray-400 text-sm">Aucun utilisateur à afficher.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-gray-50">
            {users.map((u) => {
              const d = dot(u.lastLoginAt);
              const open = expanded === u.id;
              return (
                <div key={u.id}>
                  <div className="px-5 py-3.5 flex items-center gap-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setExpanded(open ? null : u.id)}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${u.isActive ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>
                      {u.prenom[0]}{u.nom[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">{u.prenom} {u.nom}</p>
                        <span className={`badge text-xs ${u.role === "SUPERVISEUR" ? "badge-yellow" : "badge-blue"}`}>
                          {u.role === "SUPERVISEUR" ? "Coach" : "Conseiller"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 font-mono truncate">{u.phoneNumber || u.email}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`w-2.5 h-2.5 rounded-full ${d.cls}`} title={d.label} />
                      <span className="text-xs text-gray-500 hidden sm:block">{d.label}</span>
                    </div>
                    <div className="text-right flex-shrink-0 min-w-[100px]">
                      {u.lastLoginAt ? (
                        <>
                          <p className="text-xs font-medium text-gray-700">{timeAgo(u.lastLoginAt)}</p>
                          <p className="text-xs text-gray-400">
                            {new Date(u.lastLoginAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                            {" "}
                            {new Date(u.lastLoginAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-gray-400 italic">Jamais connecté</p>
                      )}
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {open && (
                    <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-3 mb-2">
                        5 dernières connexions
                      </p>
                      {u.loginLogs.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Aucune connexion enregistrée</p>
                      ) : (
                        <div className="space-y-1.5">
                          {u.loginLogs.map((log) => (
                            <div key={log.id} className="flex items-center gap-3 text-xs text-gray-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                              <span className="font-medium">
                                {new Date(log.createdAt).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                                {" à "}
                                {new Date(log.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {log.ip && <span className="text-gray-400 font-mono">{log.ip}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
