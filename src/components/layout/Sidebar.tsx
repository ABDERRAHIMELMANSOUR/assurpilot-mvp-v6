"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active   = pathname === href;
  return (
    <Link href={href} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
      active ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? "bg-blue-600" : "bg-gray-300"}`} />
      {label}
    </Link>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="px-3 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>;
}

const roleLabel: Record<string, string> = {
  CONSEILLER:     "Conseiller",
  SUPERVISEUR:    "Coach",
  ADMINISTRATEUR: "Administrateur",
};
const roleBadgeCls: Record<string, string> = {
  CONSEILLER:     "badge-blue",
  SUPERVISEUR:    "badge-yellow",
  ADMINISTRATEUR: "badge-gray",
};

export default function Sidebar() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const role = user?.role ?? "CONSEILLER";

  return (
    <aside className="w-56 min-h-screen bg-white border-r border-gray-100 flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900">AssurPilot</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {role === "CONSEILLER" && (
          <>
            <NavLink href="/conseiller"       label="Mes appels" />
            <NavLink href="/conseiller/stats" label="Mes statistiques" />
            <SectionLabel label="Mon compte" />
            <NavLink href="/profil" label="Mon profil" />
          </>
        )}

        {role === "SUPERVISEUR" && (
          <>
            <SectionLabel label="Tableau de bord" />
            <NavLink href="/superviseur"         label="Vue d'ensemble" />
            <NavLink href="/superviseur/appels"  label="Appels équipe" />
            <SectionLabel label="Équipe" />
            <NavLink href="/superviseur/equipe"   label="Mon équipe" />
            <NavLink href="/superviseur/activite" label="Activité" />
            <SectionLabel label="Mon compte" />
            <NavLink href="/profil" label="Mon profil" />
          </>
        )}

        {role === "ADMINISTRATEUR" && (
          <>
            <SectionLabel label="Tableau de bord" />
            <NavLink href="/admin"               label="Vue globale" />
            <NavLink href="/admin/appels"        label="Tous les appels" />
            <NavLink href="/admin/appels/import" label="Import fichier" />
            <NavLink href="/admin/classement"    label="Classement" />

            <SectionLabel label="Gestion" />
            <NavLink href="/admin/utilisateurs" label="Utilisateurs" />
            <NavLink href="/admin/conseillers"  label="Conseillers" />
            <NavLink href="/admin/coachs"       label="Coachs" />
            <NavLink href="/admin/activite"     label="Activité" />

            <SectionLabel label="Configuration" />
            <NavLink href="/admin/resultats" label="Résultats d'appel" />
            <NavLink href="/admin/keyyo"     label="Config. Keyyo" />

            <SectionLabel label="Mon compte" />
            <NavLink href="/profil" label="Mon profil" />
          </>
        )}
      </nav>

      {/* User info + logout */}
      <div className="px-3 py-4 border-t border-gray-100">
        <div className="flex items-center gap-2.5 px-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-700 flex-shrink-0">
            {user?.name?.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-900 truncate">{user?.name}</p>
            <span className={`badge text-xs ${roleBadgeCls[role]}`}>{roleLabel[role]}</span>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
