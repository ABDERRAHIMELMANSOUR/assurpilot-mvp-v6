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
      // NextAuth reports a rejected credential as "CredentialsSignin". Anything
      // else (Configuration, a thrown AuthConfigurationError, a 500) means the
      // server is misconfigured — saying "wrong password" there sends you
      // hunting for the wrong problem entirely.
      setError(
        res.error === "CredentialsSignin"
          ? "Email ou mot de passe incorrect."
          : "Connexion au serveur impossible. Vérifiez la configuration " +
            "(base de données, variables d'environnement) — consultez /api/health."
      );
      setLoading(false);
    } else {
      router.push("/"); router.refresh();
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden
                    bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800">
      {/* Ambient cyan glow behind the card */}
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-32 w-[28rem] h-[28rem] rounded-full bg-brand-500/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 w-[24rem] h-[24rem] rounded-full bg-indigo-500/20 blur-3xl" />

      <div className="relative w-full max-w-sm animate-fade-rise">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow flex items-center justify-center">
              <svg className="w-5 h-5 text-navy-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <span className="text-xl font-semibold text-white tracking-tight">AssurPilot</span>
          </div>
          <p className="text-sm text-slate-400">Gestion des appels entrants</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.07] backdrop-blur-xl p-6
                        shadow-[0_20px_60px_-20px_rgb(0_0_0_/_0.6)]">
          <h1 className="text-lg font-semibold text-white mb-1">Connexion</h1>
          <p className="text-sm text-slate-400 mb-6">Accédez à votre espace de travail</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Adresse email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.fr" required
                className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-500
                           bg-white/5 border border-white/10
                           focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" required
                className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-500
                           bg-white/5 border border-white/10
                           focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition" />
            </div>
            {error && (
              <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
            )}
            <button type="submit" disabled={loading}
              className="w-full inline-flex items-center justify-center rounded-xl py-2.5 text-sm font-semibold
                         text-navy-950 bg-gradient-to-r from-brand-400 to-brand-600 shadow-glow
                         transition-all duration-150 hover:scale-[1.02] hover:brightness-105
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900
                         disabled:opacity-60 disabled:pointer-events-none">
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
