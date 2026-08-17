"use client";
import { useSession } from "next-auth/react";
import UserCallHistory from "@/components/ui/UserCallHistory";

/**
 * "Mes appels" — the coach's own line, as opposed to /superviseur/appels which
 * covers the whole team.
 *
 * Reuses the same drill-down component as /superviseur/equipe/[id], pointed at
 * the coach themselves, so the metrics, date filters, qualification and
 * transfer actions behave identically. Scoping and caller-number masking are
 * enforced server-side by /api/calls?userId=…, which lets a coach ask about
 * themselves and nobody else outside their roster.
 */
export default function CoachDirectCallsPage() {
  const { data: session, status } = useSession();
  const currentUserId = (session?.user as { userId?: string } | undefined)?.userId;

  if (status === "loading") {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="h-8 w-48 bg-slate-100 rounded-lg animate-pulse mb-5" />
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
        <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!currentUserId) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="card p-8 text-center text-sm text-slate-500">
          Session expirée. Veuillez vous reconnecter.
        </div>
      </div>
    );
  }

  return (
    <UserCallHistory
      userId={currentUserId}
      heading="Mes appels directs"
      subtitle="Appels reçus sur votre ligne, y compris ceux transférés à un conseiller"
      currentUserId={currentUserId}
      allowTransfer
    />
  );
}
