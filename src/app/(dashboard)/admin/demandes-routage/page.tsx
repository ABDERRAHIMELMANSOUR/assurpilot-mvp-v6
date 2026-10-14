"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StatCard from "@/components/ui/StatCard";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { usePolling } from "@/lib/usePolling";
import {
  hasPending,
  pendingSummary,
  type AdminAdviserRow,
} from "@/lib/routingState";

/** How often the list is re-read. Short enough to feel live; cheap enough to leave open. */
const POLL_MS = 5_000;
/** How long a row stays highlighted after someone else changed it. */
const FLASH_MS = 4_500;

type Chip = "all" | "pending" | "activate" | "cut" | "boost" | "unboost" | "routing";

const CHIPS: Array<{ key: Chip; label: string; hint: string }> = [
  { key: "all",      label: "Tous",                hint: "Tous les conseillers" },
  { key: "pending",  label: "À appliquer",         hint: "Au moins un changement à faire sur le standard" },
  { key: "activate", label: "Appels à activer",    hint: "Le coach demande l'activation, pas encore faite sur le standard" },
  { key: "cut",      label: "Appels à couper",     hint: "Le coach demande la coupure, pas encore faite sur le standard" },
  { key: "boost",    label: "À booster",           hint: "Le coach demande un boost, pas encore fait sur le standard" },
  { key: "unboost",  label: "Boost à retirer",     hint: "Le coach retire le boost, pas encore fait sur le standard" },
  { key: "routing",  label: "Routage actif",       hint: "Conseillers dont les appels entrants sont activés" },
];

function matches(row: AdminAdviserRow, chip: Chip): boolean {
  switch (chip) {
    case "all":      return true;
    case "pending":  return hasPending(row.pending);
    case "activate": return row.pending.activation === "ACTIVER";
    case "cut":      return row.pending.activation === "COUPER";
    case "boost":    return row.pending.boost === "BOOSTER";
    case "unboost":  return row.pending.boost === "RETIRER";
    case "routing":  return row.requested.isActiveForCalls;
  }
}

function timeAgo(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "à l'instant";
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

/** Tab-separated, so a paste into Excel, Sheets or a PBX admin grid lands in columns. */
function toTsv(rows: AdminAdviserRow[]): string {
  const header = ["Conseiller", "Téléphone", "Équipe", "Coach", "Appels entrants", "Booster", "Statut standard"];
  const lines = rows.map((r) => [
    `${r.prenom} ${r.nom}`,
    r.phoneNumber,
    r.team ?? "",
    r.coach ? `${r.coach.prenom} ${r.coach.nom}` : "",
    r.requested.isActiveForCalls ? "Activé" : "Désactivé",
    r.requested.isBoosted ? "Actif" : "Inactif",
    pendingSummary(r.pending),
  ]);
  return [header, ...lines].map((cols) => cols.join("\t")).join("\n");
}

type ApplyResponse = { applied: string[]; stale: string[]; skipped: string[]; advisers: AdminAdviserRow[] };

export default function DemandesRoutagePage() {
  const toast = useToast();

  const [rows, setRows] = useState<AdminAdviserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [lastSyncMs, setLastSyncMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [chip, setChip] = useState<Chip>("pending");
  const [search, setSearch] = useState("");
  const [coachId, setCoachId] = useState("");

  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());

  // Previous snapshot, to tell what changed under the admin's feet between polls.
  const previous = useRef<Map<string, string>>(new Map());
  // Server clock minus browser clock, so "il y a 5 min" is measured against the
  // clock that stamped the change, not a possibly-wrong local one.
  const skewMs = useRef(0);
  // Bumped whenever a write lands. A poll that STARTED before that write may
  // answer after it with older data; comparing epochs lets us drop that answer
  // instead of letting it overwrite the fresher row.
  const epoch = useRef(0);
  const polling = useRef(false);

  const fingerprint = (r: AdminAdviserRow) =>
    `${r.requested.isActiveForCalls}|${r.requested.isBoosted}|${r.applied.isActiveForCalls}|${r.applied.isBoosted}|${r.isActive}`;

  /** Merge fresh rows in, and highlight any whose routing changed since last seen. */
  const ingest = useCallback((fresh: AdminAdviserRow[], replaceAll: boolean) => {
    const changed: string[] = [];
    const seen = previous.current;
    for (const r of fresh) {
      const fp = fingerprint(r);
      if (seen.has(r.id) && seen.get(r.id) !== fp) changed.push(r.id);
      seen.set(r.id, fp);
    }

    setRows((current) => {
      if (replaceAll) return fresh;
      const byId = new Map(current.map((r) => [r.id, r]));
      for (const r of fresh) byId.set(r.id, r);
      return [...byId.values()];
    });

    if (changed.length) {
      setFlash((f) => new Set([...f, ...changed]));
      setTimeout(() => {
        setFlash((f) => {
          const next = new Set(f);
          changed.forEach((id) => next.delete(id));
          return next;
        });
      }, FLASH_MS);
    }
    return changed;
  }, []);

  const load = useCallback(async (silent: boolean) => {
    if (polling.current) return;
    polling.current = true;
    const startedAt = epoch.current;
    try {
      const data = await fetchJson<{ advisers: AdminAdviserRow[]; serverTime: string }>(
        "/api/admin/call-settings"
      );
      if (epoch.current !== startedAt) return; // a write landed meanwhile; this is older
      skewMs.current = new Date(data.serverTime).getTime() - Date.now();
      ingest(data.advisers, true);
      setLastSyncMs(Date.now());
      setError("");
      setLoaded(true);
    } catch (err) {
      // A failed background refresh must not wipe a screen that is working.
      if (!silent || !loaded) setError(errorMessage(err, "Impossible de charger les demandes."));
    } finally {
      polling.current = false;
    }
  }, [ingest, loaded]);

  useEffect(() => { void load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(() => load(true), POLL_MS);

  // One tick a second so "il y a 12 s" counts up without re-fetching anything.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const serverNow = nowMs + skewMs.current;

  // ── derived views ─────────────────────────────────────────────────────────
  // A deactivated account is not an adviser any more and its routing cannot be
  // edited, so it stays out of the worklist rather than lingering as noise.
  const live = useMemo(() => rows.filter((r) => r.isActive), [rows]);
  const hiddenInactive = rows.length - live.length;

  const counts = useMemo(() => {
    const c = {} as Record<Chip, number>;
    for (const { key } of CHIPS) c[key] = live.filter((r) => matches(r, key)).length;
    return c;
  }, [live]);

  const coaches = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of live) if (r.coach) map.set(r.coach.id, `${r.coach.prenom} ${r.coach.nom}`);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [live]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return live
      .filter((r) => matches(r, chip))
      .filter((r) => !coachId || r.coach?.id === coachId)
      .filter((r) => !needle || `${r.prenom} ${r.nom} ${r.phoneNumber} ${r.team ?? ""}`.toLowerCase().includes(needle))
      // Outstanding work first, then alphabetical — the page is a worklist.
      .sort((a, b) => Number(hasPending(b.pending)) - Number(hasPending(a.pending)) ||
        `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, "fr"));
  }, [live, chip, coachId, search]);

  const visiblePending = visible.filter((r) => hasPending(r.pending));

  // ── actions ───────────────────────────────────────────────────────────────
  const markBusy = (id: string, on: boolean) =>
    setBusy((b) => { const n = new Set(b); on ? n.add(id) : n.delete(id); return n; });

  async function override(row: AdminAdviserRow, patch: { isActiveForCalls?: boolean; isBoosted?: boolean }, message: string) {
    if (busy.has(row.id)) return;
    markBusy(row.id, true);
    try {
      const { adviser } = await fetchJson<{ adviser: AdminAdviserRow }>(`/api/admin/call-settings/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      epoch.current++;
      ingest([adviser], false);
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err, `Impossible de modifier ${row.prenom} ${row.nom}`));
    } finally {
      markBusy(row.id, false);
    }
  }

  /** Approve one or many. Returns normally even when some rows were stale. */
  async function apply(targets: AdminAdviserRow[]) {
    const res = await fetchJson<ApplyResponse>("/api/admin/call-settings/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: targets.map((t) => ({
          id: t.id,
          isActiveForCalls: t.requested.isActiveForCalls,
          isBoosted: t.requested.isBoosted,
        })),
      }),
    });
    epoch.current++;
    ingest(res.advisers, false);

    if (res.stale.length) {
      toast.error(
        res.stale.length === 1
          ? "Ce conseiller vient d'être modifié par son coach : vérifiez le nouveau réglage avant de l'appliquer."
          : `${res.stale.length} conseillers viennent d'être modifiés : vérifiez les nouveaux réglages avant de les appliquer.`
      );
    }
    return res;
  }

  async function applyOne(row: AdminAdviserRow) {
    if (busy.has(row.id)) return;
    markBusy(row.id, true);
    try {
      const res = await apply([row]);
      if (res.applied.length) toast.success(`${row.prenom} ${row.nom} : marqué appliqué sur le standard`);
    } catch (err) {
      toast.error(errorMessage(err, `Impossible de marquer ${row.prenom} ${row.nom}`));
    } finally {
      markBusy(row.id, false);
    }
  }

  async function applyAll() {
    if (!visiblePending.length || bulkBusy) return;
    // A statement about an external system's state, applied to many rows at once:
    // worth one explicit confirmation.
    const ok = window.confirm(
      `Confirmer que les ${visiblePending.length} changement(s) affiché(s) ont bien été effectués sur le standard ?`
    );
    if (!ok) return;

    setBulkBusy(true);
    try {
      const res = await apply(visiblePending);
      if (res.applied.length) toast.success(`${res.applied.length} conseiller(s) marqué(s) appliqué(s)`);
    } catch (err) {
      toast.error(errorMessage(err, "Impossible de marquer les conseillers"));
    } finally {
      setBulkBusy(false);
    }
  }

  async function copyList() {
    if (!visible.length) return;
    try {
      await navigator.clipboard.writeText(toTsv(visible));
      toast.success(`${visible.length} ligne(s) copiée(s) — prêtes à coller dans un tableur`);
    } catch {
      toast.error("La copie a échoué : autorisez l'accès au presse-papiers ou utilisez l'export Excel.");
    }
  }

  async function exportList() {
    if (!visible.length || exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/admin/call-settings/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: visible.map((r) => r.id) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      const blob = await res.blob();
      const name =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "routage-appels.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`${visible.length} ligne(s) exportée(s)`);
    } catch (err) {
      toast.error(errorMessage(err, "L'export a échoué."));
    } finally {
      setExporting(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  const ageSeconds = lastSyncMs ? Math.max(0, Math.round((nowMs - lastSyncMs) / 1000)) : null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Demandes de routage</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Réglages d&apos;appels demandés par les coachs, et ce qui reste à faire sur le standard (Keyyo / PBX)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" aria-live="off">
            <span className={`relative flex h-2 w-2`}>
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${error ? "bg-rose-400" : "bg-emerald-400 animate-ping"}`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${error ? "bg-rose-500" : "bg-emerald-500"}`} />
            </span>
            {error ? "Connexion perdue"
              : ageSeconds === null ? "Chargement…"
              : ageSeconds < 3 ? "En direct" : `Mis à jour il y a ${ageSeconds} s`}
          </span>
          <button onClick={() => void load(false)} className="btn btn-secondary text-xs">↻ Actualiser</button>
          <button onClick={copyList} disabled={!visible.length} className="btn btn-secondary text-xs disabled:opacity-40">
            ⧉ Copier la liste ({visible.length})
          </button>
          <button onClick={exportList} disabled={!visible.length || exporting} className="btn btn-secondary text-xs disabled:opacity-40">
            {exporting ? "Export…" : `↓ Exporter Excel (${visible.length})`}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Conseillers" tone="brand" value={live.length}
          sub={hiddenInactive ? `${hiddenInactive} compte(s) désactivé(s) masqué(s)` : "comptes actifs"} />
        <StatCard label="À appliquer" tone="amber" value={counts.pending}
          sub={counts.pending ? "changements en attente" : "tout est à jour"}
          subColor={counts.pending ? "text-amber-600" : "text-emerald-600"} />
        <StatCard label="Routage actif" tone="emerald" value={counts.routing}
          sub="appels entrants activés" subColor="text-emerald-600" />
        <StatCard label="Boostés" tone="indigo"
          value={live.filter((r) => r.requested.isBoosted).length}
          sub="priorité demandée" subColor="text-indigo-600" />
      </div>

      {/* Status chips: the worklist, sliced by what has to happen on the PBX. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(c.key)}
            title={c.hint}
            className={`btn text-xs py-1.5 ${chip === c.key ? "btn-primary" : "btn-secondary"}`}
          >
            {c.label}
            <span className={`ml-1.5 tabular-nums ${chip === c.key ? "opacity-80" : "text-slate-400"}`}>{counts[c.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un conseiller, un numéro, une équipe…"
          aria-label="Rechercher"
          className="input text-xs w-72"
        />
        <select
          value={coachId}
          onChange={(e) => setCoachId(e.target.value)}
          aria-label="Filtrer par coach"
          className="px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="">Tous les coaches</option>
          {coaches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>

        <div className="flex-1" />
        <button
          onClick={applyAll}
          disabled={!visiblePending.length || bulkBusy}
          className="btn btn-primary text-xs disabled:opacity-40"
        >
          {bulkBusy ? "Application…" : `✓ Tout marquer appliqué (${visiblePending.length})`}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: "1100px" }}>
            <thead className="bg-slate-50/70 border-b border-slate-100">
              <tr>
                <th className="table-th">Conseiller</th>
                <th className="table-th">Équipe / Coach</th>
                <th className="table-th">Appels entrants</th>
                <th className="table-th">Booster</th>
                <th className="table-th">Sur le standard</th>
                <th className="table-th">Dernière demande</th>
                <th className="table-th text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loaded && !error && (
                <tr><td colSpan={7} className="table-td text-center text-sm text-slate-400 py-10 animate-pulse">Chargement…</td></tr>
              )}
              {loaded && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="table-td text-center text-sm text-slate-400 py-10">
                    {chip === "pending" && !search && !coachId
                      ? "Rien à appliquer : le standard est à jour avec les demandes des coachs."
                      : "Aucun conseiller ne correspond à ces filtres."}
                  </td>
                </tr>
              )}

              {visible.map((r) => {
                const rowBusy = busy.has(r.id);
                const pending = hasPending(r.pending);
                const flashing = flash.has(r.id);
                const who = `${r.prenom} ${r.nom}`;

                return (
                  <tr
                    key={r.id}
                    className={`transition-colors ${flashing ? "bg-amber-50 ring-1 ring-inset ring-amber-300" : "hover:bg-slate-50/80"}`}
                  >
                    <td className="table-td">
                      <p className="text-sm font-medium text-slate-900">{who}</p>
                      <p className="font-mono text-xs text-slate-400">{r.phoneNumber || "—"}</p>
                    </td>

                    <td className="table-td">
                      <p className="text-xs text-slate-600">{r.team ?? "—"}</p>
                      <p className="text-xs text-slate-400">
                        {r.coach ? `Coach : ${r.coach.prenom} ${r.coach.nom}` : "Sans coach"}
                      </p>
                    </td>

                    {/* Appels entrants — the coach's request, with the admin's override. */}
                    <td className="table-td">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.requested.isActiveForCalls}
                        aria-label={`Forcer les appels entrants — ${who}`}
                        disabled={rowBusy}
                        onClick={() => override(
                          r,
                          { isActiveForCalls: !r.requested.isActiveForCalls },
                          r.requested.isActiveForCalls
                            ? `Appels entrants désactivés pour ${who}${r.requested.isBoosted ? " — boost retiré" : ""}`
                            : `Appels entrants activés pour ${who}`
                        )}
                        title="Forcer ce réglage (administrateur)"
                        className="inline-flex items-center gap-2 text-xs disabled:opacity-40"
                      >
                        <span className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${r.requested.isActiveForCalls ? "bg-emerald-500" : "bg-slate-300"}`}>
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${r.requested.isActiveForCalls ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                        </span>
                        <span className={`font-medium ${r.requested.isActiveForCalls ? "text-emerald-700" : "text-slate-500"}`}>
                          {r.requested.isActiveForCalls ? "Activé" : "Désactivé"}
                        </span>
                      </button>
                    </td>

                    {/* Booster */}
                    <td className="table-td">
                      <button
                        type="button"
                        aria-pressed={r.requested.isBoosted}
                        aria-label={`Forcer le boost — ${who}`}
                        disabled={rowBusy || !r.requested.isActiveForCalls}
                        onClick={() => override(
                          r,
                          { isBoosted: !r.requested.isBoosted },
                          r.requested.isBoosted ? `Boost retiré pour ${who}` : `Boost activé pour ${who}`
                        )}
                        title={r.requested.isActiveForCalls ? "Forcer ce réglage (administrateur)" : "Activez d'abord les appels entrants"}
                        className={`btn text-xs py-1 px-2.5 min-w-[80px] justify-center disabled:opacity-40 disabled:cursor-not-allowed ${r.requested.isBoosted ? "btn-primary" : "btn-secondary"}`}
                      >
                        ⚡ {r.requested.isBoosted ? "Actif" : "Inactif"}
                      </button>
                    </td>

                    {/* Sur le standard — what still has to be done. */}
                    <td className="table-td">
                      {pending ? (
                        <div className="flex flex-col gap-1 items-start">
                          {r.pending.activation === "ACTIVER" && <span className="badge badge-green" style={{ fontSize: "10px", padding: "2px 7px" }}>À activer sur le standard</span>}
                          {r.pending.activation === "COUPER"  && <span className="badge badge-red"   style={{ fontSize: "10px", padding: "2px 7px" }}>À couper sur le standard</span>}
                          {r.pending.boost === "BOOSTER"      && <span className="badge badge-amber" style={{ fontSize: "10px", padding: "2px 7px" }}>⚡ À booster</span>}
                          {r.pending.boost === "RETIRER"      && <span className="badge badge-gray"  style={{ fontSize: "10px", padding: "2px 7px" }}>Retirer le boost</span>}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          ✓ Appliqué{r.appliedAt ? ` · ${timeAgo(r.appliedAt, serverNow)}` : ""}
                        </span>
                      )}
                    </td>

                    <td className="table-td text-xs text-slate-500">
                      {r.requestedAt ? (
                        <>
                          <p>{timeAgo(r.requestedAt, serverNow)}</p>
                          {r.requestedBy && (
                            <p className="text-slate-400">
                              par {r.requestedBy.prenom} {r.requestedBy.nom}
                              {r.requestedBy.role === "ADMINISTRATEUR" ? " (admin)" : r.requestedBy.role === "SUPERVISEUR" ? " (coach)" : ""}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    <td className="table-td text-right">
                      {pending ? (
                        <button
                          onClick={() => applyOne(r)}
                          disabled={rowBusy}
                          title="Confirmer que ce changement a été fait sur le standard"
                          className="btn btn-primary text-xs py-1 px-2.5 whitespace-nowrap disabled:opacity-40"
                        >
                          ✓ Marquer appliqué
                        </button>
                      ) : (
                        <span className="text-slate-200">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        « Marquer appliqué » enregistre que le changement a été fait sur le standard : l&apos;application ne
        pilote pas Keyyo elle-même. Le tableau se rafraîchit toutes les {POLL_MS / 1000} s.
      </p>
    </div>
  );
}
