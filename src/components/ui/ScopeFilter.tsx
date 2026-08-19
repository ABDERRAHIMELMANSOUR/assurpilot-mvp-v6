"use client";

export type ScopeFilterState = {
  /** "" = all entities, otherwise CPA | ALM. */
  entity: string;
  /** "" = all lines, otherwise AUTO | SANTE. */
  lineType: string;
};

export const EMPTY_SCOPE: ScopeFilterState = { entity: "", lineType: "" };

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
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

interface Props {
  value: ScopeFilterState;
  onChange: (next: ScopeFilterState) => void;
}

const SELECT_CLS =
  "px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs bg-white text-slate-700 " +
  "focus:outline-none focus:ring-2 focus:ring-brand-400 transition-shadow";

/** Entity + line/product dropdowns, designed to sit next to the date filter. */
export default function ScopeFilter({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
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
    </div>
  );
}
