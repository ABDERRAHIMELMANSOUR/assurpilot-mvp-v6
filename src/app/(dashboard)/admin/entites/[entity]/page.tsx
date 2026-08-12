"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import CallsTable from "@/components/ui/CallsTable";
import DateFilter, { DateFilterState, buildQueryString } from "@/components/ui/DateFilter";
import ExportCallsButton from "@/components/ui/ExportCallsButton";
import { errorMessage, fetchJsonOr } from "@/lib/fetchJson";

type Person = {
  id: string; prenom: string; nom: string; role: string; isActive: boolean;
  phoneNumber?: string;
  team?: { id: string; nom: string } | null;
  superviseur?: { id: string; prenom: string; nom: string } | null;
};

const SUB_TEAMS = [
  { key: "", label: "Tous les pôles" },
  { key: "AUTO", label: "Auto" },
  { key: "SANTE", label: "Santé" },
] as const;

/** Same derivation as the server (src/lib/entity.ts), for client-side grouping. */
function entityOf(teamName?: string | null): "CPA" | "ALM" | null {
  if (!teamName) return null;
  const folded = teamName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (/\bCPA\b/.test(folded)) return "CPA";
  if (/\bALM\b/.test(folded)) return "ALM";
  return null;
}

function subTeamOf(teamName?: string | null): "AUTO" | "SANTE" | null {
  if (!teamName) return null;
  const folded = teamName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (/\bAUTO\b/.test(folded)) return "AUTO";
  if (/\bSANTE\b/.test(folded)) return "SANTE";
  return null;
}

export default function EntityWorkspacePage({ params }: { params: { entity: string } }) {
  const entity = params.entity.toUpperCase();
  if (entity !== "CPA" && entity !== "ALM") notFound();

  const [people,  setPeople]  = useState<Person[]>([]);
  const [calls,   setCalls]   = useState<any[]>([]);
  const [filter,  setFilter]  = useState<DateFilterState>({ period: "", dateFrom: "", dateTo: "" });
  const [subTeam, setSubTeam] = useState<string>("");
  const [coachId, setCoachId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  // The full roster is fetched once and grouped client-side; only the calls
  // query is re-issued when a filter changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await fetchJsonOr<Person[]>([], "/api/users");
      if (!cancelled) setPeople(Array.isArray(all) ? all : []);
    })();
    return () => { cancelled = true; };
  }, []);

  const inEntity = useMemo(
    () => people.filter((p) => entityOf(p.team?.nom) === entity),
    [people, entity]
  );
  const coaches = useMemo(
    () => inEntity.filter((p) => p.role === "SUPERVISEUR"),
    [inEntity]
  );
  const conseillers = useMemo(
    () => inEntity.filter((p) => {
      if (p.role !== "CONSEILLER") return false;
      if (subTeam && subTeamOf(p.team?.nom) !== subTeam) return false;
      if (coachId && p.superviseur?.id !== coachId) return false;
      return true;
    }),
    [inEntity, subTeam, coachId]
  );

  /** Query string shared by the table and the export, so both agree exactly. */
  const query = useMemo(() => {
    const qs = buildQueryString(filter);
    const p = new URLSearchParams(qs.startsWith("?") ? qs.slice(1) : qs);
    p.set("entity", entity);
    if (subTeam) p.set("subTeam", subTeam);
    if (coachId) p.set("coachId", coachId);
    return "?" + p.toString();
  }, [filter, entity, subTeam, coachId]);

  const fetchCalls = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/calls" + query);
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
  }, [query]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Équipe {entity}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {coaches.length} coach{coaches.length > 1 ? "s" : ""} ·{" "}
            {conseillers.length} conseiller{conseillers.length > 1 ? "s" : ""} ·{" "}
            {calls.length} appel{calls.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateFilter value={filter} onChange={setFilter} />
          <ExportCallsButton query={query} />
        </div>
      </div>

      {/* Sub-team + coach filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {SUB_TEAMS.map((s) => (
            <button key={s.key} onClick={() => setSubTeam(s.key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                subTeam === s.key ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
              }`}>
              {s.label}
            </button>
          ))}
        </div>

        <select
          value={coachId}
          onChange={(e) => setCoachId(e.target.value)}
          className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tous les coachs</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
          ))}
        </select>
      </div>

      {/* Roster */}
      <div className="grid md:grid-cols-2 gap-3 mb-5">
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Coachs</p>
          {coaches.length === 0 ? <p className="text-sm text-gray-400">Aucun coach.</p> : (
            <ul className="space-y-1">
              {coaches.map((c) => (
                <li key={c.id} className="text-sm">
                  <Link href={`/admin/utilisateurs/${c.id}`} className="text-blue-700 hover:underline">
                    {c.prenom} {c.nom}
                  </Link>
                  <span className="text-gray-400 text-xs"> · {c.team?.nom}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Conseillers</p>
          {conseillers.length === 0 ? <p className="text-sm text-gray-400">Aucun conseiller.</p> : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {conseillers.map((c) => (
                <li key={c.id} className="text-sm">
                  <Link href={`/admin/utilisateurs/${c.id}`} className="text-blue-700 hover:underline">
                    {c.prenom} {c.nom}
                  </Link>
                  <span className="text-gray-400 text-xs">
                    {c.team?.nom ? ` · ${c.team.nom}` : ""}
                    {c.superviseur ? ` · ${c.superviseur.prenom} ${c.superviseur.nom}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      {loading
        ? <div className="card p-8 text-center text-gray-400 animate-pulse">Chargement...</div>
        : <CallsTable calls={calls} showAgent showNotes allowResult isAdmin allowTransfer onRefresh={fetchCalls} />
      }
    </div>
  );
}
