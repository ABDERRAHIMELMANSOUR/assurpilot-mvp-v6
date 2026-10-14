// src/lib/callSettings.ts
//
// The per-advisor call-distribution switches a coach controls, and the rules
// that keep the two of them consistent. Kept out of the route files so the
// rules have exactly one home and can be reasoned about on their own.
import { Prisma } from "@prisma/client";
import { ApiError, badRequest, conflict } from "@/lib/api";

/** What an adviser with no row yet gets: taking calls, not boosted. */
export const DEFAULT_CALL_SETTINGS = { isActiveForCalls: true, isBoosted: false } as const;

export type CallSettings = { isActiveForCalls: boolean; isBoosted: boolean };

/** The fields a coach may change; either or both. */
export type CallSettingsPatch = Partial<CallSettings>;

/**
 * Validates a request body into a patch. Anything that is not a plain boolean
 * is refused rather than coerced: `"false"` is truthy in JavaScript, and
 * silently turning a string into a switch position is how an adviser ends up
 * enabled by a typo.
 */
export function parseCallSettingsPatch(body: unknown): CallSettingsPatch {
  if (typeof body !== "object" || body === null) {
    throw badRequest("Corps de requête invalide");
  }
  const raw = body as Record<string, unknown>;
  const patch: CallSettingsPatch = {};

  for (const key of ["isActiveForCalls", "isBoosted"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") throw badRequest(`${key} doit être un booléen`);
    patch[key] = raw[key] as boolean;
  }

  if (patch.isActiveForCalls === undefined && patch.isBoosted === undefined) {
    throw badRequest("Aucun réglage à modifier");
  }
  return patch;
}

/**
 * Applies a patch to the current settings and enforces the one rule that ties
 * the switches together: an adviser who is not taking calls cannot be boosted.
 *
 *   - switching incoming calls OFF also clears the boost, as one change — the
 *     response tells the UI, so it never shows "boosted" on a muted adviser;
 *   - asking to boost an adviser who is (or is being made) inactive is refused.
 */
export function resolveCallSettings(current: CallSettings, patch: CallSettingsPatch): CallSettings {
  const isActiveForCalls = patch.isActiveForCalls ?? current.isActiveForCalls;
  let isBoosted = patch.isBoosted ?? current.isBoosted;

  if (!isActiveForCalls) {
    if (patch.isBoosted === true) {
      throw conflict("Impossible de booster un conseiller dont les appels entrants sont désactivés");
    }
    isBoosted = false;
  }
  return { isActiveForCalls, isBoosted };
}

/**
 * Two tables back this feature: advisor_call_settings (prisma/sql/006, the
 * coach's requests) and advisor_call_applied (prisma/sql/007, what an admin has
 * applied on the PBX). Until one has been created Prisma raises P2021; name the
 * file that fixes it rather than surfacing a generic 500.
 */
export function asMigrationPending(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
    const table = String(error.meta?.table ?? "");
    return new ApiError(
      503,
      table.includes("advisor_call_applied")
        ? "Cette page nécessite une migration : exécutez prisma/sql/007-advisor-call-applied.sql."
        : "Les réglages d'appels ne sont pas encore disponibles : exécutez prisma/sql/006-advisor-call-settings.sql."
    );
  }
  return error;
}
