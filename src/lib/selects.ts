// src/lib/selects.ts
//
// Shared Prisma `select` shapes.
//
// These live outside `route.ts` files on purpose: Next.js validates the exports
// of a route module and rejects any export that is not a route handler or a
// recognised segment config, so a constant re-exported from `route.ts` breaks
// `next build` with a "not a valid Route export field" type error.

/**
 * Public shape of a user returned by /api/users.
 * Field names mirror the Prisma model exactly (`nom`, `prenom`, `phoneNumber`)
 * so the API payload lines up with UsersTable / UserFormModal without mapping.
 */
export const USER_SELECT = {
  id: true,
  nom: true,
  prenom: true,
  email: true,
  phoneNumber: true,
  role: true,
  isActive: true,
  teamId: true,
  superviseurId: true,
  createdAt: true,
  lastLoginAt: true,
  team: { select: { id: true, nom: true } },
  superviseur: { select: { id: true, nom: true, prenom: true, phoneNumber: true } },
} as const;

/** Compact user shape embedded in call payloads. */
export const CALL_USER_SELECT = {
  id: true,
  nom: true,
  prenom: true,
  phoneNumber: true,
} as const;
