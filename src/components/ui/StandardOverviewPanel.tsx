"use client";
// /admin/keyyo — the Keyyo standard as AssurPilot sees it: each line (Google Ads number) with its
// agency (ALM / CPA), its space (Santé / Auto), its team and the team's advisers, the Ringover
// numbers declared for it and anything that would stop a call from reaching the right adviser.
import type { StandardLine } from "@/components/ui/RingoverForwardsEditor";

export type StandardOverview = StandardLine & {
  teamId: string | null; teamName: string | null; name: string;
  advisers: Array<{ id: string; name: string; email: string; role: string; ringoverLinked: boolean }>;
  ringoverNumbers: string[];
  problems: string[];
};

const AGENCY_TONE: Record<string, string> = { ALM: "border-violet-200 bg-violet-50/50", CPA: "border-sky-200 bg-sky-50/50" };
const BADGE: Record<string, string> = { ALM: "bg-violet-100 text-violet-800", CPA: "bg-sky-100 text-sky-800" };

export default function StandardOverviewPanel({ lines }: { lines: StandardOverview[] }) {
  if (!lines.length) return null;
  const agencies = [...new Set(lines.map((l) => l.agency ?? "—"))];
  const ready = lines.every((l) => l.problems.length === 0);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold text-slate-700 mr-auto">Lignes du standard Keyyo ↔ agences ↔ conseillers</p>
        <span className={`text-[11px] font-medium ${ready ? "text-emerald-700" : "text-amber-700"}`}>
          {ready ? "Tout est associé" : "À vérifier : voir les points en orange"}
        </span>
      </div>
      <p className="text-[11px] text-slate-500">
        Chaque ligne du standard (numéro publié sur Google Ads) appartient à une équipe : l&apos;équipe fixe l&apos;agence et l&apos;espace, ses conseillers
        reçoivent les appels de la ligne. L&apos;agent Ringover qui décroche est retrouvé par son e-mail, puis ses prénom et nom ; le lien est
        mémorisé au premier appel (« lié à Ringover »).
      </p>
      <div className="grid gap-2 md:grid-cols-2 mt-2">
        {agencies.map((agency) => (
          <div key={agency} className={`rounded-lg border p-2 ${AGENCY_TONE[agency] ?? "border-slate-200 bg-white"}`}>
            <p className="text-[11px] font-semibold text-slate-700 mb-1">Agence {agency}</p>
            {lines.filter((l) => (l.agency ?? "—") === agency).map((l) => (
              <div key={l.numero} className="rounded-md border border-slate-200 bg-white p-2 mb-1.5">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  {l.agency && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${BADGE[l.agency] ?? ""}`}>{l.agency}</span>}
                  <span className="text-xs font-semibold text-slate-800">{l.name}</span>
                  <span className="text-[11px] text-slate-500">{l.label} · <span className="font-mono">{l.numero}</span></span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Équipe : <b>{l.teamName ?? "—"}</b> · {l.advisers.length} conseiller{l.advisers.length > 1 ? "s" : ""} actif{l.advisers.length > 1 ? "s" : ""}
                  {" "}· {l.advisers.filter((a) => a.ringoverLinked).length} lié{l.advisers.filter((a) => a.ringoverLinked).length > 1 ? "s" : ""} à Ringover
                </p>
                <p className="text-[11px] text-slate-600">
                  Numéro{l.ringoverNumbers.length > 1 ? "s" : ""} Ringover :{" "}
                  {l.ringoverNumbers.length
                    ? <span className="font-mono">{l.ringoverNumbers.join(", ")}</span>
                    : <span className="text-slate-400">aucun déclaré (reconnu seulement si Ringover indique le renvoi depuis {l.numero})</span>}
                </p>
                {l.problems.map((p) => <p key={p} className="text-[11px] text-amber-700 mt-0.5">⚠ {p}</p>)}
                {l.advisers.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-[11px] text-brand-600 cursor-pointer">Voir les conseillers</summary>
                    <ul className="mt-1 space-y-0.5">
                      {l.advisers.map((a) => (
                        <li key={a.id} className="text-[11px] text-slate-700 flex flex-wrap gap-x-2">
                          <span className="font-medium">{a.name}</span>
                          <span className="text-slate-500">{a.email}</span>
                          {a.role === "SUPERVISEUR" && <span className="text-slate-400">superviseur</span>}
                          {a.ringoverLinked && <span className="text-emerald-700">lié à Ringover</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
