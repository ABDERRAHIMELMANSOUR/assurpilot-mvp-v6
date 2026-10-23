"use client";

// AZZUR integration: settings, the four links per team and product, and the
// review-then-send workflow (components/ui/AzzurReview.tsx). Logic in src/lib/azzur*.ts.
import { useCallback, useEffect, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import AzzurReview from "@/components/ui/AzzurReview";
import { useToast } from "@/components/ui/Toast";

type Result = { route?: string; reference: string; outcome: "sent" | "duplicate" | "skipped" | "failed"; status?: number; attempts?: number; detail: string; at: string };
type Status = {
  enabled: boolean; ready: boolean; problem: string | null;
  referenceHost: string | null; autoPush: boolean; linksConfigured: number;
  switchSource: { enabled: "base" | "env"; autoPush: "base" | "env" }; tableAvailable: boolean; migrationHint: string | null;
  method: string; format: string; fields: Record<string, string>; provenance: string; placeholders: Record<string, string>; mappedAdvisers: number; defaultUserId: string | null;
  timeoutMs: number; maxAgeHours: number; onlyAnswered: boolean; recent: Result[];
};
type RouteRow = { key: string; label: string; configured: boolean; origin: "base" | "env" | null; target: string | null; why: string | null };
type RoutesInfo = { tableAvailable: boolean; migrationHint: string | null; allowedHosts: string[]; routes: RouteRow[] };

const BADGE: Record<Result["outcome"], string> = { sent: "badge-green", duplicate: "badge-yellow", failed: "badge-red", skipped: "badge-gray" };

/** An on/off switch with its state spelled out: GREEN badge when on, GRAY when off. */
function Switch({ label, hint, on, busy, onChange }: {
  label: string; hint: string; on: boolean; busy: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy}
        onClick={() => onChange(!on)}
        className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60 ${on ? "bg-emerald-500" : "bg-slate-300"}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
      <div>
        <p className="text-sm font-semibold text-slate-800">
          {label}{" "}
          <span className={`badge ${on ? "badge-green" : "badge-gray"}`}>{busy ? "…" : on ? "Activés" : "Désactivés"}</span>
        </p>
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
      </div>
    </div>
  );
}

export default function AzzurPage() {
  const toast = useToast();
  const [switching, setSwitching] = useState<"" | "autoPush" | "enabled">("");
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

  async function saveRoute(key: string, label: string, value: string) {
    setSavingKey(key);
    try {
      await fetchJson("/api/admin/azzur/routes", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }),
      });
      setDrafts((d) => { const next = { ...d }; delete next[key]; return next; });
      await Promise.all([loadRoutes(), loadStatus()]);
      toast.success(value ? `Lien ${label} enregistré : les appels de cette catégorie pourront être envoyés.` : `Lien ${label} supprimé : ses appels restent en local.`);
    } catch (e) {
      // The table-missing case arrives as a 503 carrying the "run 009" message; validation
      // refusals (bad host, masked key…) arrive as 400s with their own explanation.
      toast.error(errorMessage(e, "Enregistrement impossible."));
    } finally { setSavingKey(""); }
  }

  async function changeSwitch(name: "autoPush" | "enabled", next: boolean) {
    if (switching) return;
    if (name === "autoPush" && next && !window.confirm(
      "Activer les envois automatiques ?\n\nUn appel saisi à la main sera envoyé vers AZZUR dès son enregistrement " +
      "(seulement si le lien de sa catégorie est configuré). Les imports Excel passent toujours par la vérification.")) return;
    setSwitching(name);
    try {
      await fetchJson("/api/admin/azzur/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [name]: next }),
      });
      await loadStatus();
      toast.success(name === "autoPush"
        ? (next ? "Envois automatiques activés." : "Envois automatiques désactivés : les appels restent en local.")
        : (next ? "Envoi AZZUR activé." : "Envoi AZZUR désactivé : plus rien n'est envoyé."));
    } catch (e) {
      toast.error(errorMessage(e, "Réglage impossible."));
    } finally { setSwitching(""); }
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
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Envois vers AZZUR</h2>
        {!status ? <p className="text-sm text-slate-400">Chargement…</p> : (
          <div className="space-y-4">
            <Switch
              label="Envois automatiques"
              on={status.autoPush}
              busy={switching === "autoPush"}
              onChange={(next) => changeSwitch("autoPush", next)}
              hint={status.autoPush
                ? "Un appel saisi à la main est envoyé dès son enregistrement. Les imports Excel passent toujours par la vérification ci-dessous."
                : "Les appels restent enregistrés en local ; l'envoi se fait à la demande, depuis la vérification ci-dessous."}
            />
            <Switch
              label="Envoi AZZUR (interrupteur général)"
              on={status.enabled}
              busy={switching === "enabled"}
              onChange={(next) => changeSwitch("enabled", next)}
              hint={status.enabled
                ? "Les envois sont possibles (manuels depuis la vérification, et automatiques si activés). Une catégorie sans lien n'envoie jamais rien."
                : "Aucun envoi, même manuel. L'analyse des appels reste possible."}
            />
            <p className="text-[11px] text-slate-400">
              Appliqué immédiatement, sans redéploiement.
              {status.switchSource.autoPush === "env" || status.switchSource.enabled === "env"
                ? " Tant qu'un interrupteur n'a pas été utilisé ici, la valeur des variables d'environnement s'applique."
                : ""}
              {!status.tableAvailable ? " Pour enregistrer un réglage, la table azzur_routes doit exister (prisma/sql/009-azzur-routes.sql)." : ""}
            </p>
          </div>
        )}
      </div>

      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-2">Configuration</h2>
        {!status ? <p className="text-sm text-slate-400">Chargement…</p> : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
            <div><dt className="inline text-slate-400">Liens configurés : </dt>
              <dd className="inline"><span className={`badge ${status.linksConfigured === 4 ? "badge-green" : status.linksConfigured === 0 ? "badge-red" : "badge-yellow"}`}>{status.linksConfigured} / 4</span></dd></div>
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
          Il n&apos;y a <b>aucun lien par défaut</b> : tant qu&apos;un lien n&apos;est pas configuré, les appels de cette catégorie
          restent enregistrés en local et ne sont envoyés nulle part. Collez l&apos;URL MER complète (avec{" "}
          <span className="font-mono">id_prov</span> et <span className="font-mono">cle_ws</span>).
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
                  placeholder={r.configured ? "Lien défini : saisir une nouvelle valeur pour le remplacer" : "https://www.gestfiches.com/…/ws/index.php?ws=mer&id_prov=…&cle_ws=…"}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <p className="text-[11px] mt-1 text-slate-500">
                  {r.configured
                    ? <>Lien dédié : <span className="font-mono">{r.target}</span> (clé masquée){r.origin === "env" ? " — défini par variable d'environnement" : ""}</>
                    : <span className="text-amber-700">Non configuré : les appels de cette catégorie restent en local, rien n'est envoyé.</span>}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={!!savingKey || !(drafts[r.key] ?? "").trim()}
                  onClick={() => saveRoute(r.key, r.label, drafts[r.key])}>{savingKey === r.key ? "Enregistrement…" : "Enregistrer"}</button>
                {r.configured && r.origin === "base" && (
                  <button className="btn-secondary" disabled={!!savingKey}
                    onClick={() => { if (window.confirm(`Supprimer le lien ${r.label} ? Ses appels resteront en local et ne seront plus envoyés.`)) saveRoute(r.key, r.label, ""); }}>Effacer</button>
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
