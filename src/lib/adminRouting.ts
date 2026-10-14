// src/lib/adminRouting.ts
//
// Loads advisers with their requested and applied call routing, shaped for the
// admin page. Used by the list endpoint AND by every mutation that returns rows,
// so what a write answers with is computed exactly as a fresh read would be.
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_ROUTING,
  pendingChanges,
  type AdminAdviserRow,
} from "@/lib/routingState";

const ADVISER_SELECT = {
  id: true,
  nom: true,
  prenom: true,
  phoneNumber: true,
  isActive: true,
  team: { select: { nom: true } },
  superviseur: { select: { id: true, nom: true, prenom: true } },
  callSettings: {
    select: { isActiveForCalls: true, isBoosted: true, updatedAt: true, updatedById: true },
  },
  callApplied: {
    select: { isActiveForCalls: true, isBoosted: true, appliedAt: true, appliedById: true },
  },
} as const;

/**
 * Every conseiller (or just `ids`), with requested vs applied routing.
 * An adviser with no settings row is on the defaults on both sides — in sync.
 */
export async function loadAdviserRows(ids?: string[]): Promise<AdminAdviserRow[]> {
  const advisers = await prisma.user.findMany({
    where: { role: "CONSEILLER", ...(ids ? { id: { in: ids } } : {}) },
    select: ADVISER_SELECT,
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
  });

  // updatedById / appliedById are plain columns, not relations: resolve the
  // names in one extra query instead of one per row.
  const actorIds = new Set<string>();
  for (const a of advisers) {
    if (a.callSettings?.updatedById) actorIds.add(a.callSettings.updatedById);
    if (a.callApplied?.appliedById) actorIds.add(a.callApplied.appliedById);
  }
  const actors = actorIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...actorIds] } },
        select: { id: true, nom: true, prenom: true, role: true },
      })
    : [];
  const actorById = new Map(actors.map((u) => [u.id, u]));

  return advisers.map((a) => {
    const s = a.callSettings;
    const ap = a.callApplied;
    const requested = s
      ? { isActiveForCalls: s.isActiveForCalls, isBoosted: s.isBoosted }
      : DEFAULT_ROUTING;
    const applied = ap
      ? { isActiveForCalls: ap.isActiveForCalls, isBoosted: ap.isBoosted }
      : DEFAULT_ROUTING;

    const requestedBy = s?.updatedById ? actorById.get(s.updatedById) : undefined;
    const appliedBy = ap?.appliedById ? actorById.get(ap.appliedById) : undefined;

    return {
      id: a.id,
      nom: a.nom,
      prenom: a.prenom,
      phoneNumber: a.phoneNumber,
      isActive: a.isActive,
      team: a.team?.nom ?? null,
      coach: a.superviseur,
      requested,
      applied,
      pending: pendingChanges(requested, applied),
      requestedAt: s ? s.updatedAt.toISOString() : null,
      requestedBy: requestedBy
        ? { nom: requestedBy.nom, prenom: requestedBy.prenom, role: requestedBy.role }
        : null,
      appliedAt: ap ? ap.appliedAt.toISOString() : null,
      appliedBy: appliedBy ? { nom: appliedBy.nom, prenom: appliedBy.prenom } : null,
    };
  });
}
