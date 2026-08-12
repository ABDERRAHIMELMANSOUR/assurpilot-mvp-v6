"use client";
import { useState } from "react";

interface Props {
  /** Query string (with leading "?") describing the currently applied filters. */
  query: string;
  label?: string;
}

/**
 * Downloads the call log as .xlsx for exactly the filters on screen.
 *
 * The file is fetched rather than linked so a failure surfaces as a message
 * instead of navigating the browser to a JSON error page.
 */
export default function ExportCallsButton({ query, label = "Exporter en Excel" }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/calls/export" + query);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }

      const blob = await res.blob();
      const name =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "appels.xlsx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick so the click has certainly been handled.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'export a échoué.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button onClick={download} disabled={busy} className="btn btn-secondary text-xs disabled:opacity-50">
        {busy ? "Export..." : `↓ ${label}`}
      </button>
      {error && <span className="text-xs text-red-600 mt-1">{error}</span>}
    </span>
  );
}
