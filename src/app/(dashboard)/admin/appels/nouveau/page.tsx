"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Agent        = { id: string; prenom: string; nom: string };
type Line         = { id: string; label: string };
type ResultOption = { value: string; label: string; isActive: boolean };

const STATUTS = [
  { value: "REPONDU",  label: "Répondu",  active: "border-green-400 bg-green-50 text-green-800"  },
  { value: "MANQUE",   label: "Manqué",   active: "border-red-400 bg-red-50 text-red-800"         },
  { value: "EN_COURS", label: "En cours", active: "border-yellow-400 bg-yellow-50 text-yellow-800"},
];

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function NouvelAppelPage() {
  const router = useRouter();

  const [agents,      setAgents]      = useState<Agent[]>([]);
  const [lines,       setLines]       = useState<Line[]>([]);
  const [resultOpts,  setResultOpts]  = useState<ResultOption[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [callerNumber,   setCallerNumber]   = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [phoneLineId,    setPhoneLineId]    = useState("");
  const [startedAt,      setStartedAt]      = useState(toLocalInput(new Date()));
  const [durationMins,   setDurationMins]   = useState("0");
  const [durationSecs,   setDurationSecs]   = useState("0");
  const [statut,         setStatut]         = useState("REPONDU");
  const [resultat,       setResultat]       = useState("");
  const [notes,          setNotes]          = useState("");
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState("");
  const [success,        setSuccess]        = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/users?role=CONSEILLER").then((r) => r.json()),
      fetch("/api/phone-lines").then((r) => r.json()),
      fetch("/api/call-result-options").then((r) => r.json()),
    ]).then(([u, l, o]) => {
      setAgents(Array.isArray(u) ? u.filter((x: any) => x.isActive) : []);
      setLines(Array.isArray(l) ? l : []);
      setResultOpts(Array.isArray(o) ? o.filter((x: ResultOption) => x.isActive) : []);
      if (Array.isArray(l) && l.length > 0) setPhoneLineId(l[0].id);
    }).finally(() => setLoadingData(false));
  }, []);

  const totalSeconds = Number(durationMins) * 60 + Number(durationSecs);
  const isMissed     = statut === "MANQUE";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!callerNumber.trim()) { setError("Le numéro appelant est obligatoire."); return; }
    if (!assignedUserId)      { setError("Veuillez choisir un conseiller."); return; }
    if (!phoneLineId)         { setError("Veuillez choisir une ligne."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/calls/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerNumber:    callerNumber.trim(),
          assignedUserId,
          phoneLineId,
          startedAt:       new Date(startedAt).toISOString(),
          durationSeconds: totalSeconds,
          statut,
          isMissed,
          resultat: isMissed ? null : (resultat || null),
          notes:    notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur."); setSaving(false); return; }
      setSuccess(true);
      setTimeout(() => router.push("/admin/appels"), 1400);
    } catch { setError("Erreur réseau."); setSaving(false); }
  }

  if (loadingData) return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="card p-10 text-center text-gray-400 animate-pulse">Chargement...</div>
    </div>
  );

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="btn btn-secondary text-xs py-1 px-2.5">← Retour</button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Ajouter un appel manuel</h1>
          <p className="text-sm text-gray-500 mt-0.5">Pour les appels non importés depuis Keyyo</p>
        </div>
      </div>

      {success && (
        <div className="mb-5 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
          Appel créé avec succès. Redirection en cours...
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 pb-2 border-b border-gray-100">Informations de l'appel</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Numéro appelant *</label>
              <input type="text" value={callerNumber} onChange={(e) => setCallerNumber(e.target.value)}
                placeholder="+33 6 12 34 56 78"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ligne téléphonique *</label>
              <select value={phoneLineId} onChange={(e) => setPhoneLineId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Choisir —</option>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Conseiller assigné *</label>
            <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Choisir un conseiller —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.prenom} {a.nom}</option>)}
            </select>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 pb-2 border-b border-gray-100">Détails de l'appel</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date et heure *</label>
            <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Durée (min)</label>
              <input type="number" min="0" max="999" value={durationMins} onChange={(e) => setDurationMins(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Durée (sec)</label>
              <input type="number" min="0" max="59" value={durationSecs} onChange={(e) => setDurationSecs(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          {totalSeconds > 0 && (
            <p className="text-xs text-gray-400">Total : {Math.floor(totalSeconds/60)} min {totalSeconds%60} sec</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Statut *</label>
            <div className="flex gap-2">
              {STATUTS.map((s) => (
                <button key={s.value} type="button" onClick={() => setStatut(s.value)}
                  className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                    statut === s.value ? s.active : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!isMissed && (
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700 pb-2 border-b border-gray-100">Résultat et Notes</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Résultat de l'appel</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setResultat("")}
                  className={`px-3 py-2.5 rounded-lg border-2 text-sm font-medium text-left transition-all ${
                    !resultat ? "border-gray-400 bg-gray-100 text-gray-800" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                  }`}>
                  Sans résultat
                </button>
                {resultOpts.map((opt) => (
                  <button key={opt.value} type="button" onClick={() => setResultat(opt.value)}
                    className={`px-3 py-2.5 rounded-lg border-2 text-sm font-medium text-left transition-all ${
                      resultat === opt.value
                        ? "border-blue-400 bg-blue-50 text-blue-800"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Observations, contexte..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={() => router.back()} className="btn btn-secondary">Annuler</button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Création en cours..." : "Créer l'appel"}
          </button>
        </div>
      </form>
    </div>
  );
}
