"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, fetchJson } from "@/lib/fetchJson";

export type AdviserStats = {
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

export type AdviserSettings = {
  /** The ACCOUNT is active. A deactivated account has no editable switches. */
  isActive: boolean;
  /** Eligible to receive incoming calls. */
  isActiveForCalls: boolean;
  /** Prioritised when calls are distributed. */
  isBoosted: boolean;
};

interface Props {
  rows: AdviserStats[];
  /** Keyed by adviser id. Missing entries render their switches as unavailable. */
  settings: Record<string, AdviserSettings>;
  onSettingsChange: (id: string, next: AdviserSettings) => void;
  /** Why the switches cannot be used at all (e.g. the migration is pending). */
  actionsUnavailable?: string;
  /**
   * Reports whether any write is in flight, so the page can hold off a
   * background refresh that would otherwise land mid-toggle and flip the row
   * back to what was stored a moment ago.
   */
  onBusyChange?: (busy: boolean) => void;
}

function Num({ value, tone = "" }: { value: number; tone?: string }) {
  return (
    <span className={`tabular-nums ${value === 0 ? "text-slate-300" : tone || "text-slate-900"}`}>
      {value}
    </span>
  );
}

/**
 * "PAR CONSEILLER" — each adviser's figures and the coach's two switches.
 *
 * The switches update optimistically and settle on whatever the server stored:
 * turning incoming calls off also clears the boost, and the server's answer is
 * what the row ends up showing, so the screen can never claim an adviser is
 * boosted while the database says otherwise. A refusal rolls the row back and
 * says why.
 */
export default function CoachAdvisersTable({ rows, settings, onSettingsChange, actionsUnavailable, onBusyChange }: Props) {
  const toast = useToast();
  // Ids with a request in flight. A second click on the same adviser is ignored
  // until the first settles, so two overlapping writes cannot race each other.
  const [pending, setPending] = useState<Set<string>>(new Set());
  useEffect(() => { onBusyChange?.(pending.size > 0); }, [pending, onBusyChange]);

  async function update(
    row: AdviserStats,
    patch: Partial<Pick<AdviserSettings, "isActiveForCalls" | "isBoosted">>
  ) {
    const before = settings[row.id];
    if (!before || pending.has(row.id)) return;

    const name = `${row.prenom} ${row.nom}`;
    setPending((p) => new Set(p).add(row.id));

    // Optimistic: mirror the server's rule so the row responds instantly.
    const optimistic: AdviserSettings = {
      ...before,
      ...patch,
      isBoosted: patch.isActiveForCalls === false ? false : patch.isBoosted ?? before.isBoosted,
    };
    onSettingsChange(row.id, optimistic);

    try {
      const saved = await fetchJson<{ isActiveForCalls: boolean; isBoosted: boolean }>(
        `/api/coach/advisors/${row.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      onSettingsChange(row.id, { ...before, ...saved });

      if (patch.isActiveForCalls === true) {
        toast.success(`Appels entrants activés pour ${name}`);
      } else if (patch.isActiveForCalls === false) {
        toast.success(
          before.isBoosted
            ? `Appels entrants désactivés pour ${name} — boost retiré`
            : `Appels entrants désactivés pour ${name}`
        );
      } else if (patch.isBoosted === true) {
        toast.success(`Boost activé pour ${name}`);
      } else {
        toast.success(`Boost retiré pour ${name}`);
      }
    } catch (err) {
      onSettingsChange(row.id, before); // roll back to what was really stored
      toast.error(errorMessage(err, `Impossible de modifier ${name}`));
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(row.id);
        return next;
      });
    }
  }

  return (
    <div className="card overflow-hidden mb-4">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-700">Par conseiller</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Vos conseillers, avec leurs appels et les réglages de réception
        </p>
      </div>

      {actionsUnavailable && (
        <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          {actionsUnavailable}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: "1000px" }}>
          <thead className="bg-slate-50/70 border-b border-slate-100">
            <tr>
              <th className="table-th">Conseiller</th>
              <th className="table-th">Équipe</th>
              <th className="table-th text-right">Appels</th>
              <th className="table-th text-right">Prospects</th>
              <th className="table-th text-right">Manqués</th>
              <th className="table-th text-right">Devis</th>
              <th className="table-th text-right">Contrats</th>
              <th className="table-th text-right" title="Contrats signés / appels répondus">Taux</th>
              <th className="table-th text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="table-td text-center text-sm text-slate-400 py-8">
                  Aucun conseiller ne vous est rattaché.
                </td>
              </tr>
            )}

            {rows.map((row) => {
              const s = settings[row.id];
              const busy = pending.has(row.id);
              const locked = !s || !s.isActive || !!actionsUnavailable;
              const muted = s && !s.isActiveForCalls;
              const name = `${row.prenom} ${row.nom}`;

              return (
                <tr key={row.id} className={`transition-colors hover:bg-slate-50/80 ${muted ? "bg-slate-50/60" : ""}`}>
                  <td className="table-td">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/superviseur/equipe/${row.id}`}
                        className={`text-sm font-medium hover:underline ${muted ? "text-slate-400" : "text-brand-700"}`}
                      >
                        {name}
                      </Link>
                      {s && !s.isActive && (
                        <span className="badge badge-gray" style={{ fontSize: "10px", padding: "1px 6px" }}>
                          Compte désactivé
                        </span>
                      )}
                      {s?.isActive && muted && (
                        <span className="badge badge-red" style={{ fontSize: "10px", padding: "1px 6px" }}>
                          Appels coupés
                        </span>
                      )}
                      {s?.isActive && s.isBoosted && (
                        <span className="badge badge-amber" style={{ fontSize: "10px", padding: "1px 6px" }}>
                          ⚡ Boosté
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="table-td text-xs text-slate-500">{row.team}</td>
                  <td className="table-td text-right text-sm font-medium"><Num value={row.total} /></td>
                  <td className="table-td text-right text-sm"><Num value={row.prospects} /></td>
                  <td className="table-td text-right text-sm"><Num value={row.manques} tone="text-rose-500" /></td>
                  <td className="table-td text-right text-sm"><Num value={row.devis} tone="text-indigo-600" /></td>
                  <td className="table-td text-right text-sm font-semibold"><Num value={row.contrats} tone="text-emerald-600" /></td>
                  <td className="table-td text-right text-sm text-slate-500 tabular-nums">{row.tauxContrat}%</td>

                  {/* Actions: the two switches the coach controls. */}
                  <td className="table-td">
                    <div className="flex items-center justify-end gap-3">
                      {/* 1 — Activer / désactiver les appels entrants */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s?.isActiveForCalls ?? false}
                        aria-label={`Activer/Désactiver appels entrants — ${name}`}
                        disabled={locked || busy}
                        onClick={() => s && update(row, { isActiveForCalls: !s.isActiveForCalls })}
                        title={
                          !s?.isActive && s ? "Compte désactivé"
                            : s?.isActiveForCalls ? "Désactiver les appels entrants"
                            : "Activer les appels entrants"
                        }
                        className="inline-flex items-center gap-2 text-xs text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                            s?.isActiveForCalls ? "bg-emerald-500" : "bg-slate-300"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                              s?.isActiveForCalls ? "translate-x-[18px]" : "translate-x-0.5"
                            }`}
                          />
                        </span>
                        <span className="w-[88px] text-left whitespace-nowrap">
                          {!s ? "—" : s.isActiveForCalls ? "Appels actifs" : "Appels coupés"}
                        </span>
                      </button>

                      {/* 2 — Booster les appels. Meaningless on a muted adviser,
                          so it is unavailable until incoming calls are on. */}
                      <button
                        type="button"
                        aria-pressed={s?.isBoosted ?? false}
                        aria-label={`Booster les appels — ${name}`}
                        disabled={locked || busy || !s?.isActiveForCalls}
                        onClick={() => s && update(row, { isBoosted: !s.isBoosted })}
                        title={
                          !s?.isActiveForCalls && s?.isActive
                            ? "Activez d'abord les appels entrants"
                            : s?.isBoosted ? "Retirer le boost" : "Booster les appels"
                        }
                        className={`btn text-xs py-1 px-2.5 whitespace-nowrap min-w-[88px] justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
                          s?.isBoosted ? "btn-primary" : "btn-secondary"
                        }`}
                      >
                        ⚡ {s?.isBoosted ? "Boosté" : "Booster"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
