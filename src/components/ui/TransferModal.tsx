"use client";
import { useEffect, useState } from "react";
import { errorMessage, fetchJsonOr } from "@/lib/fetchJson";

type Conseiller = { id: string; prenom: string; nom: string; team?: { nom: string } | null };
type TargetsResponse = { entity: string | null; targets: Conseiller[] };
type ResultOption = { id: string; label: string; value: string; isActive: boolean };

export type TransferableCall = {
  id: string;
  callerNumber: string;
  startedAt: string;
  assignedUser?: { id: string; prenom: string; nom: string } | null;
  transferredBy?: { id: string; prenom: string; nom: string } | null;
  result?: { resultat: string; notes?: string | null } | null;
};

interface Props {
  call: TransferableCall;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Qualify a call and hand it to a conseiller in one action. The call stays in
 * the coach's workspace afterwards, badged with its new owner.
 */
export default function TransferModal({ call, onClose, onDone }: Props) {
  const [conseillers, setConseillers] = useState<Conseiller[]>([]);
  const [entity, setEntity] = useState<string | null>(null);
  const [options, setOptions] = useState<ResultOption[]>([]);
  const [target, setTarget] = useState(call.assignedUser?.id ?? "");
  const [resultat, setResultat] = useState(call.result?.resultat ?? "");
  const [notes, setNotes] = useState(call.result?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // /api/transfer-targets already applies the caller's rules: a coach gets
      // their own conseillers, a conseiller gets peers inside their entity
      // (CPA or ALM) and never across it.
      const [targets, opts] = await Promise.all([
        fetchJsonOr<TargetsResponse>({ entity: null, targets: [] }, "/api/transfer-targets"),
        fetchJsonOr<ResultOption[]>([], "/api/call-result-options"),
      ]);
      if (cancelled) return;
      setConseillers(Array.isArray(targets?.targets) ? targets.targets : []);
      setEntity(targets?.entity ?? null);
      setOptions(Array.isArray(opts) ? opts.filter((o) => o.isActive) : []);
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!target) { setError("Sélectionnez le conseiller destinataire."); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/calls/${call.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conseillerId: target,
          // Only send a qualification if one was chosen, so an existing result
          // is not wiped by opening and saving the modal.
          ...(resultat ? { resultat, notes: notes || null } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Le transfert a échoué."));
      setSaving(false);
    }
  }

  async function cancelTransfer() {
    setError(""); setSaving(true);
    try {
      const res = await fetch(`/api/calls/${call.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conseillerId: null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      onDone(); onClose();
    } catch (err) {
      setError(errorMessage(err, "L'annulation a échoué."));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Qualifier et transférer</h2>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">
            {call.callerNumber} · {new Date(call.startedAt).toLocaleString("fr-FR")}
          </p>
        </div>

        <form onSubmit={submit}>
          <div className="px-6 py-5 space-y-4">
            {call.transferredBy && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                Transféré par {call.transferredBy.prenom} {call.transferredBy.nom}
                {call.assignedUser && <> à <strong>{call.assignedUser.prenom} {call.assignedUser.nom}</strong></>}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transférer à <span className="text-red-500">*</span>
                {entity && (
                  <span className="ml-1 text-xs font-normal text-blue-600">
                    (entité {entity})
                  </span>
                )}
              </label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Choisir un conseiller —</option>
                {conseillers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.prenom} {c.nom}{c.team?.nom ? ` · ${c.team.nom}` : ""}
                  </option>
                ))}
              </select>
              {conseillers.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Aucun conseiller disponible{entity ? ` dans l'entité ${entity}` : ""}.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Résultat <span className="text-gray-400 font-normal">(optionnel)</span>
              </label>
              <select
                value={resultat}
                onChange={(e) => setResultat(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Ne pas qualifier —</option>
                {options.map((o) => (
                  <option key={o.id} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={notes ?? ""}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Contexte pour le conseiller..."
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex justify-between gap-2">
            <div>
              {call.transferredBy && (
                <button type="button" onClick={cancelTransfer} disabled={saving}
                  className="btn btn-secondary text-xs">
                  Annuler le transfert
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn btn-secondary">Fermer</button>
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? "Transfert..." : "Transférer"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
