"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function UtilisateursPage() {
  const [users,   setUsers]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => { setUsers(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  const conseillers = users.filter((u) => u.role === "CONSEILLER");
  const coachs      = users.filter((u) => u.role === "SUPERVISEUR");
  const actifs      = users.filter((u) => u.isActive);

  const sections = [
    {
      title: "Conseillers",
      count: conseillers.length,
      activeCount: conseillers.filter((u) => u.isActive).length,
      href: "/admin/conseillers",
      color: "bg-blue-50 border-blue-200",
      iconBg: "bg-blue-100", iconColor: "text-blue-600",
      description: "Gérer, créer et désactiver les conseillers",
    },
    {
      title: "Coachs",
      count: coachs.length,
      activeCount: coachs.filter((u) => u.isActive).length,
      href: "/admin/coachs",
      color: "bg-orange-50 border-orange-200",
      iconBg: "bg-orange-100", iconColor: "text-orange-600",
      description: "Gérer les coachs et leurs équipes",
    },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Utilisateurs</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {loading ? "Chargement..." : `${actifs.length} utilisateurs actifs sur la plateforme`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}
            className={`card border-2 ${s.color} p-5 hover:shadow-md transition-all group`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg ${s.iconBg} flex items-center justify-center flex-shrink-0`}>
                <svg className={`w-5 h-5 ${s.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-base font-semibold text-gray-900">{s.title}</p>
                  <svg className="w-4 h-4 text-gray-400 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>
                {!loading && (
                  <p className="text-xs text-gray-400 mt-2">
                    {s.activeCount} actif{s.activeCount > 1 ? "s" : ""} / {s.count} total
                  </p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Tous les utilisateurs</h2>
          <span className="text-xs text-gray-400">{users.length} au total</span>
        </div>
        {loading ? (
          <div className="p-6 animate-pulse space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-th">Nom</th>
                <th className="table-th">Téléphone</th>
                <th className="table-th">Rôle</th>
                <th className="table-th">Équipe</th>
                <th className="table-th">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-gray-50 ${!u.isActive ? "opacity-50" : ""}`}>
                  <td className="table-td">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-700">
                        {u.prenom[0]}{u.nom[0]}
                      </div>
                      <span className="font-medium text-gray-900 text-sm">{u.prenom} {u.nom}</span>
                    </div>
                  </td>
                  <td className="table-td font-mono text-sm text-gray-700">
                    {u.phoneNumber || <span className="text-gray-300 italic text-xs">—</span>}
                  </td>
                  <td className="table-td">
                    <span className={`badge ${
                      u.role === "SUPERVISEUR" ? "badge-yellow" :
                      u.role === "ADMINISTRATEUR" ? "badge-gray" : "badge-blue"
                    }`}>
                      {u.role === "SUPERVISEUR" ? "Coach" :
                       u.role === "ADMINISTRATEUR" ? "Admin" : "Conseiller"}
                    </span>
                  </td>
                  <td className="table-td text-xs text-gray-500">{u.team?.nom ?? "—"}</td>
                  <td className="table-td">
                    <span className={`badge ${u.isActive ? "badge-green" : "badge-gray"}`}>
                      {u.isActive ? "Actif" : "Inactif"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
