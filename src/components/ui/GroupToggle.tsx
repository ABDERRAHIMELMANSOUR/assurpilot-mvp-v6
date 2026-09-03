"use client";

interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
}

/**
 * Switches the call list between one row per call and one row per caller.
 *
 * Grouping is the useful default — a prospect who rang three times is one lead
 * — but the raw list still has to be reachable, because that is what the export
 * and the totals count.
 */
export default function GroupToggle({ value, onChange }: Props) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-400"
      />
      Regrouper les doublons
    </label>
  );
}
