"use client";
import { useState, useEffect } from "react";

type Team  = { id: string; nom: string };
type Coach = { id: string; prenom: string; nom: string; phoneNumber?: string };

interface UserFormModalProps {
  mode: "create" | "edit";
  targetRole: "CONSEILLER" | "SUPERVISEUR";
  currentUserRole: string;
  currentUserTeamId?: string;
  currentUserId?: string;
  initialData?: {
    id: string; email: string; nom: string; prenom: string;
    phoneNumber?: string; role: string;
    teamId?: string | null; superviseurId?: string | null; isActive: boolean;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function UserFormModal({
  mode, targetRole, currentUserRole, initialData, onClose, onSaved,
}: UserFormModalProps) {
  const [prenom,      setPrenom]      = useState(initialData?.prenom      ?? "");
  const [nom,         setNom]         = useState(initialData?.nom         ?? "");
  const [phoneNumber, setPhoneNumber] = useState(initialData?.phoneNumber ?? "");
  const [email,       setEmail]       = useState(initialData?.email       ?? "");
  const [password,    setPassword]    = useState("");
  const [teamId,      setTeamId]      = useState(initialData?.teamId      ?? "");
  const [coachId,     setCoachId]     = useState(initialData?.superviseurId ?? "");
  const [isActive,    setIsActive]    = useState(initialData?.isActive    ?? true);
  const [teams,       setTeams]       = useState<Team[]>([]);
  const [coachs,      setCoachs]      = useState<Coach[]>([]);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");

  const isAdmin = currentUserRole === "ADMINISTRATEUR";

  useEffect(() => {
    if (isAdmin) {
      fetch("/api/teams").then((r) => r.json()).then((d) => setTeams(Array.isArray(d) ? d : []));
      fetch("/api/users?role=SUPERVISEUR").then((r) => r.json())
        .then((d) => setCoachs(Array.isArray(d) ? d.filter((u: any) => u.isActive) : []));
    }
  }, [isAdmin]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError("");
    if (!prenom.trim() || !nom.trim() || !email.trim()) {
      setError("Prénom, nom et email sont obligatoires.");
      setSaving(false); return;
    }
    if (mode === "create" && !password) {
      setError("Le mot de passe est obligatoire lors de la création.");
      setSaving(false); return;
    }
    const body: any = { prenom, nom, email, phoneNumber, isActive };
    if (password) body.password = password;
    if (isAdmin) {
      body.role          = targetRole;
      body.teamId        = teamId || null;
      body.superviseurId = coachId || null;
    }
    const url    = mode === "create" ? "/api/users" : `/api/users/${initialData!.id}`;
    const method = mode === "create" ? "POST" : "PUT";
    try {
      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur lors de l'enregistrement."); setSaving(false); return; }
      onSaved(); onClose();
    } catch { setError("Erreur réseau."); setSaving(false); }
  }

  const roleLabel = targetRole === "CONSEILLER" ? "Conseiller" : "Coach";
  const title     = mode === "create" ? `Nouveau ${roleLabel}` : `Modifier le ${roleLabel}`;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">

            {/* Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prénom *</label>
                <input type="text" value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Marie"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Laurent"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* Phone — primary identity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Numéro de téléphone *
                <span className="ml-1 text-xs text-blue-600 font-normal">(identifiant principal)</span>
              </label>
              <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+33 6 12 34 56 78"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {targetRole === "CONSEILLER" && (
                <p className="text-xs text-gray-400 mt-1">
                  Ce numéro est utilisé pour identifier le conseiller lors des imports automatiques.
                </p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email <span className="text-gray-400 font-normal">(pour la connexion)</span> *
              </label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="marie@assurpilot.fr"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mot de passe
                {mode === "edit" && <span className="text-gray-400 font-normal ml-1">(vide = inchangé)</span>}
                {mode === "create" && " *"}
              </label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "create" ? "••••••••" : "Nouveau mot de passe (optionnel)"}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* Admin-only: team + coach */}
            {isAdmin && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Équipe</label>
                  <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Aucune équipe —</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
                  </select>
                </div>
                {targetRole === "CONSEILLER" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Coach assigné</label>
                    <select value={coachId} onChange={(e) => setCoachId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">— Aucun coach —</option>
                      {coachs.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.prenom} {c.nom}{c.phoneNumber ? ` · ${c.phoneNumber}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Active toggle (edit only) */}
            {mode === "edit" && (
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-700">Compte actif</p>
                  <p className="text-xs text-gray-400">Un compte inactif ne peut plus se connecter</p>
                </div>
                <button type="button" onClick={() => setIsActive(!isActive)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${isActive ? "bg-blue-600" : "bg-gray-300"}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${isActive ? "left-5" : "left-1"}`} />
                </button>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-secondary">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? "Enregistrement..." : mode === "create" ? `Créer le ${roleLabel}` : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
