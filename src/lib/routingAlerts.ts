"use client";
// src/lib/routingAlerts.ts
//
// Keeps the sidebar badge and the Demandes de routage page in step without a
// shared store: whoever learns a newer unread count (a poll, a "marquer lu")
// announces it, and the others listen.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { usePolling } from "@/lib/usePolling";
import type { RoutingNotification } from "@/lib/routingEvents";

const UNREAD_EVENT = "assurpilot:routing-unread";
export const ROUTING_PAGE = "/admin/demandes-routage";
const SIDEBAR_POLL_MS = 10_000;
const SEEN_KEY = "assurpilot:routing-alerts-seen";

export function announceUnread(count: number): void {
  window.dispatchEvent(new CustomEvent<number>(UNREAD_EVENT, { detail: count }));
}

export function onUnread(listener: (count: number) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<number>).detail);
  window.addEventListener(UNREAD_EVENT, handler);
  return () => window.removeEventListener(UNREAD_EVENT, handler);
}

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>): void {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    /* private window: alerts may repeat after a reload, nothing worse */
  }
}

/**
 * For the sidebar, on every admin page: the unread count for the badge, and an
 * alert toast for each new coach action — except on the routing page itself,
 * which shows its own. Each alert is raised once per browser tab session.
 */
export function useRoutingAlerts(enabled: boolean): number {
  const toast = useToast();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const busy = useRef(false);

  const poll = async () => {
    if (!enabled || busy.current) return;
    busy.current = true;
    try {
      const res = await fetch("/api/admin/routing-notifications?unread=1&limit=10", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: RoutingNotification[]; unread: number };
      setUnread(data.unread);

      // Re-read each time: the routing page records what it has already shown.
      seen.current = new Set([...(seen.current ?? []), ...readSeen()]);
      const fresh = data.notifications.filter((n) => !seen.current!.has(n.id));
      fresh.forEach((n) => seen.current!.add(n.id));
      if (fresh.length) writeSeen(seen.current);

      if (fresh.length && !pathname?.startsWith(ROUTING_PAGE)) {
        // Oldest first, and at most three: the toast stack is for noticing, the page is for reading.
        for (const n of fresh.slice(0, 3).reverse()) toast.alert(n.message);
        if (fresh.length > 3) toast.alert(`… et ${fresh.length - 3} autre(s) action(s) de coach dans « Demandes de routage »`);
      }
    } catch {
      /* the badge simply keeps its last value */
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (!enabled) return;
    void poll();
    return onUnread(setUnread);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(poll, SIDEBAR_POLL_MS, enabled);

  return unread;
}

/** Marks ids as already alerted, so the sidebar does not raise what the page has shown. */
export function markAlerted(ids: string[]): void {
  const seenIds = readSeen();
  ids.forEach((id) => seenIds.add(id));
  writeSeen(seenIds);
}
