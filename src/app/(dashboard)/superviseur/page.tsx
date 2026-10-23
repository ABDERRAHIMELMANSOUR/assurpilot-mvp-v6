"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import StatCard from "@/components/ui/StatCard";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";
import CoachAdvisersTable, { AdviserSettings } from "@/components/ui/CoachAdvisersTable";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { usePolling } from "@/lib/usePolling";
import Link from "next/link";

const EMPTY: DateFilterState = { period: "month", dateFrom: "", dateTo: "" };

type Roster = {
  team: { id: string; nom: string } | null;
  advisers: Array<{ id: string; isActive: boolean; isActiveForCalls: boolean; isBoosted: boolean }>;
};

export default function CoachDashboardPage() {
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<DateFilterState>(EMPTY);
  const [error,   setError]   = useState("");

  // The switches are independent of the date filter, so they are loaded once and
  // kept separate from the figures: if one request fails the other still shows.
  const [team,      setTeam]      = useState<Roster["team"]>(null);
  const [settings,  setSettings]  = useState<Record<string, AdviserSettings>>({});
  const [actionsError, setActionsError] = useState("");

  const fetchStats = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setStats(await fetchJson("/api/analytics" + buildQueryString(filter)));
    } catch (err) {
      setStats(null);
      setError(errorMessage(err, "Impossible de charger les statistiques."));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Loaded on mount, then re-read in the background: an administrator can
  // override a switch from their own page, and a coach looking at the old value
  // would both mislead them and re-send it on the next click.
  const writing = useRef(false);
  const reading = useRef(false);

  const loadRoster = useCallback(async (silent: boolean) => {
    if (reading.current) return;
    reading.current = true;
    try {
      const roster = await fetchJson<Roster>("/api/coach/advisors");
      // A background answer must never land on top of a toggle in flight: it
      // would flip the row back to the value stored before the click.
      if (silent && writing.current) return;
      setTeam(roster.team);
      setSettings(Object.fromEntries(roster.advisers.map((a) => [a.id, {
        isActive: a.isActive,
        isActiveForCalls: a.isActiveForCalls,
        isBoosted: a.isBoosted,
      }])));
      setActionsError("");
    } catch (err) {
      // A failed background refresh keeps what is on screen.
      if (!silent) setActionsError(errorMessage(err, "Les réglages de réception sont indisponibles."));
    } finally {
      reading.current = false;
    }
  }, []);

  useEffect(() => { void loadRoster(false); }, [loadRoster]);
  usePolling(() => loadRoster(true), 8_000);

  const tauxGlobal = stats && (stats.totalAppels - stats.totalManques) > 0
    ? Math.round((stats.totalDevis / (stats.totalAppels - stats.totalManques)) * 100)
    : 0;

  const teamLabel = team?.nom ?? "votre équipe";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Vue d&apos;ensemble — {team?.nom ?? "Équipe"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">Appels reçus et conseillers de votre équipe</p>
        </div>
        <DateFilter value={filter} onChange={setFilter} allowAll={false} />
      </div>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-6 animate-pulse">
          {[...Array(7)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
        </div>
      ) : stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
            {/* The headline for a coach: everything their team received. */}
            <StatCard label="Appels reçus" tone="brand" value={stats.totalAppels}
              sub={teamLabel} />
            <StatCard label="Total prospects" tone="brand"
              value={stats.totalProspects ?? stats.totalAppels}
              sub="numéros distincts" />
            <StatCard label="Doublons" tone="amber" value={stats.totalDoublons ?? 0}
              sub="appels répétés"
              subColor={(stats.totalDoublons ?? 0) > 0 ? "text-amber-600" : "text-slate-400"} />
            <StatCard label="Contrats signés" tone="emerald" value={stats.totalContrats ?? 0} subColor="text-emerald-600" />
            <StatCard label="Devis réalisés" tone="indigo" value={stats.totalDevis}   subColor="text-indigo-600" />
            <StatCard label="Appels manqués" tone="rose" value={stats.totalManques} subColor="text-rose-500" />
            <StatCard label="Taux global" tone="indigo"    value={`${tauxGlobal}%`}  sub="conversion" subColor="text-brand-600" />
          </div>

          <CoachAdvisersTable
            rows={stats.leaderboard ?? []}
            settings={settings}
            onSettingsChange={(id, next) => setSettings((prev) => ({ ...prev, [id]: next }))}
            actionsUnavailable={actionsError || undefined}
            onBusyChange={(busy) => { writing.current = busy; }}
          />

          <div className="text-right">
            <Link href="/superviseur/equipe" className="text-xs text-brand-600 hover:underline">
              Gérer l&apos;équipe →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
