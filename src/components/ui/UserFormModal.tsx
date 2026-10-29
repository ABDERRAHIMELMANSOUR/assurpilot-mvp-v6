"use client";
import { useState, useEffect } from "react";
import { errorMessage, fetchJson, fetchJsonOr } from "@/lib/fetchJson";

type Team  = { id: string; nom: string };
// Field names mirror the /api/users payload: nom, prenom, phoneNumber.
type Coach = { id: string; prenom: string; nom: string; phoneNumber?: string; isActive: boolean };

type UserPayload = {
  prenom: string;
  nom: string;
  email: string;
  phoneNumber: string;
  isActive: boolean;
  password?: string;
  role?: string;
  teamId?: string | null;
  superviseurId?: string | null;
};

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
  // ProAssur (Auto CRM): the adviser's couple ID_US + ID_EQ (their ProAssur team), entered by
  // the admin and saved apart from the account.
  const [idUs,        setIdUs]        = useState("");
  const [idUsLoaded,  setIdUsLoaded]  = useState("");
  const [idEq,        setIdEq]        = useState("");
  const [idEqLoaded,  setIdEqLoaded]  = useState("");
  const [teamIdEq,    setTeamIdEq]    = useState<Record<string, string>>({});
  const [error,       setError]       = useState("");

  const isAdmin = currentUserRole === "ADMINISTRATEUR";

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    // These two dropdowns are optional context — a failure must not break the form.
    void (async () => {
      const [teamList, coachList] = await Promise.all([
        fetchJsonOr<Team[]>([], "/api/teams"),
        fetchJsonOr<Coach[]>([], "/api/users?role=SUPERVISEUR"),
      ]);
      if (cancelled) return;
      setTeams(Array.isArray(teamList) ? teamList : []);
      setCoachs(Array.isArray(coachList) ? coachList.filter((c) => c.isActive) : []);
    })();

    return () => { cancelled = true; };
  }, [isAdmin]);

  // Auto teams' ID_EQ, and the current ID_US of the adviser being edited.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      const data = await fetchJsonOr<{ teams: Array<{ id: string; idEq: string }>; advisers: Array<{ id: string; idUs: string; idEq: string }> }>(
        { teams: [], advisers: [] }, "/api/admin/proassur/ids"
      );
      if (cancelled) return;
      setTeamIdEq(Object.fromEntries(data.teams.map((t) => [t.id, t.idEq])));
      const current = mode === "edit" ? data.advisers.find((a) => a.id === initialData?.id) : undefined;
      setIdUs(current?.idUs ?? ""); setIdUsLoaded(current?.idUs ?? "");
      setIdEq(current?.idEq ?? ""); setIdEqLoaded(current?.idEq ?? "");
    })();
    return () => { cancelled = true; };
  }, [isAdmin, mode, initialData?.id]);

  // Only for an Auto team (ProAssur); Santé advisers are not concerned.
  const isAutoTeam = isAdmin && !!teamId && teamId in teamIdEq;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!prenom.trim() || !nom.trim() || !email.trim()) {
      setError("Prénom, nom et email sont obligatoires.");
      return;
    }
    if (mode === "create" && !password) {
      setError("Le mot de passe est obligatoire lors de la création.");
      return;
    }

    const body: UserPayload = {
      prenom: prenom.trim(),
      nom: nom.trim(),
      email: email.trim(),
      phoneNumber: phoneNumber.trim(),
      isActive,
    };
    if (password) body.password = password;
    if (isAdmin) {
      body.role          = targetRole;
      body.teamId        = teamId || null;
      body.superviseurId = coachId || null;
    }

    const url    = mode === "create" ? "/api/users" : `/api/users/${initialData!.id}`;
    const method = mode === "create" ? "POST" : "PUT";

    for (const [label, v] of [["ID_US", idUs], ["ID_EQ", idEq]] as const) {
      if (isAutoTeam && v.trim() && !/^[A-Za-z0-9 _.\-]{1,40}$/.test(v.trim())) {
        setError(`${label} : lettres, chiffres, espace, « _ », « . » ou « - », 40 caractères au plus.`);
        return;
      }
    }

    setSaving(true);
    try {
      const saved = await fetchJson<{ id?: string }>(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const userId = mode === "create" ? saved?.id : initialData!.id;
      const ids: Record<string, string> = {};
      if (idUs.trim() !== idUsLoaded) ids.idUs = idUs.trim();
      if (idEq.trim() !== idEqLoaded) ids.idEq = idEq.trim();
      if (isAutoTeam && userId && Object.keys(ids).length) {
        try {
          await fetchJson("/api/admin/proassur/ids", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, ...ids }),
          });
        } catch (err) {
          // The account is saved; say clearly that only the ID_US is missing.
          setError(errorMessage(err, "Conseiller enregistré, mais ID_US / ID_EQ non enregistrés : saisissez-les sur Intégration ProAssur."));
          setSaving(false);
          onSaved();
          return;
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Erreur lors de l'enregistrement."));
      setSaving(false);
    }
  }

  const roleLabel = targetRole === "CONSEILLER" ? "Conseiller" : "Coach";
  const title     = mode === "create" ? `Nouveau ${roleLabel}` : `Modifier le ${roleLabel}`;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Prénom *</label>
                <input type="text" value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Marie"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nom *</label>
                <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Laurent"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
              </div>
            </div>

            {/* Phone — primary identity */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Numéro de téléphone *
                <span className="ml-1 text-xs text-brand-600 font-normal">(identifiant principal)</span>
              </label>
              <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+33 6 12 34 56 78"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400" />
              {targetRole === "CONSEILLER" && (
                <p className="text-xs text-slate-400 mt-1">
                  Ce numéro est utilisé pour identifier le conseiller lors des imports automatiques.
                </p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email <span className="text-slate-400 font-normal">(pour la connexion)</span> *
              </label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="marie@assurpilot.fr"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Mot de passe
                {mode === "edit" && <span className="text-slate-400 font-normal ml-1">(vide = inchangé)</span>}
                {mode === "create" && " *"}
              </label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "create" ? "••••••••" : "Nouveau mot de passe (optionnel)"}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>

            {/* Admin-only: team + coach */}
            {isAdmin && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Équipe</label>
                  <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400">
                    <option value="">— Aucune équipe —</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
                  </select>
                </div>
                {isAutoTeam && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm font-medium text-slate-700">ProAssur <span className="text-slate-400 font-normal">(service Auto)</span></p>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">ID_US du conseiller</label>
                        <input type="text" value={idUs} onChange={(e) => setIdUs(e.target.value)} placeholder="Id dans ProAssur" maxLength={40}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">ID_EQ (équipe ProAssur)</label>
                        <input type="text" value={idEq} onChange={(e) => setIdEq(e.target.value)} maxLength={40}
                          placeholder={teamIdEq[teamId] ? `${teamIdEq[teamId]} (équipe)` : "Id équipe ProAssur"}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400" />
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Le couple ID_US / ID_EQ du conseiller dans ProAssur (ID_EQ = son équipe ProAssur).</p>
                  </div>
                )}
                {targetRole === "CONSEILLER" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Coach assigné</label>
                    <select value={coachId} onChange={(e) => setCoachId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400">
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
              <div className="flex items-center justify-between py-2 border-t border-slate-100">
                <div>
                  <p className="text-sm font-medium text-slate-700">Compte actif</p>
                  <p className="text-xs text-slate-400">Un compte inactif ne peut plus se connecter</p>
                </div>
                <button type="button" onClick={() => setIsActive(!isActive)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${isActive ? "bg-blue-600" : "bg-slate-300"}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${isActive ? "left-5" : "left-1"}`} />
                </button>
              </div>
            )}

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-700">{error}</div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
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
