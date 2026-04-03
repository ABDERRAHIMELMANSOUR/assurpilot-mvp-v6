"use client";
import { useState, useEffect } from "react";

type ResultOption = {
  id: string;
  label: string;
  value: string;
  color: string;
  isActive: boolean;
  order: number;
};

const COLOR_MAP: Record<string, string> = {
  green:  "border-green-300 bg-green-50 text-green-800",
  blue:   "border-blue-300 bg-blue-50 text-blue-800",
  red:    "border-red-300 bg-red-50 text-red-800",
  yellow: "border-yellow-300 bg-yellow-50 text-yellow-800",
  purple: "border-purple-300 bg-purple-50 text-purple-800",
  gray:   "border-gray-300 bg-gray-50 text-gray-800",
};

interface Props {
  callId: string;
  currentResult?: { resultat: string; notes?: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ResultModal({ callId, currentResult, onClose, onSaved }: Props) {
  const [options,  setOptions]  = useState<ResultOption[]>([]);
  const [resultat, setResultat] = useState(currentResult?.resultat ?? "");
  const [notes,    setNotes]    = useState(currentResult?.notes ?? "");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  useEffect(() => {
    fetch("/api/call-result-options")
      .then((r) => r.json())
      .then((data) => setOptions(Array.isArray(data) ? data.filter((o: ResultOption) => o.isActive) : []));
  }, []);

  async function handleSave() {
    if (!resultat) { setError("Veuillez sélectionner un résultat."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/calls/${callId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultat, notes }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      onSaved();
      onClose();
    } catch {
      setError("Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Résultat de l'appel</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Résultat *</label>
            {options.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Chargement des options...</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setResultat(opt.value)}
                    className={`px-3 py-2.5 rounded-lg border-2 text-sm font-medium text-left transition-all ${
                      resultat === opt.value
                        ? (COLOR_MAP[opt.color] ?? COLOR_MAP.gray)
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes <span className="text-gray-400 font-normal">(optionnel)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Observations, suites à donner..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">Annuler</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
