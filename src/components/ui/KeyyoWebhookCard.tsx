"use client";
// Keyyo "Notification d'appels" on /admin/keyyo: switch, the URL to configure on each adviser's
// Keyyo line, and the last notifications received with what AssurPilot did with them.
import { useCallback, useEffect, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { usePolling } from "@/lib/usePolling";
import { useToast } from "@/components/ui/Toast";

type EventRow = {
  id: string; receivedAt: string; type: string; callRef: string | null; customer: string;
  adviserName: string | null; callId: string | null; outcome: string; params: string;
};
type Info = { enabled: boolean; url: string | null; tokenFromEnv: boolean; events: EventRow[] };

const TYPE_LABEL: Record<string, string> = { SETUP: "Sonnerie", CONNECT: "Décroché", RELEASE: "Raccroché" };

export default function KeyyoWebhookCard() {
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setInfo(await fetchJson<Info>("/api/admin/keyyo/webhook")); }
    catch (e) { toast.error(errorMessage(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 10_000);

  async function act(action: "enable" | "disable" | "regenerate") {
    if (action === "regenerate" && !window.confirm("Générer une nouvelle URL ? L'ancienne cessera de fonctionner : il faudra mettre la nouvelle sur chaque ligne Keyyo.")) return;
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
          <h2 className="text-sm font-semibold text-slate-800">Notification d&apos;appels Keyyo (temps réel)</h2>
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

          <p className="text-xs font-semibold text-slate-700 mb-1">Dernières notifications reçues</p>
          {info.events.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune notification reçue pour l&apos;instant.</p>
          ) : (
            <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
              <table className="w-full" style={{ minWidth: "720px" }}>
                <thead className="bg-slate-50/70 border-b border-slate-100 sticky top-0">
                  <tr><th className="table-th">Reçue</th><th className="table-th">Type</th><th className="table-th">Client</th><th className="table-th">Conseiller</th><th className="table-th">Résultat</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {info.events.map((e) => (
                    <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setShowRaw(showRaw === e.id ? null : e.id)}>
                      <td className="table-td text-xs whitespace-nowrap">{new Date(e.receivedAt).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                      <td className="table-td text-xs">{TYPE_LABEL[e.type.toUpperCase()] ?? e.type ?? "—"}</td>
                      <td className="table-td font-mono text-xs">{e.customer || "—"}</td>
                      <td className="table-td text-xs">{e.adviserName ?? <span className="text-slate-400">—</span>}</td>
                      <td className="table-td text-xs">
                        {e.outcome}
                        {showRaw === e.id && <code className="block mt-1 text-[10px] text-slate-500 break-all">{e.params}</code>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-1">Cliquez une ligne pour voir les paramètres exacts envoyés par Keyyo.</p>
        </>
      )}
    </div>
  );
}
