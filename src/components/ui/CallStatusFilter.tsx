"use client";
// Dropdown filter of the call lists (« Appels de l'équipe », « Tous les appels »): one choice among
// the call STATUS (Reçu / Manqué / En cours) or its RESULT (Hors cible, NRP, Devis…, or « À
// qualifier »). Applied by the server (/api/calls ?statut= / ?resultat=), so it covers the whole
// period, not only the rows already on screen.
import { useEffect, useState } from "react";
import { withParam } from "@/lib/query";

type ResultOption = { value: string; label: string; isActive?: boolean };

/** "" = no filter; "statut:REPONDU"; "resultat:HORS_CIBLE"; "resultat:A_QUALIFIER". */
export type CallStatusChoice = string;

export const CALL_STATUTS: Array<{ value: string; label: string }> = [
  { value: "REPONDU", label: "Reçu (répondu)" },
  { value: "MANQUE", label: "Manqué" },
  { value: "EN_COURS", label: "En cours" },
];

/** Adds the choice (?statut= or ?resultat=) to a query string that may be empty or start with "?". */
export function withStatus(query: string, choice: CallStatusChoice): string {
  const [kind, value] = choice.split(":");
  if (!value || (kind !== "statut" && kind !== "resultat")) return query;
  return withParam(query, kind, value);
}

export default function CallStatusFilter({ value, onChange }: { value: CallStatusChoice; onChange: (v: CallStatusChoice) => void }) {
  const [options, setOptions] = useState<ResultOption[]>([]);
  useEffect(() => {
    fetch("/api/call-result-options")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setOptions(Array.isArray(d) ? d : []))
      .catch(() => setOptions([]));
  }, []);

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className="whitespace-nowrap">Statut</span>
      <select
        aria-label="Filtrer par statut"
        className={`input text-xs py-1.5 w-48 ${value ? "border-brand-400 text-slate-900" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Tous les statuts</option>
        <optgroup label="Appel">
          {CALL_STATUTS.map((s) => <option key={s.value} value={`statut:${s.value}`}>{s.label}</option>)}
        </optgroup>
        <optgroup label="Résultat">
          <option value="resultat:A_QUALIFIER">À qualifier (sans résultat)</option>
          {options.map((o) => (
            <option key={o.value} value={`resultat:${o.value}`}>{o.label}{o.isActive === false ? " (désactivé)" : ""}</option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
