// src/lib/routingState.ts
//
// What a coach REQUESTED for an adviser's call routing versus what has been
// APPLIED on the telephony system, and the work that gap represents.
//
// Pure and import-free on purpose: the admin API and the admin page both use it,
// and the page must not pull the Prisma client into the browser bundle. Having
// one definition of "needs a change on the PBX" also means the summary cards,
// the filter chips, the badges and the export cannot disagree about it.

export type RoutingSettings = { isActiveForCalls: boolean; isBoosted: boolean };

/** What an adviser nobody has touched gets — requested AND applied. */
export const DEFAULT_ROUTING: RoutingSettings = { isActiveForCalls: true, isBoosted: false };

/** The change to make on the PBX for incoming calls, if any. */
export type ActivationTask = "ACTIVER" | "COUPER" | null;
/** The change to make on the PBX for the boost, if any. */
export type BoostTask = "BOOSTER" | "RETIRER" | null;

export type PendingChanges = { activation: ActivationTask; boost: BoostTask };

/** Requested vs applied -> the tasks an administrator still has to perform. */
export function pendingChanges(requested: RoutingSettings, applied: RoutingSettings): PendingChanges {
  return {
    activation:
      requested.isActiveForCalls === applied.isActiveForCalls
        ? null
        : requested.isActiveForCalls ? "ACTIVER" : "COUPER",
    boost:
      requested.isBoosted === applied.isBoosted
        ? null
        : requested.isBoosted ? "BOOSTER" : "RETIRER",
  };
}

export function hasPending(p: PendingChanges): boolean {
  return p.activation !== null || p.boost !== null;
}

export const ACTIVATION_LABEL: Record<Exclude<ActivationTask, null>, string> = {
  ACTIVER: "Activer les appels sur le standard",
  COUPER: "Couper les appels sur le standard",
};

export const BOOST_LABEL: Record<Exclude<BoostTask, null>, string> = {
  BOOSTER: "Booster sur le standard",
  RETIRER: "Retirer le boost sur le standard",
};

/** One line describing the outstanding work, or "Appliqué". */
export function pendingSummary(p: PendingChanges): string {
  const parts = [
    p.activation ? ACTIVATION_LABEL[p.activation] : null,
    p.boost ? BOOST_LABEL[p.boost] : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Appliqué";
}

/** One adviser as the admin page sees them. */
export type AdminAdviserRow = {
  id: string;
  nom: string;
  prenom: string;
  phoneNumber: string;
  /** The ACCOUNT is active; a deactivated account has no editable routing. */
  isActive: boolean;
  team: string | null;
  coach: { id: string; nom: string; prenom: string } | null;
  requested: RoutingSettings;
  applied: RoutingSettings;
  pending: PendingChanges;
  /** Last change to the REQUEST — by a coach, or by an admin override. */
  requestedAt: string | null;
  requestedBy: { nom: string; prenom: string; role: string } | null;
  appliedAt: string | null;
  appliedBy: { nom: string; prenom: string } | null;
};
