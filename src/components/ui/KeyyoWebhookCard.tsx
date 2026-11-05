"use client";
// Keyyo "Notification d'appels" on /admin/keyyo: switch, the URL to configure on each adviser's
// Keyyo line, and the last notifications received with what AssurPilot did with them.
import { useCallback, useEffect, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { usePolling } from "@/lib/usePolling";
import { useToast } from "@/components/ui/Toast";
import RingoverForwardsEditor, { type ForwardRow, type StandardLine } from "@/components/ui/RingoverForwardsEditor";

type EventRow = {
  id: string; receivedAt: string; type: string; callRef: string | null; customer: string; called: string;
  standardLine: string; standardLabel: string; agency: string; agent: string;
  adviserName: string | null; callId: string | null; outcome: string; params: string;
};
type Info = {
  enabled: boolean; url: string | null; tokenFromEnv: boolean; events: EventRow[];
  ringover: { answered: string; ended: string } | null; ringoverSigned: boolean;
  ringoverForwards: ForwardRow[]; ringoverForwardsEnv: ForwardRow[]; standardLines: StandardLine[];
};

const TYPE_LABEL: Record<string, string> = {
  SETUP: "Sonnerie", CONNECT: "Décroché", RELEASE: "Raccroché",
  "RINGOVER:RINGING": "Sonnerie (Ringover)", "RINGOVER:ANSWERED": "Décroché (Ringover)",
  "RINGOVER:HANGUP": "Raccroché (Ringover)", "RINGOVER:ENDED": "Raccroché (Ringover)", "RINGOVER:MISSED": "Manqué (Ringover)",
};

function CopyUrl({ label, url }: { label: string; url: string }) {
  const toast = useToast();
  return (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      <span className="text-[11px] font-medium text-slate-600 w-36 shrink-0">{label}</span>
      <code className="text-xs break-all bg-white border border-slate-200 rounded-lg px-2 py-1 flex-1 min-w-0">{url}</code>
      <button className="btn btn-secondary text-xs" onClick={() => { navigator.clipboard?.writeText(url); toast.success("URL copiée."); }}>Copier</button>
    </div>
  );
}

export default function KeyyoWebhookCard() {
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState<string | null>(null);
  const [agencyFilter, setAgencyFilter] = useState<"" | "CPA" | "ALM" | "KEYYO">("");

  const load = useCallback(async () => {
    try { setInfo(await fetchJson<Info>("/api/admin/keyyo/webhook")); }
    catch (e) { toast.error(errorMessage(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 10_000);

  async function act(action: "enable" | "disable" | "regenerate") {
    if (action === "regenerate" && !window.confirm("Générer une nouvelle URL ? L'ancienne cessera de fonctionner : il faudra mettre la nouvelle sur chaque ligne Keyyo et dans les webhooks Ringover.")) return;
    setBusy(true);
    try {
      await fetchJson("/api/admin/keyyo/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      await load();
      toast.success(action === "enable" ? "Notifications Keyyo activées : les appels arrivent en direct." : action === "disable" ? "Notifications Keyyo désactivées." : "Nouvelle URL générée.");
    } catch (e) { toast.error(errorMessage(e, "Action impossible.")); }
    finally { setBusy(false); }
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex flex-wrap items-start gap-3 mb-3">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold text-slate-800">Notification d&apos;appels Keyyo / Ringover (temps réel)</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
            Keyyo prévient AssurPilot à chaque appel : sonnerie (l&apos;appel apparaît « En cours » chez le conseiller), décroché
            (« Répondu », fiche envoyée vers AZZUR pour la Santé / ProAssur pour l&apos;Auto), raccroché (durée ; jamais décroché = « Manqué »).
            Le conseiller est celui dont la <b>ligne</b> a sonné ; le client est le numéro présenté.
          </p>
        </div>
        {info && (
          <button
            type="button" role="switch" aria-checked={info.enabled} disabled={busy}
            onClick={() => act(info.enabled ? "disable" : "enable")}
            className="inline-flex items-center gap-2 text-xs disabled:opacity-40"
          >
            <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${info.enabled ? "bg-emerald-500" : "bg-slate-300"}`}>
              <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${info.enabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </span>
            <span className={`font-medium ${info.enabled ? "text-emerald-700" : "text-slate-500"}`}>{info.enabled ? "Activé" : "Désactivé"}</span>
          </button>
        )}
      </div>

      {!info ? <p className="text-sm text-slate-400">Chargement…</p> : (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3">
            <p className="text-xs font-semibold text-slate-700 mb-1">URL à coller dans le Manager Keyyo, sur chaque ligne de conseiller</p>
            {info.url ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-xs break-all bg-white border border-slate-200 rounded-lg px-2 py-1 flex-1 min-w-0">{info.url}</code>
                <button className="btn btn-secondary text-xs" onClick={() => { navigator.clipboard?.writeText(info.url!); toast.success("URL copiée."); }}>Copier</button>
                {!info.tokenFromEnv && <button className="btn btn-secondary text-xs" disabled={busy} onClick={() => act("regenerate")}>Nouvelle URL</button>}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Activez l&apos;interrupteur pour générer l&apos;URL sécurisée.</p>
            )}
            <ol className="text-[11px] text-slate-600 mt-2 list-decimal pl-4 space-y-0.5">
              <li>Manager Keyyo → la ligne du conseiller → onglet <b>Configurer</b> → <b>Paramètres avancés</b> → <b>CTI</b> → <b>API serveur</b>.</li>
              <li>Collez l&apos;URL telle quelle : Keyyo remplace lui-même <span className="font-mono">_ACCOUNT_</span>, <span className="font-mono">_CALLER_</span>,{" "}
                <span className="font-mono">_CALLEE_</span>, <span className="font-mono">_CALLREF_</span>, <span className="font-mono">_N_TYPE_</span>,{" "}
                <span className="font-mono">_SESSION_ID_</span>… à chaque appel.</li>
              <li>Faites-le sur la ligne directe de <b>chaque conseiller</b> (Santé et Auto), puis passez un appel de test : il apparaît ci-dessous.</li>
            </ol>
            <p className="text-[11px] text-slate-500 mt-2">
              L&apos;URL contient un jeton secret : ne la partagez pas. Un appel arrivé par un standard et qui fait sonner plusieurs lignes reste
              un seul appel (même <span className="font-mono">_SESSION_ID_</span>), attribué au conseiller qui décroche. L&apos;envoi CRM suit
              l&apos;interrupteur « Envois automatiques » d&apos;Intégration AZZUR.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3">
            <p className="text-xs font-semibold text-slate-700">Webhooks Ringover (appels passant par Ringover)</p>
            {info.ringover ? (
              <>
                <CopyUrl label="Appels décrochés" url={info.ringover.answered} />
                <CopyUrl label="Appels raccrochés" url={info.ringover.ended} />
              </>
            ) : (
              <p className="text-xs text-slate-500 mt-1">Activez l&apos;interrupteur pour générer les URL sécurisées.</p>
            )}
            <ol className="text-[11px] text-slate-600 mt-2 list-decimal pl-4 space-y-0.5">
              <li>Dashboard Ringover → <b>Développeur</b> → <b>Webhooks</b> : collez la 1<sup>re</sup> URL dans <b>Appels décrochés</b>, la 2<sup>e</sup> dans <b>Appels raccrochés</b>
                {" "}(et, si vous voulez les manqués, aussi dans <b>Appels manqués</b>). Ne touchez pas au webhook <b>After-Call Work</b> (n8n).</li>
              <li><b>Seuls les appels entrants renvoyés par le standard Keyyo</b> sont traités : <span className="font-mono">direction: inbound</span>, et
                {" "}un champ de renvoi / transfert (<span className="font-mono">redirected_from</span>, <span className="font-mono">transferred_from</span>,
                {" "}<span className="font-mono">metadata</span>…) qui nomme une ligne du standard, ou un numéro appelé (<span className="font-mono">to_number</span>)
                {" "}qui est un des numéros Ringover ci-dessous (avec sa ligne du standard) ou une ligne du standard. Appels sortants, internes, directs ou venant d&apos;ailleurs : ignorés,
                {" "}sans rien enregistrer. Pour chaque appel gardé, le journal note le numéro du client (<span className="font-mono">from_number</span>), le numéro
                {" "}appelé (<span className="font-mono">to_number</span>) et la ligne du standard.</li>
              <li>Le conseiller est l&apos;utilisateur Ringover qui a décroché, retrouvé par son <b>e-mail</b> puis ses <b>prénom et nom</b> dans AssurPilot
                (puis mémorisé) ; le client est le numéro appelant (<span className="font-mono">from_number</span>) ; les deux événements sont reliés par
                {" "}<span className="font-mono">call_id</span>.</li>
              <li>
                Signature Ringover : {info.ringoverSigned
                  ? <span className="text-emerald-700 font-medium">vérifiée (RINGOVER_WEBHOOK_SECRET)</span>
                  : <>facultative — mettez la clé du webhook Ringover dans la variable <span className="font-mono">RINGOVER_WEBHOOK_SECRET</span> de Vercel ; le jeton de l&apos;URL suffit sinon.</>}
              </li>
            </ol>
            <RingoverForwardsEditor rows={info.ringoverForwards} envRows={info.ringoverForwardsEnv} standardLines={info.standardLines} onSaved={load} />
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-xs font-semibold text-slate-700 mr-auto">Dernières notifications reçues</p>
            <label className="text-[11px] text-slate-500" htmlFor="journal-agency">Agence</label>
            <select id="journal-agency" className="input text-xs w-44" value={agencyFilter} onChange={(e) => setAgencyFilter(e.target.value as typeof agencyFilter)}>
              <option value="">Toutes</option>
              <option value="CPA">Ringover — standard CPA</option>
              <option value="ALM">Ringover — standard ALM</option>
              <option value="KEYYO">Keyyo (lignes directes)</option>
            </select>
          </div>
          {(() => {
            const rows = info.events.filter((e) =>
              !agencyFilter ? true : agencyFilter === "KEYYO" ? !e.type.toLowerCase().startsWith("ringover:") : e.agency === agencyFilter);
            if (rows.length === 0) return <p className="text-xs text-slate-400">Aucune notification{agencyFilter ? " pour ce filtre" : " reçue pour l'instant"}.</p>;
            return (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full" style={{ minWidth: "1080px" }}>
                <thead className="bg-slate-50/70 border-b border-slate-100 sticky top-0">
                  <tr>
                    <th className="table-th">Reçue</th><th className="table-th">Type</th><th className="table-th">Client</th>
                    <th className="table-th">Standard Keyyo</th><th className="table-th">N° appelé</th>
                    <th className="table-th">A décroché</th><th className="table-th">Résultat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((e) => (
                    <tr key={e.id} className="cursor-pointer hover:bg-slate-50 align-top" onClick={() => setShowRaw(showRaw === e.id ? null : e.id)}>
                      <td className="table-td text-xs whitespace-nowrap">{new Date(e.receivedAt).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                      <td className="table-td text-xs">{TYPE_LABEL[e.type.toUpperCase()] ?? e.type ?? "—"}</td>
                      <td className="table-td font-mono text-xs">{e.customer || "—"}</td>
                      <td className="table-td text-xs">
                        {e.standardLine ? (
                          <>
                            {e.agency && (
                              <span className={`inline-block rounded px-1.5 py-0.5 mr-1 text-[10px] font-semibold ${e.agency === "CPA" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"}`}>{e.agency}</span>
                            )}
                            {e.standardLabel || "Ligne"} <span className="font-mono text-slate-500">{e.standardLine}</span>
                          </>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="table-td font-mono text-xs">{e.called || "—"}</td>
                      <td className="table-td text-xs">
                        {e.agent && <span className="block text-slate-500">Ringover : {e.agent}</span>}
                        {e.adviserName ? <span className="font-medium text-slate-800">{e.agent ? "→ " : ""}{e.adviserName}</span> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="table-td text-xs">
                        {e.outcome}
                        {showRaw === e.id && <code className="block mt-1 text-[10px] text-slate-500 break-all">{e.params}</code>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            );
          })()}
          <p className="text-[11px] text-slate-400 mt-1">
            Ringover : client → ligne du standard Keyyo d&apos;origine (agence) → numéro Ringover appelé → agent qui a décroché sur Ringover → conseiller
            AssurPilot. Cliquez une ligne pour voir les paramètres exacts envoyés par Keyyo ou Ringover.
          </p>
        </>
      )}
    </div>
  );
}
