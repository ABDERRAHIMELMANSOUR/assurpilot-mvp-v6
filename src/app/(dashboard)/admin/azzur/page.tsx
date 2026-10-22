"use client";

// Status of the AZZUR push and a controlled test: preview, then send today's
// calls (a few at first) and read AZZUR's answers. The logic is in
// src/lib/azzur.ts and /api/admin/azzur.
import { useCallback, useEffect, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";

type Result = { reference: string; outcome: "sent" | "duplicate" | "skipped" | "failed"; status?: number; attempts?: number; detail: string; at: string };
type Status = {
  enabled: boolean; ready: boolean; problem: string | null;
  host: string | null; path: string | null; idProv: string | null;
  method: string; format: string; fields: Record<string, string>; provenance: string; placeholders: Record<string, string>;
  timeoutMs: number; maxAgeHours: number; onlyAnswered: boolean; recent: Result[];
};
type Resend = {
  mode: "preview" | "send"; callsToday: number; selected: number; limit: number;
  target: { host?: string; idProv?: string | null; method: string; format: string };
  payloads?: Record<string, string>[];
  sent?: number; duplicates?: number; failed?: number; skipped?: number; results?: Result[];
};

const BADGE: Record<Result["outcome"], string> = { sent: "badge-green", duplicate: "badge-yellow", failed: "badge-red", skipped: "badge-gray" };

export default function AzzurPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [out, setOut] = useState<Resend | null>(null);
  const [limit, setLimit] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    try { setStatus(await fetchJson<Status>("/api/admin/azzur")); setError(""); }
    catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function run(mode: "preview" | "send") {
    if (mode === "send" && !window.confirm(
      `Envoyer ${limit} appel(s) d'AUJOURD'HUI à AZZUR ? Les fiches seront réellement créées dans le CRM ` +
      `(un appel déjà transmis à sa création sera envoyé une 2e fois).`)) return;
    setBusy(true); setError("");
    try {
      setOut(await fetchJson<Resend>("/api/admin/azzur/resend", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, limit }),
      }));
      if (mode === "send") loadStatus();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-slate-900">Intégration AZZUR</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-5">État de l&apos;envoi des appels vers le CRM et test sur les appels du jour.</p>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-2">Configuration</h2>
        {!status ? <p className="text-sm text-slate-400">Chargement…</p> : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
            <div><dt className="inline text-slate-400">AZZUR_WEBHOOK_ENABLED : </dt>
              <dd className="inline"><span className={`badge ${status.enabled ? "badge-green" : "badge-red"}`}>{status.enabled ? "true" : "false"}</span></dd></div>
            <div><dt className="inline text-slate-400">AZZUR_MER_URL : </dt>
              <dd className="inline">{status.host ? <span className="font-mono">{status.host}{status.path} (id_prov={status.idProv})</span> : <span className="badge badge-red">non défini</span>}</dd></div>
            <div><dt className="inline text-slate-400">Prêt à envoyer : </dt>
              <dd className="inline"><span className={`badge ${status.ready ? "badge-green" : "badge-red"}`}>{status.ready ? "oui" : "non"}</span></dd></div>
            <div><dt className="inline text-slate-400">Requête : </dt><dd className="inline font-mono">{status.method} {status.format}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-slate-400">Champs : </dt>
              <dd className="inline font-mono text-xs">{Object.entries(status.fields).map(([k, v]) => `${k}→${v || "(désactivé)"}`).join("  ")}</dd></div>
            <div><dt className="inline text-slate-400">Provenance envoyée : </dt><dd className="inline font-mono">{status.provenance}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-slate-400">Valeurs par défaut (données absentes d'un appel) : </dt>
              <dd className="inline font-mono text-xs">{Object.entries(status.placeholders).map(([k, v]) => `${k}=${v || "(vide)"}`).join("  ")}</dd></div>
            <div><dt className="inline text-slate-400">Appels plus vieux que : </dt><dd className="inline">{status.maxAgeHours} h ignorés</dd></div>
            <div><dt className="inline text-slate-400">Manqués : </dt><dd className="inline">{status.onlyAnswered ? "ignorés" : "envoyés"}</dd></div>
            {status.problem && <p className="sm:col-span-2 text-rose-600">{status.problem}</p>}
          </dl>
        )}
      </div>

      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Test : appels d&apos;aujourd&apos;hui</h2>
        <p className="text-xs text-slate-500 mb-3">
          Seuls les appels du jour (heure de Paris) sont concernés, du plus ancien au plus récent. Commencez par 1 appel.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-500">Nombre d&apos;appels
            <input type="number" min={1} max={200} value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              className="ml-2 w-20 px-2 py-1 border border-slate-200 rounded-lg text-sm" /></label>
          <button className="btn-secondary" disabled={busy || !status?.ready} onClick={() => run("preview")}>Aperçu (rien n&apos;est envoyé)</button>
          <button className="btn-primary" disabled={busy || !status?.ready} onClick={() => run("send")}>{busy ? "…" : "Envoyer à AZZUR"}</button>
        </div>

        {out && (
          <div className="mt-4 text-sm">
            <p className="text-slate-700">
              {out.callsToday} appel(s) aujourd&apos;hui, {out.selected} sélectionné(s) → {out.target.host} (id_prov={out.target.idProv}).
              {out.mode === "send" && <> Créés : <b>{out.sent}</b> · doublons : <b>{out.duplicates}</b> · échecs : <b>{out.failed}</b> · ignorés : <b>{out.skipped}</b></>}
            </p>
            {out.payloads && (
              <pre className="mt-2 bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs overflow-x-auto">{JSON.stringify(out.payloads, null, 2)}</pre>
            )}
            {out.results && <ResultTable rows={out.results} />}
          </div>
        )}
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-2">Derniers envois (cette instance du serveur)</h2>
        {status && status.recent.length === 0 ? <p className="text-sm text-slate-400">Aucun envoi enregistré depuis le dernier démarrage. Les logs Vercel (« [azzur] ») font foi.</p>
          : status && <ResultTable rows={status.recent} />}
      </div>
    </div>
  );
}

function ResultTable({ rows }: { rows: Result[] }) {
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full" style={{ minWidth: "640px" }}>
        <thead><tr><th className="table-th">Heure</th><th className="table-th">Résultat</th><th className="table-th">HTTP</th><th className="table-th">Essais</th><th className="table-th">Réponse AZZUR / détail</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={`${r.reference}-${i}`}>
              <td className="table-td whitespace-nowrap">{new Date(r.at).toLocaleTimeString("fr-FR")}</td>
              <td className="table-td"><span className={`badge ${BADGE[r.outcome]}`}>{r.outcome}</span></td>
              <td className="table-td">{r.status ?? "—"}</td>
              <td className="table-td">{r.attempts ?? "—"}</td>
              <td className="table-td font-mono text-xs break-all"><div className="max-h-72 overflow-y-auto min-w-[260px]">{r.detail}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
