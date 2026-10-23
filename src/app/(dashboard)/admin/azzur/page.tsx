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
type RouteRow = { key: string; label: string; configured: boolean; kind: "mer" | "template" | null; origin: "base" | "env" | null; target: string | null; why: string | null };
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

  const [creating, setCreating] = useState(false);
  async function createTable() {
    if (!window.confirm("Créer la table azzur_routes dans la base de l'application ?\n\nOpération sans risque : elle ajoute seulement cette table (liens et interrupteurs AZZUR), rien n'est modifié ni effacé.")) return;
    setCreating(true);
    try {
      await fetchJson("/api/admin/azzur/setup", { method: "POST" });
      await Promise.all([loadRoutes(), loadStatus()]);
      toast.success("Table azzur_routes prête : vous pouvez enregistrer les liens et utiliser les interrupteurs.");
    } catch (e) {
      toast.error(errorMessage(e, "Création impossible."));
    } finally { setCreating(false); }
  }

  async function changeSwitch(name: "autoPush" | "enabled", next: boolean) {
    if (switching) return;
    if (name === "autoPush" && next && !window.confirm(
      "Activer les envois automatiques ?\n\nAprès chaque import Excel, les appels seront envoyés tout seuls vers le CRM de leur " +
      "catégorie (un numéro = une fiche, au premier conseiller qui l'a reçu), et un appel saisi à la main dès son " +
      "enregistrement. Seules les catégories dont le lien est configuré envoient.")) return;
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
                ? "Après chaque import Excel, les fiches partent toutes seules vers le CRM de leur catégorie (la page d'import affiche le résultat) ; un appel saisi à la main part dès son enregistrement."
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
          restent enregistrés en local et ne sont envoyés nulle part. Deux formes de lien :
        </p>
        <ul className="text-xs text-slate-500 mb-3 list-disc pl-5 space-y-0.5">
          <li><b>AZZUR MER</b> : l&apos;URL complète, avec <span className="font-mono">id_prov</span> et <span className="font-mono">cle_ws</span>.</li>
          <li>
            <b>Script fournisseur</b> (ProAssur, ALM…) : l&apos;URL avec des variables, remplacées pour chaque appel, par ex.{" "}
            <span className="font-mono break-all">https://gestion-proassur.fr/leads_cpa/FournisseurA8003/A4.php?TelGsmTxt=$telephone&amp;Conseiller=$conseiller</span>.
            Variables : <span className="font-mono">$telephone</span> (obligatoire), <span className="font-mono">$conseiller</span>,{" "}
            <span className="font-mono">$conseiller_email</span>, <span className="font-mono">$date</span>, <span className="font-mono">$ligne</span>,{" "}
            <span className="font-mono">$commentaire</span>, <span className="font-mono">$nom</span>, <span className="font-mono">$prenom</span>,{" "}
            <span className="font-mono">$id</span>. Seuls ces paramètres sont envoyés, en GET.
          </li>
        </ul>
        {routesInfo && !routesInfo.tableAvailable && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[240px]">{routesInfo.migrationHint}</span>
            <button className="btn-primary" disabled={creating} onClick={createTable}>
              {creating ? "Création…" : "Créer la table maintenant"}
            </button>
          </div>
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
                  placeholder={r.configured ? "Lien défini : saisir une nouvelle valeur pour le remplacer" : "URL MER (…ws=mer&id_prov=…&cle_ws=…) ou script fournisseur (…A4.php?TelGsmTxt=$telephone&Conseiller=$conseiller)"}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <p className="text-[11px] mt-1 text-slate-500">
                  {r.configured
                    ? <>{r.kind === "template" ? "Script fournisseur" : "Lien AZZUR MER"} : <span className="font-mono break-all">{r.target}</span>{r.kind === "template" ? "" : " (clé masquée)"}{r.origin === "env" ? " — défini par variable d'environnement" : ""}</>
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

      <AdvisersCrm reloadKey={routesInfo} />

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

type AdviserRow = {
  id: string; name: string; role: string; line: string; team: string | null;
  category: string | null; linkKind: "mer" | "template" | null; azzurId: string;
};

/**
 * Advisers as the CRMs must know them. AZZUR (MER) only files a fiche under an adviser through
 * its own numeric user id (id_user), so each adviser of an AZZUR link needs that number once;
 * supplier scripts (ProAssur…) receive the name as it is in Assurpilot. Names are never edited here.
 */
function AdvisersCrm({ reloadKey }: { reloadKey: unknown }) {
  const toast = useToast();
  const [rows, setRows] = useState<AdviserRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    try { setRows((await fetchJson<{ advisers: AdviserRow[] }>("/api/admin/azzur/users")).advisers); }
    catch (e) { toast.error(errorMessage(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  async function save(row: AdviserRow) {
    const value = (drafts[row.id] ?? row.azzurId).trim();
    setSaving(row.id);
    try {
      await fetchJson("/api/admin/azzur/users", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: row.id, azzurId: value }),
      });
      setDrafts((d) => { const n = { ...d }; delete n[row.id]; return n; });
      await load();
      toast.success(value ? `${row.name} : id AZZUR ${value} enregistré.` : `${row.name} : id AZZUR effacé.`);
    } catch (e) { toast.error(errorMessage(e, "Enregistrement impossible.")); }
    finally { setSaving(""); }
  }

  const needsId = (r: AdviserRow) => r.linkKind === "mer";
  const missing = (rows ?? []).filter((r) => needsId(r) && !r.azzurId);
  const noTeam = (rows ?? []).filter((r) => !r.category);

  return (
    <div className="card p-4 mb-5">
      <h2 className="text-sm font-semibold text-slate-800 mb-1">Conseillers dans les CRM</h2>
      <p className="text-xs text-slate-500 mb-3">
        Les noms restent exactement ceux d&apos;Assurpilot. <b>ProAssur</b> (script fournisseur) reçoit le nom tel quel
        (<span className="font-mono">$conseiller</span>). <b>AZZUR</b> ne reconnaît pas les noms : il range la fiche chez le conseiller
        grâce à <b>son numéro d&apos;utilisateur AZZUR</b> (id_user), à saisir une fois ci-dessous. Sans numéro, la fiche arrive chez
        l&apos;utilisateur par défaut d&apos;AZZUR.
      </p>
      {missing.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {missing.length} conseiller(s) d&apos;un lien AZZUR sans id AZZUR : leurs fiches n&apos;arriveront pas dans leur espace.
        </div>
      )}
      {noTeam.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {noTeam.length} conseiller(s) sans équipe ALM/CPA Auto/Santé ({noTeam.slice(0, 4).map((r) => r.name).join(", ")}{noTeam.length > 4 ? "…" : ""}) :
          leurs appels ne peuvent être envoyés à aucun CRM. Donnez-leur une équipe dans Utilisateurs.
        </div>
      )}
      {!rows ? <p className="text-sm text-slate-400">Chargement…</p> : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full" style={{ minWidth: "760px" }}>
            <thead className="bg-slate-50/70 border-b border-slate-100 sticky top-0">
              <tr>
                <th className="table-th">Conseiller</th>
                <th className="table-th">Ligne</th>
                <th className="table-th">Équipe</th>
                <th className="table-th">Lien</th>
                <th className="table-th">Dans le CRM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="table-td whitespace-nowrap">{r.name}{r.role === "SUPERVISEUR" && <span className="ml-1 text-[10px] text-slate-400">(coach)</span>}</td>
                  <td className="table-td font-mono text-xs">{r.line || "—"}</td>
                  <td className="table-td text-xs">{r.team ?? <span className="text-amber-700">aucune</span>}</td>
                  <td className="table-td text-xs whitespace-nowrap">{r.category ?? "—"}</td>
                  <td className="table-td text-xs">
                    {r.linkKind === "template" ? (
                      <>Script fournisseur : nom envoyé « <b>{r.name}</b> »</>
                    ) : !r.category ? (
                      <span className="text-slate-400">—</span>
                    ) : r.linkKind === null && !r.category.startsWith("SANTÉ") ? (
                      <span className="text-slate-400">Lien non configuré</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap">id AZZUR</span>
                        <input
                          inputMode="numeric" value={drafts[r.id] ?? r.azzurId} placeholder="ex. 123"
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                          className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono"
                        />
                        <button className="btn-secondary" disabled={saving === r.id || (drafts[r.id] ?? r.azzurId) === r.azzurId}
                          onClick={() => save(r)}>{saving === r.id ? "…" : "Enregistrer"}</button>
                        {r.linkKind === null && <span className="text-[10px] text-slate-400">(lien non configuré)</span>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
