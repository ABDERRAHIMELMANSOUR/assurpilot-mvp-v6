"use client";

import { useEffect, useState } from "react";
import { fetchJsonOr } from "@/lib/fetchJson";

export type ScopeFilterState = {
  /** "" = all entities, otherwise CPA | ALM. */
  entity: string;
  /** "" = all lines, otherwise AUTO | SANTE. */
  lineType: string;
  /** "" = all coaches, otherwise a coach's user id. */
  coachId: string;
};

export const EMPTY_SCOPE: ScopeFilterState = { entity: "", lineType: "", coachId: "" };

const ENTITIES = [
  { value: "", label: "Toutes les entités" },
  { value: "CPA", label: "Équipe CPA" },
  { value: "ALM", label: "Équipe ALM" },
];

const LINES = [
  { value: "", label: "Toutes les lignes" },
  { value: "AUTO", label: "Auto" },
  { value: "SANTE", label: "Santé" },
];

/** Appends the scope to an existing query string (with or without a leading "?"). */
export function withScope(queryString: string, scope: ScopeFilterState): string {
  const params = new URLSearchParams(
    queryString.startsWith("?") ? queryString.slice(1) : queryString
  );
  if (scope.entity) params.set("entity", scope.entity);
  if (scope.lineType) params.set("lineType", scope.lineType);
  if (scope.coachId) params.set("coachId", scope.coachId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

type Coach = { id: string; nom: string; prenom: string };

/**
 * The coaches the scope bar offers.
 *
 * Shared so a page can name the selected coach — in a caption, a heading —
 * without a second definition of what the list is. A failure yields an empty
 * list rather than breaking the caller.
 */
export function useCoaches(): Coach[] {
  const [coaches, setCoaches] = useState<Coach[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchJsonOr<Coach[]>([], "/api/users?role=SUPERVISEUR");
      if (!cancelled) setCoaches(Array.isArray(list) ? list : []);
    })();
    return () => { cancelled = true; };
  }, []);

  return coaches;
}

/** Display name of a coach id, or "" when nothing is selected. */
export function coachName(coaches: Coach[], id: string): string {
  const match = coaches.find((c) => c.id === id);
  return match ? `${match.prenom} ${match.nom}` : "";
}

interface Props {
  value: ScopeFilterState;
  onChange: (next: ScopeFilterState) => void;
}

const SELECT_CLS =
  "px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs bg-white text-slate-700 " +
  "focus:outline-none focus:ring-2 focus:ring-brand-400 transition-shadow";

/**
 * The dashboard's scope bar: entity, line/product and coach.
 *
 * One component for every screen that filters by perimeter, so the three
 * dropdowns cannot drift apart between pages — and `withScope` is the single
 * place that turns them into query parameters, which the call list, the
 * analytics and the Excel export all read the same way.
 */
export default function ScopeFilter({ value, onChange }: Props) {
  const coaches = useCoaches();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Filtrer par entité"
        value={value.entity}
        onChange={(e) => onChange({ ...value, entity: e.target.value })}
        className={SELECT_CLS}
      >
        {ENTITIES.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        aria-label="Filtrer par ligne"
        value={value.lineType}
        onChange={(e) => onChange({ ...value, lineType: e.target.value })}
        className={SELECT_CLS}
      >
        {LINES.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        aria-label="Filtrer par coach"
        value={value.coachId}
        onChange={(e) => onChange({ ...value, coachId: e.target.value })}
        className={SELECT_CLS}
      >
        <option value="">Tous les coaches</option>
        {coaches.map((c) => (
          <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
        ))}
      </select>
    </div>
  );
}
