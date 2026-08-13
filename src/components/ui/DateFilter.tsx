"use client";

export type DateFilterState = {
  period: "today" | "week" | "month" | "custom" | "";
  dateFrom: string;
  dateTo: string;
};

interface Props {
  value: DateFilterState;
  onChange: (v: DateFilterState) => void;
}

const PERIODS = [
  { key: "today", label: "Aujourd'hui" },
  { key: "week",  label: "7 derniers jours" },
  { key: "month", label: "Ce mois" },
  { key: "custom", label: "Personnalisé" },
] as const;

export function buildQueryString(f: DateFilterState): string {
  if (!f.period && !f.dateFrom && !f.dateTo) return "";
  const p = new URLSearchParams();
  if (f.period && f.period !== "custom") {
    p.set("period", f.period);
  } else {
    if (f.dateFrom) p.set("dateFrom", f.dateFrom);
    if (f.dateTo)   p.set("dateTo",   f.dateTo);
  }
  return "?" + p.toString();
}

export default function DateFilter({ value, onChange }: Props) {
  function setPeriod(period: DateFilterState["period"]) {
    onChange({ period, dateFrom: "", dateTo: "" });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Quick period buttons */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
        <button
          onClick={() => onChange({ period: "", dateFrom: "", dateTo: "" })}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            !value.period ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Tout
        </button>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              value.period === p.key
                ? "bg-white shadow-sm text-slate-900"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {value.period === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={value.dateFrom}
            onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
            className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
          />
          <span className="text-xs text-slate-400">→</span>
          <input
            type="date"
            value={value.dateTo}
            onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
            className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
          />
        </div>
      )}
    </div>
  );
}
