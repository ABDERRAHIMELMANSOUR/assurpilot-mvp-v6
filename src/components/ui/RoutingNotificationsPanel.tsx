"use client";
// The coach-action alerts on /admin/demandes-routage: every switch a coach flips,
// every adviser they create, edit or deactivate, live (polled with the table) and
// kept as a history. Unread entries stand out until an administrator marks them
// read; a new one also raises an alert toast and is highlighted for a moment.
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { usePolling } from "@/lib/usePolling";
import { announceUnread, markAlerted } from "@/lib/routingAlerts";
import {
  ROUTING_EVENT_LABEL,
  ROUTING_EVENT_TONE,
  type RoutingNotification,
} from "@/lib/routingEvents";

const POLL_MS = 5_000;
const HISTORY_LIMIT = 100;
const FLASH_MS = 6_000;
/** Entries shown before "Afficher plus". */
const PAGE = 8;

type Feed = {
  notifications: RoutingNotification[];
  unread: number;
  tableAvailable: boolean;
  hint?: string;
  serverTime: string;
};

type View = "unread" | "all";

const DOT: Record<string, string> = {
  green: "bg-emerald-500",
  red: "bg-rose-500",
  amber: "bg-amber-500",
  gray: "bg-slate-400",
  blue: "bg-cyan-500",
};

interface Props {
  /** "il y a 2 min", measured on the page's server-corrected clock. */
  formatAge: (iso: string) => string;
  /** Narrows the table below to one adviser. */
  onShowAdviser: (name: string) => void;
}

export default function RoutingNotificationsPanel({ formatAge, onShowAdviser }: Props) {
  const toast = useToast();
  const [items, setItems] = useState<RoutingNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [hint, setHint] = useState("");
  const [view, setView] = useState<View>("unread");
  const [expanded, setExpanded] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);

  const known = useRef<Set<string> | null>(null);
  const busy = useRef(false);
  // Bumped on each "marquer lu", so a poll that started before it cannot bring the
  // entries back as unread.
  const epoch = useRef(0);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const startedAt = epoch.current;
    try {
      const feed = await fetchJson<Feed>(`/api/admin/routing-notifications?limit=${HISTORY_LIMIT}`);
      if (epoch.current !== startedAt) return;
      setHint(feed.tableAvailable ? "" : feed.hint ?? "");
      setItems(feed.notifications);
      setUnread(feed.unread);
      announceUnread(feed.unread);

      // New since the last poll: alert, highlight. Not on the first load — those
      // are shown as unread entries, not as a burst of toasts.
      const ids = feed.notifications.map((n) => n.id);
      if (known.current) {
        const fresh = feed.notifications.filter((n) => !known.current!.has(n.id) && !n.readAt);
        if (fresh.length) {
          for (const n of fresh.slice(0, 3).reverse()) toast.alert(n.message);
          if (fresh.length > 3) toast.alert(`… et ${fresh.length - 3} autre(s) action(s) de coach`);
          const freshIds = fresh.map((n) => n.id);
          setFlash((f) => new Set([...f, ...freshIds]));
          setTimeout(() => setFlash((f) => {
            const next = new Set(f);
            freshIds.forEach((id) => next.delete(id));
            return next;
          }), FLASH_MS);
        }
      }
      known.current = new Set(ids);
      // What this page has shown, the sidebar need not raise again.
      markAlerted(ids);
      setLoaded(true);
    } catch {
      // A failed refresh keeps the last list; the table above reports the connection.
    } finally {
      busy.current = false;
    }
  }, [toast]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, POLL_MS);

  // The tab title carries the count, so an alert is visible from another tab.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
    return () => { document.title = document.title.replace(/^\(\d+\+?\)\s*/, ""); };
  }, [unread]);

  async function markRead(target: { ids: string[] } | { all: true }) {
    if (marking) return;
    setMarking(true);
    try {
      const res = await fetchJson<{ marked: number; unread: number }>("/api/admin/routing-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      epoch.current++;
      const now = new Date().toISOString();
      const ids = "ids" in target ? new Set(target.ids) : null;
      setItems((list) => list.map((n) => (!n.readAt && (!ids || ids.has(n.id)) ? { ...n, readAt: now } : n)));
      setUnread(res.unread);
      announceUnread(res.unread);
    } catch (err) {
      toast.error(errorMessage(err, "Impossible de marquer comme lu"));
    } finally {
      setMarking(false);
    }
  }

  const listed = view === "unread" ? items.filter((n) => !n.readAt) : items;
  const shown = expanded ? listed : listed.slice(0, PAGE);

  return (
    <section
      className={`card mb-5 overflow-hidden ${unread > 0 ? "ring-2 ring-amber-300" : ""}`}
      aria-labelledby="coach-actions-title"
    >
      <div className={`flex flex-wrap items-center gap-2 px-4 py-3 border-b ${unread > 0 ? "bg-amber-50 border-amber-200" : "border-slate-100"}`}>
        <span className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full ${unread > 0 ? "bg-amber-400 text-navy-950" : "bg-slate-100 text-slate-500"}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping" />}
        </span>
        <div className="mr-auto">
          <h2 id="coach-actions-title" className="text-sm font-semibold text-slate-900">
            Actions des coachs
            {unread > 0 && (
              <span className="ml-2 badge badge-amber" style={{ fontSize: "11px", padding: "1px 8px" }}>
                {unread} non lue{unread > 1 ? "s" : ""}
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500">
            {unread > 0
              ? "Un coach a modifié le routage ou un conseiller : vérifiez et appliquez sur le standard."
              : "Chaque activation, coupure, boost ou modification de conseiller par un coach s'affiche ici en direct."}
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 text-xs" role="tablist" aria-label="Affichage">
          {(["unread", "all"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => { setView(v); setExpanded(false); }}
              className={`px-2.5 py-1 rounded-lg ${view === v ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {v === "unread" ? `Non lues (${unread})` : "Historique"}
            </button>
          ))}
        </div>
        <button
          onClick={() => markRead({ all: true })}
          disabled={!unread || marking}
          className="btn btn-secondary text-xs disabled:opacity-40"
        >
          ✓ Tout marquer comme lu
        </button>
      </div>

      {hint && <div className="px-4 py-2.5 text-xs text-rose-700 bg-rose-50 border-b border-rose-200">{hint}</div>}

      <ul className="divide-y divide-slate-100" aria-live="polite">
        {!loaded && !hint && <li className="px-4 py-4 text-xs text-slate-400 animate-pulse">Chargement…</li>}
        {loaded && listed.length === 0 && (
          <li className="px-4 py-4 text-xs text-slate-400">
            {view === "unread" ? "Aucune nouvelle action de coach." : "Aucune action enregistrée pour l'instant."}
          </li>
        )}
        {shown.map((n) => {
          const isUnread = !n.readAt;
          const tone = ROUTING_EVENT_TONE[n.kind];
          return (
            <li
              key={n.id}
              className={`flex items-start gap-3 px-4 py-2.5 transition-colors ${
                flash.has(n.id) ? "bg-amber-100" : isUnread ? "bg-amber-50/60" : ""
              }`}
            >
              <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${DOT[tone]} ${isUnread ? "" : "opacity-40"}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${isUnread ? "font-medium text-slate-900" : "text-slate-600"}`}>{n.message}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                  <span className={`badge badge-${tone}`} style={{ fontSize: "10px", padding: "1px 7px" }}>
                    {ROUTING_EVENT_LABEL[n.kind]}
                  </span>
                  <span title={new Date(n.createdAt).toLocaleString("fr-FR")}>{formatAge(n.createdAt)}</span>
                  {n.actorRole === "ADMINISTRATEUR" && <span>· action admin</span>}
                  {!isUnread && n.actorRole !== "ADMINISTRATEUR" && <span>· lu</span>}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                {n.adviserName && (
                  <button onClick={() => onShowAdviser(n.adviserName!)} className="btn btn-secondary text-xs py-1 px-2" title="Afficher ce conseiller dans le tableau">
                    Voir
                  </button>
                )}
                {isUnread && (
                  <button
                    onClick={() => markRead({ ids: [n.id] })}
                    disabled={marking}
                    className="btn btn-secondary text-xs py-1 px-2 disabled:opacity-40"
                    title="Marquer comme lu"
                  >
                    ✓ Lu
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {listed.length > PAGE && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full border-t border-slate-100 px-4 py-2 text-xs text-brand-600 hover:bg-slate-50"
        >
          {expanded ? "Réduire" : `Afficher les ${listed.length - PAGE} autre(s)`}
        </button>
      )}
    </section>
  );
}
