"use client";

import Link from "next/link";
import { SUB_TEAM_LABEL } from "@/lib/entity";

type TeamRow = {
  team: string;
  entity: "CPA" | "ALM" | null;
  subTeam: "AUTO" | "SANTE" | null;
  agents: number;
  total: number;
  prospects: number;
  doublons: number;
  repondus: number;
  manques: number;
  devis: number;
  contrats: number;
  tauxContrat: number;
};

type AgentRow = {
  id: string;
  nom: string;
  prenom: string;
  team: string;
  total: number;
  prospects: number;
  manques: number;
  devis: number;
  contrats: number;
  tauxContrat: number;
};

interface Props {
  teams: TeamRow[];
  agents: AgentRow[];
  /** Describes the filters in force, so the snapshot says what it covers. */
  caption?: string;
}

const ENTITY_TONE: Record<string, string> = {
  CPA: "badge-blue",
  ALM: "badge-green",
};

function Num({ value, tone = "" }: { value: number; tone?: string }) {
  return (
    <span className={`tabular-nums ${value === 0 ? "text-slate-300" : tone || "text-slate-900"}`}>
      {value}
    </span>
  );
}

/**
 * Read-only analytics snapshot: who sits in which team, how much each handled,
 * and how many contracts came out of it.
 *
 * Deliberately separate from the call tables — this answers "how are we
 * doing", not "what do I work on next", and mixing the two is what makes a
 * dashboard unreadable. Everything here comes from the same /api/analytics
 * response as the cards above, so it moves with the date, entity and pôle
 * filters and cannot disagree with them.
 */
export default function StatsSection({ teams, agents, caption }: Props) {
  const grandTotal = teams.reduce((sum, t) => sum + t.total, 0);
  const grandContrats = teams.reduce((sum, t) => sum + t.contrats, 0);

  return (
    <section className="card overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-700">Statistiques détaillées</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          {caption ?? "Répartition par équipe et par conseiller"}
        </p>
      </div>

      {/* ── Par équipe ─────────────────────────────────────────────────── */}
      <div className="px-5 pt-4">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Par équipe
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: "720px" }}>
          <thead className="bg-slate-50/70 border-y border-slate-100">
            <tr>
              <th className="table-th">Équipe</th>
              <th className="table-th">Entité</th>
              <th className="table-th">Pôle</th>
              <th className="table-th text-right">Conseillers</th>
              <th className="table-th text-right">Appels</th>
              <th className="table-th text-right">Prospects</th>
              <th className="table-th text-right">Manqués</th>
              <th className="table-th text-right">Devis</th>
              <th className="table-th text-right">Contrats</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {teams.length === 0 && (
              <tr>
                <td colSpan={9} className="table-td text-center text-sm text-slate-400 py-6">
                  Aucune équipe dans ce périmètre.
                </td>
              </tr>
            )}
            {teams.map((t) => (
              <tr key={t.team} className="hover:bg-slate-50/80 transition-colors">
                <td className="table-td text-sm font-medium text-slate-900">{t.team}</td>
                <td className="table-td">
                  {t.entity ? (
                    <span className={`badge ${ENTITY_TONE[t.entity]}`} style={{ fontSize: "10px", padding: "1px 6px" }}>
                      {t.entity}
                    </span>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="table-td text-xs text-slate-500">
                  {t.subTeam ? SUB_TEAM_LABEL[t.subTeam] : "—"}
                </td>
                <td className="table-td text-right text-sm"><Num value={t.agents} /></td>
                <td className="table-td text-right text-sm font-medium"><Num value={t.total} /></td>
                <td className="table-td text-right text-sm"><Num value={t.prospects} /></td>
                <td className="table-td text-right text-sm"><Num value={t.manques} tone="text-rose-500" /></td>
                <td className="table-td text-right text-sm"><Num value={t.devis} tone="text-indigo-600" /></td>
                <td className="table-td text-right text-sm font-semibold">
                  <Num value={t.contrats} tone="text-emerald-600" />
                </td>
              </tr>
            ))}
          </tbody>
          {teams.length > 0 && (
            <tfoot className="bg-slate-50/70 border-t border-slate-100">
              <tr>
                <td className="table-td text-xs font-semibold text-slate-500 uppercase tracking-wider" colSpan={4}>
                  Total
                </td>
                <td className="table-td text-right text-sm font-semibold">{grandTotal}</td>
                <td className="table-td" colSpan={3} />
                <td className="table-td text-right text-sm font-semibold text-emerald-600">{grandContrats}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Par conseiller ─────────────────────────────────────────────── */}
      <div className="px-5 pt-5">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Par conseiller
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: "720px" }}>
          <thead className="bg-slate-50/70 border-y border-slate-100">
            <tr>
              <th className="table-th">Conseiller</th>
              <th className="table-th">Équipe</th>
              <th className="table-th text-right">Appels</th>
              <th className="table-th text-right">Prospects</th>
              <th className="table-th text-right">Manqués</th>
              <th className="table-th text-right">Devis</th>
              <th className="table-th text-right">Contrats</th>
              <th className="table-th text-right">Taux contrat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.length === 0 && (
              <tr>
                <td colSpan={8} className="table-td text-center text-sm text-slate-400 py-6">
                  Aucun conseiller dans ce périmètre.
                </td>
              </tr>
            )}
            {agents.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="table-td">
                  <Link
                    href={`/admin/utilisateurs/${a.id}`}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    {a.prenom} {a.nom}
                  </Link>
                </td>
                <td className="table-td text-xs text-slate-500">{a.team}</td>
                <td className="table-td text-right text-sm font-medium"><Num value={a.total} /></td>
                <td className="table-td text-right text-sm"><Num value={a.prospects} /></td>
                <td className="table-td text-right text-sm"><Num value={a.manques} tone="text-rose-500" /></td>
                <td className="table-td text-right text-sm"><Num value={a.devis} tone="text-indigo-600" /></td>
                <td className="table-td text-right text-sm font-semibold">
                  <Num value={a.contrats} tone="text-emerald-600" />
                </td>
                <td className="table-td text-right text-sm text-slate-500 tabular-nums">
                  {a.tauxContrat}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="h-2" />
    </section>
  );
}
