"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setError("Email ou mot de passe incorrect.");
      setLoading(false);
    } else {
      router.push("/"); router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <span className="text-xl font-semibold text-gray-900">AssurPilot</span>
          </div>
          <p className="text-sm text-gray-500">Gestion des appels entrants</p>
        </div>

        <div className="card p-6">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Connexion</h1>
          <p className="text-sm text-gray-500 mb-6">Accédez à votre espace de travail</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Adresse email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.fr" required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <button type="submit" disabled={loading}
              className="w-full btn btn-primary justify-center py-2.5">
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        </div>

        <div className="mt-4 card p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Comptes de test</p>
          <div className="space-y-1.5 text-xs text-gray-600">
            {[
              { role: "Admin",      email: "admin@assurpilot.fr",         pw: "admin123", color: "bg-purple-100 text-purple-700" },
              { role: "Coach",      email: "coach@assurpilot.fr",         pw: "coach123", color: "bg-orange-100 text-orange-700" },
              { role: "Conseiller", email: "marie.laurent@assurpilot.fr", pw: "agent123", color: "bg-blue-100 text-blue-700"    },
              { role: "Conseiller", email: "pierre.durand@assurpilot.fr", pw: "agent123", color: "bg-blue-100 text-blue-700"    },
            ].map((a) => (
              <div key={a.email}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded p-1 -mx-1"
                onClick={() => { setEmail(a.email); setPassword(a.pw); }}>
                <span className={`badge ${a.color}`}>{a.role}</span>
                <span className="font-mono text-gray-500">{a.email}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Cliquez pour remplir automatiquement</p>
        </div>
      </div>
    </div>
  );
}
