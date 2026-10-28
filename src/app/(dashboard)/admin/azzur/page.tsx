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
    if (!window.confirm("Créer ou réparer la table azzur_routes ?\n\nSans risque : si une table de ce nom existe avec une autre forme, elle est mise de côté (renommée, rien n'est supprimé) et ses liens sont recopiés ; aucune autre table n'est touchée.")) return;
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
              <dd className="inline">{status.mappedAdvisers} · conseiller non identifié : <span className="font-mono">id_user par défaut de l&apos;espace, sinon 0 (fiche non attribuée)</span></dd></div>
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
              {creating ? "Réparation…" : "Créer / réparer la table"}
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

      <SendJournal reloadKey={status} />

    </div>
  );
}

type SendRow = {
  id: string; createdAt: string; reference: string; number: string; route: string | null; adviserName: string | null;
  idUser: string | null; idUserWhy: string | null; outcome: string; azzurFicheId: string | null; detail: string;
};

const OUTCOME_BADGE: Record<string, { text: string; cls: string }> = {
  sent: { text: "Fiche créée", cls: "badge-green" },
  duplicate: { text: "DOUBLON AZZUR", cls: "badge-amber" },
  failed: { text: "Échec", cls: "badge-red" },
};

/**
 * Every fiche actually sent, from the journal (azzur_sends), with the id_user that went in the
 * request and AZZUR's answer. A "DOUBLON" names the fiche AZZUR already had: AZZUR files the
 * duplicate under a user of its own choosing, whatever id_user says — the journal shows that the
 * request named the right adviser.
 */
function SendJournal({ reloadKey }: { reloadKey: unknown }) {
  const toast = useToast();
  const [rows, setRows] = useState<SendRow[] | null>(null);
  const [onlyDup, setOnlyDup] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await fetchJson<{ rows: SendRow[] }>("/api/admin/azzur/sends?limit=300")).rows); }
    catch (e) { toast.error(errorMessage(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);
  const shown = (rows ?? []).filter((r) => !onlyDup || r.outcome === "duplicate");
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold text-slate-800 mr-auto">Journal des envois</h2>
        <label className="text-xs text-slate-600 flex items-center gap-1">
          <input type="checkbox" checked={onlyDup} onChange={(e) => setOnlyDup(e.target.checked)} /> Doublons seulement
        </label>
        <button className="btn-secondary" onClick={load}>↻ Actualiser</button>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Chaque fiche envoyée, avec l&apos;<span className="font-mono">id_user</span> mis dans la requête et la réponse d&apos;AZZUR.
        « DOUBLON » : AZZUR avait déjà une fiche pour ce numéro (son n° est indiqué) ; il crée alors une fiche « Doublon Fiche »
        qu&apos;il attribue <b>selon ses propres règles de dédoublonnage</b>, quel que soit l&apos;id_user envoyé. Un numéro déjà
        envoyé n&apos;est plus renvoyé.
      </p>
      {!rows ? <p className="text-sm text-slate-400">Chargement…</p> : shown.length === 0 ? (
        <p className="text-sm text-slate-400">Aucun envoi journalisé pour l&apos;instant (le journal démarre avec cette version).</p>
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full" style={{ minWidth: "900px" }}>
            <thead className="bg-slate-50/70 border-b border-slate-100 sticky top-0">
              <tr>
                <th className="table-th">Date</th><th className="table-th">Numéro</th><th className="table-th">Lien</th>
                <th className="table-th">Conseiller (Assurpilot)</th><th className="table-th">id_user envoyé</th><th className="table-th">Réponse AZZUR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="table-td text-xs whitespace-nowrap">{new Date(r.createdAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                  <td className="table-td font-mono text-xs">{r.number}</td>
                  <td className="table-td text-xs">{r.route ?? "—"}</td>
                  <td className="table-td text-xs">{r.adviserName ?? <span className="text-slate-400">aucun</span>}</td>
                  <td className="table-td text-xs">
                    <span className="font-mono">{r.idUser ?? "—"}</span>
                    {r.idUserWhy && <span className="block text-[10px] text-slate-400">{r.idUserWhy}</span>}
                  </td>
                  <td className="table-td text-xs">
                    <span className={`badge ${OUTCOME_BADGE[r.outcome]?.cls ?? "badge-gray"}`} style={{ fontSize: "10px", padding: "1px 7px" }}>
                      {OUTCOME_BADGE[r.outcome]?.text ?? r.outcome}
                    </span>
                    {r.azzurFicheId && <span className="ml-1 font-mono">{r.outcome === "duplicate" ? `fiche existante ${r.azzurFicheId}` : `fiche ${r.azzurFicheId}`}</span>}
                    {r.outcome === "failed" && <span className="block text-[10px] text-rose-700">{r.detail.slice(0, 200)}</span>}
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

type AdviserRow = {
  id: string; name: string; role: string; line: string; team: string | null;
  category: string | null; linkKind: "mer" | "template" | null; azzurId: string;
  /** The id_user a fiche of this adviser carries, and why. */
  sentId: string; sentSource: "conseiller" | "defaut-espace" | "aucun"; sentWhy: string;
};
type DefaultRow = { key: string; label: string; linkKind: "mer" | "template" | null; azzurId: string };
type UsersInfo = { advisers: AdviserRow[]; defaults: DefaultRow[]; envDefault: string | null };

type Proposal = {
  azzur: { azzurId: string; nom: string; prenom: string; phones: string[]; email: string; etat: string; role: string };
  status: "match" | "deja" | "ambigu" | "a-verifier" | "autre-espace" | "aucun" | "desactive";
  reason: string | null;
  adviser: { id: string; name: string; team: string | null; currentAzzurId: string } | null;
  selected: boolean;
  note: string;
};
type ImportPreview = { space: "ALM" | "CPA" | null; rows: number; proposals: Proposal[]; unmatchedAdvisers: Array<{ id: string; name: string; team: string | null }> };

const STATUS_LABEL: Record<Proposal["status"], { text: string; cls: string }> = {
  match: { text: "Trouvé", cls: "badge-green" },
  deja: { text: "Déjà enregistré", cls: "badge-gray" },
  ambigu: { text: "Ambigu", cls: "badge-amber" },
  "a-verifier": { text: "À vérifier", cls: "badge-amber" },
  "autre-espace": { text: "Autre espace", cls: "badge-amber" },
  aucun: { text: "Pas dans Assurpilot", cls: "badge-gray" },
  desactive: { text: "Désactivé AZZUR", cls: "badge-gray" },
};
const REASON_LABEL: Record<string, string> = { email: "même email", nom: "même nom", ligne: "même ligne + nom", "ligne-seule": "même ligne seulement" };

function sentLabel(r: AdviserRow, defaults: DefaultRow[]): string {
  if (r.sentSource === "conseiller") return `id_user=${r.sentId} (le sien)`;
  if (r.sentSource === "defaut-espace") {
    const d = defaults.find((x) => x.label === r.category);
    return `id_user=${r.sentId} (défaut ${d?.label ?? "de l'espace"}) — ${r.sentWhy}`;
  }
  return `id_user=0, fiche non attribuée — ${r.sentWhy}`;
}

/**
 * Advisers as the CRMs must know them. AZZUR (MER) only files a fiche under an adviser through
 * its own numeric user id (id_user), so each adviser of an AZZUR link needs that number once —
 * typed in, or imported from AZZUR's user list — with a default per space for the others.
 * Supplier scripts (ProAssur…) receive the name as it is in Assurpilot. Names are never edited here.
 */
function AdvisersCrm({ reloadKey }: { reloadKey: unknown }) {
  const toast = useToast();
  const [info, setInfo] = useState<UsersInfo | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [defaultDrafts, setDefaultDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    try { setInfo(await fetchJson<UsersInfo>("/api/admin/azzur/users")); }
    catch (e) { toast.error(errorMessage(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  async function put(body: unknown) {
    await fetchJson("/api/admin/azzur/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async function save(row: AdviserRow) {
    const value = (drafts[row.id] ?? row.azzurId).trim();
    setSaving(row.id);
    try {
      await put({ userId: row.id, azzurId: value });
      setDrafts((d) => { const n = { ...d }; delete n[row.id]; return n; });
      await load();
      toast.success(value ? `${row.name} : id AZZUR ${value} enregistré.` : `${row.name} : id AZZUR effacé.`);
    } catch (e) { toast.error(errorMessage(e, "Enregistrement impossible.")); }
    finally { setSaving(""); }
  }

  async function saveDefault(row: DefaultRow) {
    const value = (defaultDrafts[row.key] ?? row.azzurId).trim();
    setSaving(`default:${row.key}`);
    try {
      await put({ defaultFor: row.key, azzurId: value });
      setDefaultDrafts((d) => { const n = { ...d }; delete n[row.key]; return n; });
      await load();
      toast.success(value ? `${row.label} : id_user par défaut ${value} enregistré.` : `${row.label} : id_user par défaut effacé.`);
    } catch (e) { toast.error(errorMessage(e, "Enregistrement impossible.")); }
    finally { setSaving(""); }
  }

  const rows = info?.advisers ?? null;
  const defaults = info?.defaults ?? [];
  const needsId = (r: AdviserRow) => r.linkKind === "mer";
  const missing = (rows ?? []).filter((r) => needsId(r) && !r.azzurId);
  const noTeam = (rows ?? []).filter((r) => !r.category);
  // Spaces that can take an id_user: AZZUR links, and the two Santé spaces even before their link is set.
  const defaultRows = defaults.filter((d) => d.linkKind === "mer" || (d.linkKind === null && d.key.startsWith("SANTE")));

  return (
    <div className="card p-4 mb-5">
      <h2 className="text-sm font-semibold text-slate-800 mb-1">Conseillers dans les CRM</h2>
      <p className="text-xs text-slate-500 mb-3">
        Les noms restent exactement ceux d&apos;Assurpilot. <b>ProAssur</b> (script fournisseur) reçoit le nom tel quel
        (<span className="font-mono">$conseiller</span>). <b>AZZUR</b> ne reconnaît pas les noms : chaque fiche Santé part avec{" "}
        <span className="font-mono">&amp;id_user=</span><b>l&apos;Id AZZUR du conseiller qui a pris l&apos;appel</b> (colonne « Id » de
        Administration › Utilisateurs dans AZZUR). Sans Id pour ce conseiller, c&apos;est l&apos;<b>id_user par défaut de l&apos;espace</b>{" "}
        ci-dessous qui est envoyé ; sans défaut non plus, <span className="font-mono">id_user=0</span> : la fiche n&apos;est attribuée à
        personne (jamais à l&apos;utilisateur par défaut du back-office AZZUR). Un Id n&apos;est envoyé que dans l&apos;espace de l&apos;équipe du
        conseiller (ALM ou CPA) : un conseiller sans équipe ALM/CPA part avec le défaut de l&apos;espace.
      </p>

      {defaultRows.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-700 mb-1">id_user par défaut, par espace AZZUR</p>
          <p className="text-[11px] text-slate-500 mb-2">
            Chaque espace AZZUR (ALM, CPA) numérote ses utilisateurs à part : un Id d&apos;un espace ne vaut rien dans l&apos;autre.
            {info?.envDefault ? <> Défaut général de l&apos;environnement (AZZUR_MER_ID_USER) : <span className="font-mono">{info.envDefault}</span>.</> : null}
          </p>
          <div className="flex flex-wrap gap-4">
            {defaultRows.map((d) => (
              <label key={d.key} className="flex items-center gap-2 text-xs">
                <span className="whitespace-nowrap font-medium">{d.label}</span>
                <input
                  inputMode="numeric" value={defaultDrafts[d.key] ?? d.azzurId} placeholder="ex. 2"
                  aria-label={`id_user par défaut ${d.label}`}
                  onChange={(e) => setDefaultDrafts((x) => ({ ...x, [d.key]: e.target.value }))}
                  className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono"
                />
                <button className="btn-secondary" disabled={saving === `default:${d.key}` || (defaultDrafts[d.key] ?? d.azzurId) === d.azzurId}
                  onClick={() => saveDefault(d)}>{saving === `default:${d.key}` ? "…" : "Enregistrer"}</button>
              </label>
            ))}
          </div>
        </div>
      )}

      <AzzurIdImport onSaved={load} />

      {missing.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {missing.length} conseiller(s) d&apos;un lien AZZUR sans Id AZZUR propre : leurs fiches partent avec l&apos;id_user par défaut de
          leur espace (ou id_user=0, non attribuée, s&apos;il n&apos;y en a pas), pas dans leur propre espace conseiller.
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
          <table className="w-full" style={{ minWidth: "860px" }}>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="whitespace-nowrap">Id AZZUR</span>
                        <input
                          inputMode="numeric" value={drafts[r.id] ?? r.azzurId} placeholder="ex. 147"
                          aria-label={`Id AZZUR de ${r.name}`}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                          className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono"
                        />
                        <button className="btn-secondary" disabled={saving === r.id || (drafts[r.id] ?? r.azzurId) === r.azzurId}
                          onClick={() => save(r)}>{saving === r.id ? "…" : "Enregistrer"}</button>
                        <span className={`text-[11px] ${r.sentSource === "conseiller" ? "text-emerald-700" : "text-amber-700"}`}>
                          → {sentLabel(r, defaults)}
                        </span>
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

/**
 * Fill the Ids from AZZUR's own user list: select the rows of Administration › Utilisateurs in
 * AZZUR, copy, paste here. Each AZZUR user is matched to an adviser by e-mail or name (the phone
 * only confirms: lines change hands); nothing is saved until the ticked rows are confirmed.
 */
function AzzurIdImport({ onSaved }: { onSaved: () => Promise<void> | void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [space, setSpace] = useState<"" | "ALM" | "CPA">("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  async function analyse() {
    setBusy(true);
    try {
      const p = await fetchJson<ImportPreview>("/api/admin/azzur/users/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, space: space || undefined }),
      });
      setPreview(p);
      setPicked(new Set(p.proposals.flatMap((x, i) => (x.selected ? [i] : []))));
      if (!space && p.space) setSpace(p.space);
    } catch (e) { toast.error(errorMessage(e, "Analyse impossible.")); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!preview) return;
    const assignments = [...picked].map((i) => preview.proposals[i]).filter((p) => p.adviser)
      .map((p) => ({ userId: p.adviser!.id, azzurId: p.azzur.azzurId }));
    const ids = assignments.map((a) => a.userId);
    if (new Set(ids).size !== ids.length) { toast.error("Un même conseiller est coché deux fois : n'en gardez qu'un."); return; }
    if (!assignments.length) return;
    setBusy(true);
    try {
      await fetchJson("/api/admin/azzur/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignments }) });
      toast.success(`${assignments.length} Id AZZUR enregistré(s).`);
      setPreview(null); setText(""); setPicked(new Set());
      await onSaved();
    } catch (e) { toast.error(errorMessage(e, "Enregistrement impossible.")); }
    finally { setBusy(false); }
  }

  const selectable = (p: Proposal) => !!p.adviser && p.status !== "deja";

  return (
    <div className="mb-4 rounded-xl border border-slate-200">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700">
        <span>Importer les Id depuis la liste des utilisateurs AZZUR</span><span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <p className="text-[11px] text-slate-500 mb-2">
            Dans AZZUR : Administration › Utilisateurs, sélectionnez les lignes du tableau (de la première à la dernière), copiez
            (Ctrl+C) et collez ici. Un import par espace (ALM puis CPA). Rien n&apos;est enregistré avant « Enregistrer la sélection ».
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="Liste des utilisateurs AZZUR"
            placeholder={"Editer Dupliquer\t147\tAlvar\tSoraya\t01 62 53 81 27\tsoraya.alvar@…\t…"}
            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={space} onChange={(e) => setSpace(e.target.value as "" | "ALM" | "CPA")} aria-label="Espace AZZUR"
              className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white">
              <option value="">Espace : détecter</option>
              <option value="ALM">Espace ALM (alm-assurances)</option>
              <option value="CPA">Espace CPA (cpa-assurances)</option>
            </select>
            <button className="btn-secondary" disabled={!text.trim() || busy} onClick={analyse}>{busy && !preview ? "…" : "Analyser"}</button>
            {preview && (
              <button className="btn btn-primary text-xs" disabled={!picked.size || busy} onClick={apply}>
                {busy ? "…" : `Enregistrer la sélection (${picked.size})`}
              </button>
            )}
          </div>

          {preview && (
            <div className="mt-3">
              <p className="text-xs text-slate-600 mb-2">
                {preview.rows} utilisateur(s) AZZUR lus, espace <b>{preview.space ?? "non déterminé"}</b> ·{" "}
                {preview.proposals.filter((p) => p.status === "match").length} trouvé(s) ·{" "}
                {preview.proposals.filter((p) => ["ambigu", "a-verifier", "autre-espace"].includes(p.status)).length} à vérifier
              </p>
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto border border-slate-100 rounded-lg">
                <table className="w-full" style={{ minWidth: "760px" }}>
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="table-th w-8"></th>
                      <th className="table-th">Id AZZUR</th>
                      <th className="table-th">Utilisateur AZZUR</th>
                      <th className="table-th">Conseiller Assurpilot</th>
                      <th className="table-th">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.proposals.map((p, i) => (
                      <tr key={p.azzur.azzurId} className={picked.has(i) ? "bg-emerald-50/50" : ""}>
                        <td className="table-td">
                          <input type="checkbox" disabled={!selectable(p)} checked={picked.has(i)} aria-label={`Associer l'Id ${p.azzur.azzurId}`}
                            onChange={() => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                        </td>
                        <td className="table-td font-mono text-xs">{p.azzur.azzurId}</td>
                        <td className="table-td text-xs">
                          {`${p.azzur.prenom} ${p.azzur.nom}`.trim()}
                          <span className="block text-[10px] text-slate-400">{p.azzur.email}{p.azzur.etat && p.azzur.etat !== "Actif" ? ` · ${p.azzur.etat}` : ""}</span>
                        </td>
                        <td className="table-td text-xs">
                          {p.adviser ? (
                            <>
                              {p.adviser.name}{p.reason ? <span className="text-slate-400"> · {REASON_LABEL[p.reason] ?? p.reason}</span> : null}
                              {p.adviser.currentAzzurId && <span className="block text-[10px] text-slate-400">Id actuel : {p.adviser.currentAzzurId}</span>}
                            </>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="table-td text-xs">
                          <span className={`badge ${STATUS_LABEL[p.status].cls}`} style={{ fontSize: "10px", padding: "1px 7px" }}>{STATUS_LABEL[p.status].text}</span>
                          {p.note && <span className="block text-[10px] text-slate-500 mt-0.5">{p.note}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.unmatchedAdvisers.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-800">
                  Conseillers {preview.space ?? ""} d&apos;Assurpilot sans Id et absents de cette liste :{" "}
                  {preview.unmatchedAdvisers.map((a) => a.name).join(", ")} — à saisir à la main dans le tableau ci-dessous.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
