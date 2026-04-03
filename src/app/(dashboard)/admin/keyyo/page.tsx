"use client";
import { useEffect, useState } from "react";

const DISTRIBUTION_MODES = [
  { value: "ROUND_ROBIN",  label: "Tourniquet (Round Robin)", desc: "Les appels sont distribués équitablement entre tous les conseillers disponibles" },
  { value: "SEQUENTIAL",   label: "Séquentiel",               desc: "Les appels sont distribués dans l'ordre défini de la liste des conseillers" },
  { value: "LEAST_BUSY",   label: "Moins occupé",             desc: "L'appel est dirigé vers le conseiller ayant le moins d'appels récents" },
];

type Config = {
  id: string;
  apiKeyMasked: string;
  webhookUrl: string;
  phoneNumber: string;
  distributionMode: string;
  maxRingSeconds: number;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestSuccess: boolean;
  lastTestMessage: string;
};

export default function KeyyoConfigPage() {
  const [config, setConfig]       = useState<Config | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [testing, setTesting]     = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState("");

  // Form fields
  const [apiKey, setApiKey]                   = useState("");
  const [webhookUrl, setWebhookUrl]           = useState("");
  const [phoneNumber, setPhoneNumber]         = useState("");
  const [distributionMode, setDistribution]   = useState("ROUND_ROBIN");
  const [maxRingSeconds, setMaxRing]          = useState(30);
  const [isActive, setIsActive]               = useState(false);

  useEffect(() => {
    fetch("/api/config/keyyo")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        setWebhookUrl(data.webhookUrl ?? "");
        setPhoneNumber(data.phoneNumber ?? "");
        setDistribution(data.distributionMode ?? "ROUND_ROBIN");
        setMaxRing(data.maxRingSeconds ?? 30);
        setIsActive(data.isActive ?? false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const res = await fetch("/api/config/keyyo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, webhookUrl, phoneNumber, distributionMode, maxRingSeconds, isActive }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur lors de la sauvegarde."); return; }
      setConfig(data);
      setApiKey(""); // clear after save
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Erreur réseau.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError("");
    try {
      const res = await fetch("/api/config/keyyo", { method: "POST" });
      const data = await res.json();
      // Refresh config to show test result
      const refreshed = await fetch("/api/config/keyyo").then((r) => r.json());
      setConfig(refreshed);
    } catch {
      setError("Erreur lors du test de connexion.");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto animate-pulse">
        <div className="h-8 bg-gray-100 rounded w-1/3 mb-6" />
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Configuration Keyyo</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Paramètres de l'intégration VoIP pour la réception des appels entrants
        </p>
      </div>

      {/* Status banner */}
      <div className={`mb-6 rounded-xl px-4 py-3 border flex items-center gap-3 ${
        isActive
          ? "bg-green-50 border-green-200"
          : "bg-amber-50 border-amber-200"
      }`}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isActive ? "bg-green-500" : "bg-amber-400"}`} />
        <div>
          <p className={`text-sm font-medium ${isActive ? "text-green-800" : "text-amber-800"}`}>
            {isActive ? "Intégration Keyyo activée" : "Intégration Keyyo désactivée"}
          </p>
          <p className={`text-xs ${isActive ? "text-green-600" : "text-amber-600"}`}>
            {isActive
              ? "Les appels entrants sont reçus et distribués automatiquement."
              : "Activez l'intégration pour commencer à recevoir les appels."}
          </p>
        </div>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
              isActive ? "bg-green-500" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                isActive ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* API credentials */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 pb-2 border-b border-gray-100">
            Authentification API
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Clé API Keyyo
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.apiKeyMasked ? `Clé actuelle : ${config.apiKeyMasked}` : "Saisir votre clé API Keyyo"}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              Disponible dans votre espace Keyyo → API &amp; Intégrations. Laisser vide pour conserver la clé actuelle.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Numéro de téléphone Keyyo
            </label>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+33 1 23 45 67 89"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Le numéro principal reçevant les appels entrants depuis Keyyo.
            </p>
          </div>
        </div>

        {/* Webhook */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 pb-2 border-b border-gray-100">
            Webhook de réception
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              URL du webhook
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://votre-domaine.fr/webhooks/voip/keyyo"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(webhookUrl); }}
                className="btn btn-secondary text-xs px-3 flex-shrink-0"
                title="Copier l'URL"
              >
                Copier
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Renseignez cette URL dans votre dashboard Keyyo → Webhooks pour recevoir les événements d'appels.
            </p>
          </div>
        </div>

        {/* Distribution rules */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 pb-2 border-b border-gray-100">
            Règles de distribution des appels
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Mode de distribution
            </label>
            <div className="space-y-2">
              {DISTRIBUTION_MODES.map((m) => (
                <label
                  key={m.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    distributionMode === m.value
                      ? "border-blue-400 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="distributionMode"
                    value={m.value}
                    checked={distributionMode === m.value}
                    onChange={() => setDistribution(m.value)}
                    className="mt-0.5 flex-shrink-0"
                  />
                  <div>
                    <p className={`text-sm font-medium ${distributionMode === m.value ? "text-blue-900" : "text-gray-800"}`}>
                      {m.label}
                    </p>
                    <p className={`text-xs mt-0.5 ${distributionMode === m.value ? "text-blue-600" : "text-gray-500"}`}>
                      {m.desc}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Durée de sonnerie maximale : <strong>{maxRingSeconds} secondes</strong>
            </label>
            <input
              type="range"
              min={10}
              max={120}
              step={5}
              value={maxRingSeconds}
              onChange={(e) => setMaxRing(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>10 sec</span>
              <span>120 sec</span>
            </div>
          </div>
        </div>

        {/* Test result */}
        {config?.lastTestedAt && (
          <div className={`rounded-xl px-4 py-3 border text-sm ${
            config.lastTestSuccess
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}>
            <p className="font-medium mb-0.5">
              {config.lastTestSuccess ? "✅ Dernier test réussi" : "❌ Dernier test échoué"}
            </p>
            <p className={`text-xs ${config.lastTestSuccess ? "text-green-600" : "text-red-600"}`}>
              {config.lastTestMessage}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Testé le {new Date(config.lastTestedAt).toLocaleString("fr-FR")}
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {saved && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
            ✅ Configuration sauvegardée avec succès.
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
            className="btn btn-secondary"
          >
            {testing ? "Test en cours..." : "🔌 Tester la connexion"}
          </button>
          <button
            type="submit"
            disabled={saving || testing}
            className="btn btn-primary"
          >
            {saving ? "Sauvegarde..." : "Enregistrer la configuration"}
          </button>
        </div>
      </form>
    </div>
  );
}
