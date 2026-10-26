"use client";
// src/lib/useResultLabels.ts
//
// value → label of the call result options, for the client-side counters that
// classify results with `resultKind` (contracts.ts). Empty until loaded; the
// stored value alone still classifies the usual codes in the meantime.
import { useEffect, useState } from "react";

export function useResultLabels(): Map<string, string> {
  const [labels, setLabels] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let alive = true;
    fetch("/api/call-result-options")
      .then((r) => (r.ok ? r.json() : []))
      .then((options: unknown) => {
        if (!alive || !Array.isArray(options)) return;
        setLabels(new Map(options.map((o: { value: string; label: string }) => [o.value, o.label])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return labels;
}
