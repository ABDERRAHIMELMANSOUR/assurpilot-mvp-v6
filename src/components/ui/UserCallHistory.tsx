"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import CallsTable from "./CallsTable";
import StatCard from "./StatCard";
import DateFilter, { DateFilterState, buildQueryString } from "./DateFilter";
import { errorMessage, fetchJsonOr } from "@/lib/fetchJson";

type Profile = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  phoneNumber?: string;
  role: string;
  isActive: boolean;
  team?: { nom: string } | null;
  superviseur?: { nom: string; prenom: string } | null;
};

const ROLE_LABEL: Record<string, string> = {
  CONSEILLER: "Conseiller",
  SUPERVISEUR: "Coach",
  ADMINISTRATEUR: "Administrateur",
};

interface Props {
  userId: string;
  /** Where the "back" link points. Omit when used as a top-level page. */
  backHref?: string;
  backLabel?: string;
  /** Overrides the person's name as the page title (e.g. "Mes appels directs"). */
  heading?: string;
  /** Extra line under the heading. */
  subtitle?: string;
  /** Viewer's own id, so transfer badges read correctly. */
  currentUserId?: string;
  allowTransfer?: boolean;
  isAdmin?: boolean;
}

/**
 * One user's complete call history. Shared by the admin drill-down and the
 * coach's view of a conseiller, since both need exactly the same thing.
 */
export default function UserCallHistory({
  userId, backHref, backLabel, heading, subtitle,
  currentUserId, allowTransfer = false, isAdmin = false,
}: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [calls,   setCalls]   = useState<any[]>([]);
  const [filter,  setFilter]  = useState<DateFilterState>({ period: "", dateFrom: "", dateTo: "" });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await fetchJsonOr<Profile | null>(null, `/api/users/${userId}`);
      if (!cancelled) setProfile(p);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const fetchCalls = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const qs = buildQueryString(filter);
      const url = `/api/calls${qs ? qs + "&" : "?"}userId=${encodeURIComponent(userId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json();
      setCalls(Array.isArray(data) ? data : []);
    } catch (err) {
      setCalls([]);
      setError(errorMessage(err, "Impossible de charger les appels."));
    } finally {
      setLoading(false);
    }
  }, [filter, userId]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  const answered = calls.filter((c) => !c.isMissed).length;
  const devis = calls.filter((c) => c.result?.resultat === "DEVIS_REALISE").length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {backHref && (
        <Link href={backHref} className="text-xs text-brand-600 hover:underline">← {backLabel}</Link>
      )}

      <div className="mt-3 mb-5 flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-sm font-semibold">
            {profile ? `${profile.prenom[0]}${profile.nom[0]}` : "…"}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              {heading ?? (profile ? `${profile.prenom} ${profile.nom}` : "Chargement...")}
            </h1>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
            <p className="text-sm text-slate-500 mt-0.5">
              {profile && (
                <>
                  {ROLE_LABEL[profile.role] ?? profile.role}
                  {profile.team?.nom && <> · {profile.team.nom}</>}
                  {profile.phoneNumber && <> · <span className="font-mono">{profile.phoneNumber}</span></>}
                  {!profile.isActive && <span className="ml-2 badge badge-gray">Inactif</span>}
                </>
              )}
            </p>
          </div>
        </div>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard label="Total appels" value={calls.length} tone="brand" />
        <StatCard label="Répondus"     value={answered}    tone="emerald" />
        <StatCard label="Devis"        value={devis}        tone="indigo" />
      </div>

      {error && (
        <div className="mb-3 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-sm text-rose-700">{error}</div>
      )}

      {loading
        ? <div className="card p-8 text-center text-slate-400 animate-pulse">Chargement...</div>
        : <CallsTable
            calls={calls}
            showAgent
            showNotes
            allowResult
            isAdmin={isAdmin}
            allowTransfer={allowTransfer}
            currentUserId={currentUserId}
            onRefresh={fetchCalls}
          />
      }
    </div>
  );
}
