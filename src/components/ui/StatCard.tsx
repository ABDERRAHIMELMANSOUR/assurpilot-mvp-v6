/**
 * Floating metric widget: large figure, muted label, and a soft coloured icon
 * badge. `tone` selects the badge palette; `icon` overrides the default glyph.
 */
type Tone = "brand" | "emerald" | "rose" | "amber" | "slate" | "indigo";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  subColor?: string;
  icon?: React.ReactNode;
  tone?: Tone;
}

const TONE: Record<Tone, string> = {
  brand:   "bg-brand-50 text-brand-700 ring-brand-100",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  rose:    "bg-rose-50 text-rose-600 ring-rose-100",
  amber:   "bg-amber-50 text-amber-600 ring-amber-100",
  indigo:  "bg-indigo-50 text-indigo-600 ring-indigo-100",
  slate:   "bg-slate-100 text-slate-500 ring-slate-100",
};

/** Default glyph per tone, so callers get a sensible icon for free. */
function DefaultIcon({ tone }: { tone: Tone }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, viewBox: "0 0 24 24" } as const;
  if (tone === "emerald") {
    return (
      <svg className="w-4 h-4" {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (tone === "rose") {
    return (
      <svg className="w-4 h-4" {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  if (tone === "amber") {
    return (
      <svg className="w-4 h-4" {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (tone === "indigo") {
    return (
      <svg className="w-4 h-4" {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5V10M9 20H4V4h11v6m-6 4h6m-6 4h6" />
      </svg>
    );
  }
  // brand / slate: a phone, the product's core object.
  return (
    <svg className="w-4 h-4" {...common}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

export default function StatCard({
  label, value, sub, subColor = "text-slate-400", icon, tone = "brand",
}: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ring-4 ${TONE[tone]}`}>
          {icon ?? <DefaultIcon tone={tone} />}
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      {sub && <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>}
    </div>
  );
}
