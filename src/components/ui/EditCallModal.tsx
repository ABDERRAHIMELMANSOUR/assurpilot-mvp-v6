"use client";
import { useState, useEffect } from "react";

type Agent        = { id: string; prenom: string; nom: string };
type Line         = { id: string; label: string };
type ResultOption = { value: string; label: string; isActive: boolean };

interface CallData {
  id:             string;
  callerNumber:   string;
  assignedUserId: string | null;
  phoneLineId:    string;
  startedAt:      string;
  durationSeconds:number;
  statut:         string;
  isMissed:       boolean;
  result?:        { resultat: string; notes?: string | null } | null;
}

interface Props {
  call: CallData;
  onClose:   () => void;
  onSaved:   () => void;
  onDeleted: () => void;
}

const STATUTS = [
  { value: "REPONDU",  label: "Répondu",  cls: "border-green-400 bg-green-50 text-green-800"  },
  { value: "MANQUE",   label: "Manqué",   cls: "border-red-400 bg-red-50 text-red-800"         },
  { value: "EN_COURS", label: "En cours", cls: "border-yellow-400 bg-yellow-50 text-yellow-800" },
];

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function EditCallModal({ call, onClose, onSaved, onDeleted }: Props) {
  const [agents,      setAgents]      = useState<Agent[]>([]);
  const [lines,       setLines]       = useState<Line[]>([]);
  const [resultOpts,  setResultOpts]  = useState<ResultOption[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [callerNumber,   setCallerNumber]   = useState(call.callerNumber);
  const [assignedUserId, setAssignedUserId] = useState(call.assignedUserId ?? "");
  const [phoneLineId,    setPhoneLineId]    = useState(call.phoneLineId);
  const [startedAt,      setStartedAt]      = useState(toLocalInput(call.startedAt));
  const [durationMins,   setDurationMins]   = useState(String(Math.floor(call.durationSeconds / 60)));
  const [durationSecs,   setDurationSecs]   = useState(String(call.durationSeconds % 60));
  const [statut,         setStatut]         = useState(call.statut);
  const [resultat,       setResultat]       = useState(call.result?.resultat ?? "");
  const [notes,          setNotes]          = useState(call.result?.notes ?? "");

  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [error,     setError]     = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/users?role=CONSEILLER").then((r) => r.json()),
      fetch("/api/phone-lines").then((r) => r.json()),
      fetch("/api/call-result-options").then((r) => r.json()),
    ]).then(([u, l, o]) => {
      setAgents(Array.isArray(u) ? u.filter((x: any) => x.isActive) : []);
      setLines(Array.isArray(l) ? l : []);
      setResultOpts(Array.isArray(o) ? o.filter((x: ResultOption) => x.isActive) : []);
      setLoadingData(false);
    });
  }, []);

  const isMissed     = statut === "MANQUE";
  const totalSeconds = Number(durationMins) * 60 + Number(durationSecs);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!callerNumber.trim()) { setError("Le numéro appelant est obligatoire."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/calls/${call.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerNumber:    callerNumber.trim(),
          assignedUserId:  assignedUserId || null,
          phoneLineId,
          startedAt:       new Date(startedAt).toISOString(),
          durationSeconds: totalSeconds,
          statut,
          isMissed,
          resultat:        isMissed ? null : (resultat || null),
          notes:           notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur."); setSaving(false); return; }
      onSaved(); onClose();
    } catch { setError("Erreur réseau."); setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm("Supprimer définitivement cet appel importé ?\nCette action est irréversible.")) return;
    setDeleting(true); setError("");
    try {
      const res = await fetch(`/api/calls/${call.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur."); setDeleting(false); return; }
      onDeleted(); onClose();
    } catch { setError("Erreur réseau."); setDeleting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Modifier l'appel importé</h2>
            <p className="text-xs text-gray-400 mt-0.5">Seuls les appels importés peuvent être modifiés</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        {loadingData ? (
          <div className="flex-1 flex items-center justify-center p-8 text-gray-400 text-sm animate-pulse">
            Chargement...
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {/* Caller + line */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">N° appelant *</label>
                  <input type="text" value={callerNumber} onChange={(e) => setCallerNumber(e.target.value)}
                    placeholder="+33 6 12 34 56 78"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ligne</label>
                  <select value={phoneLineId} onChange={(e) => setPhoneLineId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Conseiller */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Conseiller</label>
                <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Non assigné —</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.prenom} {a.nom}</option>)}
                </select>
              </div>

              {/* Date + duration */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date et heure</label>
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

              {/* Statut */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Statut</label>
                <div className="flex gap-2">
                  {STATUTS.map((s) => (
                    <button key={s.value} type="button" onClick={() => setStatut(s.value)}
                      className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                        statut === s.value ? s.cls : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Result + notes (only if not missed) */}
              {!isMissed && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Résultat</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setResultat("")}
                        className={`px-3 py-2 rounded-lg border-2 text-sm font-medium text-left transition-all ${
                          !resultat ? "border-gray-400 bg-gray-100 text-gray-800" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                        }`}>
                        Sans résultat
                      </button>
                      {resultOpts.map((opt) => (
                        <button key={opt.value} type="button" onClick={() => setResultat(opt.value)}
                          className={`px-3 py-2 rounded-lg border-2 text-sm font-medium text-left transition-all ${
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
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                      placeholder="Observations, contexte..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  </div>
                </>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0 gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="btn btn-danger text-xs disabled:opacity-50"
              >
                {deleting ? "Suppression..." : "Supprimer l'appel"}
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="btn btn-secondary">Annuler</button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
