"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type Profile = {
  id: string; email: string; nom: string; prenom: string;
  phoneNumber: string; role: string;
  team?: { nom: string } | null;
  superviseur?: { nom: string; prenom: string } | null;
  createdAt: string; lastLoginAt: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  CONSEILLER:     "Conseiller",
  SUPERVISEUR:    "Coach",
  ADMINISTRATEUR: "Administrateur",
};
const ROLE_CLS: Record<string, string> = {
  CONSEILLER:     "badge-blue",
  SUPERVISEUR:    "badge-yellow",
  ADMINISTRATEUR: "badge-gray",
};

export default function ProfilPage() {
  const { data: session, update: updateSession } = useSession();

  const [profile,  setProfile]  = useState<Profile | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [success,  setSuccess]  = useState("");
  const [error,    setError]    = useState("");

  // Form state
  const [prenom,          setPrenom]          = useState("");
  const [nom,             setNom]             = useState("");
  const [email,           setEmail]           = useState("");
  const [phoneNumber,     setPhoneNumber]     = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword,     setNewPassword]     = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwSection,   setShowPwSection]   = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        setProfile(d);
        setPrenom(d.prenom ?? "");
        setNom(d.nom ?? "");
        setEmail(d.email ?? "");
        setPhoneNumber(d.phoneNumber ?? "");
        setLoading(false);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");

    if (showPwSection && newPassword && newPassword !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    if (showPwSection && newPassword && newPassword.length < 6) {
      setError("Le nouveau mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    setSaving(true);
    try {
      const body: any = { nom, prenom, email, phoneNumber };
      if (showPwSection && newPassword) {
        body.currentPassword = currentPassword;
        body.newPassword     = newPassword;
      }

      const res  = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur lors de la sauvegarde."); return; }

      setProfile((p) => p ? { ...p, ...data } : data);
      setSuccess("Profil mis à jour avec succès.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setShowPwSection(false);

      // Refresh session name if name changed
      await updateSession({ name: `${data.prenom} ${data.nom}` });
    } catch { setError("Erreur réseau."); }
    finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="h-8 bg-gray-100 rounded w-48 mb-6 animate-pulse" />
        <div className="card p-6 space-y-4 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Mon profil</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Gérez vos informations personnelles et vos paramètres de connexion
        </p>
      </div>

      {/* Profile card */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-lg font-semibold text-blue-700 flex-shrink-0">
            {profile?.prenom?.[0]}{profile?.nom?.[0]}
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-base">{profile?.prenom} {profile?.nom}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`badge text-xs ${ROLE_CLS[profile?.role ?? "CONSEILLER"]}`}>
                {ROLE_LABEL[profile?.role ?? "CONSEILLER"]}
              </span>
              {profile?.team && (
                <span className="text-xs text-gray-400">{profile.team.nom}</span>
              )}
            </div>
            {profile?.superviseur && (
              <p className="text-xs text-gray-400 mt-0.5">
                Coach : {profile.superviseur.prenom} {profile.superviseur.nom}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3 text-xs text-gray-500">
          <div>
            <p className="font-medium text-gray-600 mb-0.5">Membre depuis</p>
            <p>{profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—"}</p>
          </div>
          <div>
            <p className="font-medium text-gray-600 mb-0.5">Dernière connexion</p>
            <p>{profile?.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Jamais"}</p>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <form onSubmit={handleSave} className="space-y-5">
        {/* Identity */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 pb-2 border-b border-gray-100">
            Informations personnelles
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prénom *</label>
              <input type="text" value={prenom} onChange={(e) => setPrenom(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
              <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Numéro de téléphone
              <span className="ml-1 text-xs text-blue-600 font-normal">(identifiant pour les imports)</span>
            </label>
            <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+33 6 12 34 56 78"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Adresse email <span className="text-gray-400 font-normal">(pour la connexion)</span>
            </label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* Password section */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Mot de passe</h2>
            <button type="button" onClick={() => { setShowPwSection(!showPwSection); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }}
              className="text-xs text-blue-600 hover:underline">
              {showPwSection ? "Annuler" : "Modifier"}
            </button>
          </div>

          {!showPwSection ? (
            <p className="text-sm text-gray-400">••••••••••••</p>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe actuel *</label>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Votre mot de passe actuel"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nouveau mot de passe *</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Au moins 6 caractères"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirmer le mot de passe *</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Répéter le nouveau mot de passe"
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    confirmPassword && newPassword !== confirmPassword
                      ? "border-red-300 bg-red-50"
                      : "border-gray-200"
                  }`} />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-red-500 mt-1">Les mots de passe ne correspondent pas</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Feedback */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
            ✅ {success}
          </div>
        )}

        <button type="submit" disabled={saving} className="btn btn-primary w-full justify-center py-2.5">
          {saving ? "Enregistrement..." : "Enregistrer les modifications"}
        </button>
      </form>
    </div>
  );
}
