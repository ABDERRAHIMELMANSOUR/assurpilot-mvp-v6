"use client";

// AZZUR integration: settings, the four links per team and product, and the
// review-then-send workflow (components/ui/AzzurReview.tsx). Logic in src/lib/azzur*.ts.
import { useCallback, useEffect, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import AzzurReview from "@/components/ui/AzzurReview";

type Result = { route?: string; reference: string; outcome: "sent" | "duplicate" | "skipped" | "failed"; status?: number; attempts?: number; detail: string; at: string };
type Status = {
  enabled: boolean; ready: boolean; problem: string | null;
  host: string | null; path: string | null; idProv: string | null;
  method: string; format: string; fields: Record<string, string>; provenance: string; placeholders: Record<string, string>; mappedAdvisers: number; defaultUserId: string | null;
  timeoutMs: number; maxAgeHours: number; onlyAnswered: boolean; recent: Result[];
};
type RouteRow = { key: string; label: string; configured: boolean; origin: "base" | "env" | null; target: string | null; why: string | null };
type RoutesInfo = { tableAvailable: boolean; migrationHint: string | null; main: string | null; routes: RouteRow[] };

const BADGE: Record<Result["outcome"], string> = { sent: "badge-green", duplicate: "badge-yellow", failed: "badge-red", skipped: "badge-gray" };

export default function AzzurPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [routesInfo, setRoutesInfo] = useState<RoutesInfo | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState("");
  const [doc, setDoc] = useState<{ text: string; chars: number; truncated: boolean } | null>(null);

  const loadStatus = useCallback(async () => {
    try { setStatus(await fetchJson<Status>("/api/admin/azzur")); setError(""); }
    catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const loadRoutes = useCallback(async () => {
    try { setRoutesInfo(await fetchJson<RoutesInfo>("/api/admin/azzur/routes")); }
    catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  async function saveRoute(key: string, value: string) {
    setSavingKey(key); setError("");
    try {
      await fetchJson("/api/admin/azzur/routes", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }),
      });
      setDrafts((d) => { const next = { ...d }; delete next[key]; return next; });
      await loadRoutes();
    } catch (e) { setError(errorMessage(e)); }
    finally { setSavingKey(""); }
  }

  async function loadDoc() {
    setBusy(true); setError("");
    try { setDoc(await fetchJson("/api/admin/azzur/doc")); }
    catch (e) { setError(errorMessage(e)); }
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
            {status.fields.provenance && (
              <div><dt className="inline text-slate-400">Provenance envoyée : </dt><dd className="inline font-mono">{status.provenance}</dd></div>
            )}
            <div className="sm:col-span-2"><dt className="inline text-slate-400">Valeurs par défaut (données absentes d'un appel) : </dt>
              <dd className="inline font-mono text-xs">{Object.entries(status.placeholders).map(([k, v]) => `${k}=${v || "(vide)"}`).join("  ")}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-slate-400">Conseillers reliés à AZZUR (id_user) : </dt>
              <dd className="inline">{status.mappedAdvisers} · id_user par défaut : <span className="font-mono">{status.defaultUserId ?? "(utilisateur par défaut d'AZZUR)"}</span></dd></div>
            <div><dt className="inline text-slate-400">Appels plus vieux que : </dt><dd className="inline">{status.maxAgeHours} h ignorés</dd></div>
            <div><dt className="inline text-slate-400">Manqués : </dt><dd className="inline">{status.onlyAnswered ? "ignorés" : "envoyés"}</dd></div>
            {status.problem && <p className="sm:col-span-2 text-rose-600">{status.problem}</p>}
          </dl>
        )}
      </div>

      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Liens AZZUR par équipe et produit</h2>
        <p className="text-xs text-slate-500 mb-3">
          Chaque appel part vers le lien de l&apos;équipe et du produit de son conseiller (équipe ALM ou CPA, Auto ou Santé).
          Un lien non défini utilise le lien principal{routesInfo?.main ? <> (<span className="font-mono">{routesInfo.main}</span>)</> : ""}.
          Saisissez une URL MER complète (avec <span className="font-mono">id_prov</span> et <span className="font-mono">cle_ws</span>) ou seulement un id_prov.
        </p>
        {routesInfo && !routesInfo.tableAvailable && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{routesInfo.migrationHint}</div>
        )}
        <div className="space-y-3">
          {(routesInfo?.routes ?? []).map((r) => (
            <div key={r.key} className="grid grid-cols-1 md:grid-cols-[110px_1fr_auto] gap-2 md:items-start">
              <div className="text-sm font-semibold text-slate-700 pt-1.5">{r.label}</div>
              <div>
                <input
                  type="text" autoComplete="off" spellCheck={false}
                  value={drafts[r.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))}
                  placeholder={r.configured ? "Lien défini : saisir une nouvelle valeur pour le remplacer" : "https://…/ws/index.php?ws=mer&id_prov=…&cle_ws=…  ou  id_prov"}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <p className="text-[11px] mt-1 text-slate-500">
                  {r.configured
                    ? <>Lien dédié : <span className="font-mono">{r.target}</span> (clé masquée){r.origin === "env" ? " — défini par variable d'environnement" : ""}</>
                    : <>Par défaut : lien principal{r.target ? <> <span className="font-mono">{r.target}</span></> : ""}</>}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={!!savingKey || !(drafts[r.key] ?? "").trim() || !routesInfo?.tableAvailable}
                  onClick={() => saveRoute(r.key, drafts[r.key])}>{savingKey === r.key ? "…" : "Enregistrer"}</button>
                {r.configured && r.origin === "base" && (
                  <button className="btn-secondary" disabled={!!savingKey}
                    onClick={() => { if (window.confirm(`Revenir au lien principal pour ${r.label} ?`)) saveRoute(r.key, ""); }}>Effacer</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <AzzurReview ready={!!status?.ready} />

      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Documentation AZZUR (variables du web service)</h2>
        <p className="text-xs text-slate-500 mb-3">
          Lit la page de documentation du MER (celle de « Voir l&apos;URL »). Aucune donnée de contact n&apos;est envoyée, rien n&apos;est créé.
        </p>
        <div className="flex items-center gap-3">
          <button className="btn-secondary" disabled={busy || !status?.ready} onClick={loadDoc}>Lire la documentation</button>
          {doc && <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(doc.text)}>Copier le texte</button>}
          {doc && <span className="text-xs text-slate-400">{doc.chars.toLocaleString("fr-FR")} caractères{doc.truncated ? " (tronqué)" : ""}</span>}
        </div>
        {doc && <pre className="mt-3 bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs whitespace-pre-wrap break-words max-h-96 overflow-y-auto">{doc.text}</pre>}
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
        <thead><tr><th className="table-th">Heure</th><th className="table-th">Lien</th><th className="table-th">Résultat</th><th className="table-th">HTTP</th><th className="table-th">Essais</th><th className="table-th">Réponse AZZUR / détail</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={`${r.reference}-${i}`}>
              <td className="table-td whitespace-nowrap">{new Date(r.at).toLocaleTimeString("fr-FR")}</td>
              <td className="table-td whitespace-nowrap text-xs">{r.route ?? "—"}</td>
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
