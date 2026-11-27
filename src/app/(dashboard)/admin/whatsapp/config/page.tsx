"use client";
// src/app/(dashboard)/admin/whatsapp/config/page.tsx
//
// ADMINISTRATOR ONLY (admin/layout.tsx + the API's requireRole). The two
// WhatsApp numbers, the switch between them, what is configured, and the
// webhook URL to register in Meta. Values themselves are set in the
// environment; this page never shows a secret.
import { useCallback, useEffect, useState } from "react";
import { fetchJson, errorMessage } from "@/lib/fetchJson";

type Num = { slot: "PRIMARY" | "BACKUP"; label: string; displayNumber: string; phoneNumberId: string; wabaId: string; configured: boolean };
type Config = {
  activeSlot: "PRIMARY" | "BACKUP";
  numbers: Num[];
  status: { accessToken: boolean; appSecret: boolean; verifyToken: boolean; publicBaseUrl: boolean; graphVersion: string; templateLanguage: string };
  webhookUrl: string | null;
  unassigned: number;
  history: { id: string; createdAt: string; fromSlot: string; toSlot: string; actorName: string }[];
};

const SLOT_LABEL: Record<string, string> = { PRIMARY: "principal", BACKUP: "backup" };

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`badge ${ok ? "badge-green" : "badge-red"}`}>{ok ? "OK" : "Manquant"}</span>
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        <span className="text-slate-500"> · {hint}</span>
      </span>
    </li>
  );
}

export default function WhatsAppConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCfg(await fetchJson<Config>("/api/admin/whatsapp/config"));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Impossible de charger la configuration WhatsApp."));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function switchTo(slot: "PRIMARY" | "BACKUP") {
    if (!cfg || slot === cfg.activeSlot) return;
    setBusy(true);
    try {
      setCfg(
        await fetchJson<Config>("/api/admin/whatsapp/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeSlot: slot }),
        })
      );
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Bascule impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Configuration WhatsApp</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          WhatsApp Cloud API · numéro d&apos;envoi, webhook Meta et variables d&apos;environnement.
        </p>
      </div>

      {error && <div className="card p-3 text-sm text-rose-700 bg-rose-50 border-rose-200">{error}</div>}
      {!cfg && !error && <p className="text-sm text-slate-500">Chargement…</p>}

      {cfg && (
        <>
          <div className="card p-5">
            <h2 className="font-semibold mb-1">Numéro d&apos;envoi</h2>
            <p className="text-sm text-slate-500 mb-4">
              Les messages partent du numéro actif. Les deux numéros continuent de recevoir. Après une bascule, un client
              qui n&apos;a jamais écrit au nouveau numéro ne peut recevoir qu&apos;un modèle (fenêtre de 24 h propre à chaque numéro).
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {cfg.numbers.map((n) => {
                const active = n.slot === cfg.activeSlot;
                return (
                  <div key={n.slot} className={`rounded-xl border p-4 ${active ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}>
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-slate-900">{n.label}</p>
                      {active ? <span className="badge badge-green">Actif</span> : <span className="badge badge-gray">En attente</span>}
                    </div>
                    <p className="text-sm text-slate-700 mt-1">{n.displayNumber || "Numéro non renseigné"}</p>
                    <p className="text-xs text-slate-500 mt-1">Phone Number ID : {n.phoneNumberId || "non configuré"}</p>
                    <p className="text-xs text-slate-500">WABA : {n.wabaId || "non configuré"}</p>
                    {!active && (
                      <button
                        className="btn btn-primary mt-3"
                        disabled={busy || !n.configured}
                        title={n.configured ? "" : "Renseigner le Phone Number ID dans les variables d'environnement"}
                        onClick={() => void switchTo(n.slot)}
                      >
                        Basculer sur le numéro {SLOT_LABEL[n.slot]}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-3">Webhook Meta</h2>
            <p className="text-sm text-slate-700">
              URL de rappel :{" "}
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 break-all">
                {cfg.webhookUrl ?? "renseigner WHATSAPP_PUBLIC_BASE_URL (ou NEXTAUTH_URL)"}
              </code>
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Dans Meta : WhatsApp → Configuration → Webhook, coller cette URL et le jeton de vérification
              (WHATSAPP_VERIFY_TOKEN), puis s&apos;abonner au champ « messages ».
            </p>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-3">Variables d&apos;environnement</h2>
            <ul className="space-y-2">
              <Check ok={cfg.status.accessToken} label="WHATSAPP_ACCESS_TOKEN" hint="token permanent (utilisateur système Meta)" />
              <Check ok={cfg.status.appSecret} label="WHATSAPP_APP_SECRET" hint="vérifie la signature des webhooks" />
              <Check ok={cfg.status.verifyToken} label="WHATSAPP_VERIFY_TOKEN" hint="jeton choisi, saisi aussi dans Meta" />
              <Check ok={cfg.status.publicBaseUrl} label="WHATSAPP_PUBLIC_BASE_URL" hint="URL de production" />
            </ul>
            <p className="text-xs text-slate-500 mt-3">
              Graph API {cfg.status.graphVersion} · langue des modèles « {cfg.status.templateLanguage} » ·{" "}
              {cfg.unassigned} conversation{cfg.unassigned > 1 ? "s" : ""} non attribuée{cfg.unassigned > 1 ? "s" : ""}
            </p>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-3">Historique des bascules</h2>
            {cfg.history.length === 0 ? (
              <p className="text-sm text-slate-500">Aucune bascule pour l&apos;instant.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {cfg.history.map((h) => (
                  <li key={h.id} className="text-slate-700">
                    {new Date(h.createdAt).toLocaleString("fr-FR")} · {SLOT_LABEL[h.fromSlot] ?? h.fromSlot} → {SLOT_LABEL[h.toSlot] ?? h.toSlot}
                    {h.actorName ? ` · par ${h.actorName}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
