"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `fn` every `intervalMs` while the tab is visible, and once immediately
 * when the tab becomes visible again.
 *
 * This is how two screens stay in step without a push channel: the app runs on
 * serverless functions, which cannot hold a WebSocket or an event stream open,
 * so "real time" here is a short poll. Pausing while the tab is hidden means a
 * forgotten background tab does not hammer the API all night, and refreshing on
 * return means coming back to the tab never shows stale data for a full
 * interval.
 *
 * The callback is read through a ref, so a parent that re-renders (and builds a
 * new closure) does not tear down and restart the timer each time. Overlapping
 * runs are the callback's own business — it should ignore a call while one is
 * already in flight.
 */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });

  useEffect(() => {
    if (!enabled) return;

    const run = () => {
      if (document.visibilityState === "visible") void latest.current();
    };

    const timer = setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [intervalMs, enabled]);
}
