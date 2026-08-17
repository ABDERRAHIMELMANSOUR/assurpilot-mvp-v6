"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active   = pathname === href;
  return (
    <Link href={href} className={`nav-link ${active ? "nav-link-active" : ""}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
          active ? "bg-brand-400" : "bg-slate-600"
        }`}
      />
      {label}
    </Link>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="nav-section">{label}</p>;
}

const roleLabel: Record<string, string> = {
  CONSEILLER:     "Conseiller",
  SUPERVISEUR:    "Coach",
  ADMINISTRATEUR: "Administrateur",
};
// Dark-surface variants: the light .badge-* tints wash out on the navy panel.
const roleBadgeCls: Record<string, string> = {
  CONSEILLER:     "bg-brand-500/15 text-brand-300 border-brand-500/25",
  SUPERVISEUR:    "bg-amber-400/15 text-amber-300 border-amber-400/25",
  ADMINISTRATEUR: "bg-slate-400/15 text-slate-300 border-slate-400/25",
};

export default function Sidebar() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const role = user?.role ?? "CONSEILLER";

  return (
    <aside className="w-60 min-h-screen bg-navy-950 border-r border-white/5 flex flex-col flex-shrink-0">
      {/* Logo — cyan mark with a soft glow */}
      <div className="px-4 py-5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-navy-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <span className="font-semibold text-white tracking-tight">AssurPilot</span>
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
            <NavLink href="/superviseur"            label="Vue d'ensemble" />
            <NavLink href="/superviseur/mes-appels" label="Mes appels" />
            <NavLink href="/superviseur/appels"     label="Appels équipe" />
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

            {/* Entity workspaces: each opens a view restricted to that entity's
                coaches, conseillers and calls. */}
            <SectionLabel label="Entités" />
            <NavLink href="/admin/entites/CPA" label="Équipe CPA" />
            <NavLink href="/admin/entites/ALM" label="Équipe ALM" />

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
      <div className="px-3 py-4 border-t border-white/5">
        <div className="flex items-center gap-2.5 px-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-brand-500/15 border border-brand-500/25 flex items-center justify-center text-xs font-semibold text-brand-300 flex-shrink-0">
            {user?.name?.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-100 truncate">{user?.name}</p>
            <span className={`badge text-xs ${roleBadgeCls[role]}`}>{roleLabel[role]}</span>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-colors"
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
