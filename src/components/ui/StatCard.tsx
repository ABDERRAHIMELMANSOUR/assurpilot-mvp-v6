interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  subColor?: string;
  icon?: React.ReactNode;
}

export default function StatCard({ label, value, sub, subColor = "text-gray-400", icon }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        {icon && <span className="text-gray-300">{icon}</span>}
      </div>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>}
    </div>
  );
}
