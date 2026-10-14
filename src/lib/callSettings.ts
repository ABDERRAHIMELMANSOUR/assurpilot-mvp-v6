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
 * Turns a database failure on the routing endpoints into a message that says
 * what to do, instead of the shared handler's bare "Erreur de base de données".
 *
 * Those endpoints are for coaches and administrators, so naming the Prisma code
 * and the table or column involved costs nothing and is the difference between
 * "something is wrong" and a one-line fix. (Codes and object names, never the
 * query or its values.) Anything that is not a recognised database error is
 * returned untouched for the shared handler to deal with.
 *
 *   P2021  table missing          -> which migration to run
 *   P2022  column missing         -> the database is out of step with the schema
 *   P2024 / P2037 / P1017         -> connection pool exhausted or dropped
 *   other known Prisma errors     -> reported WITH their code
 */
export function explainDbError(error: unknown): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;

  const meta = error.meta ?? {};
  const where = [meta.table, meta.column, meta.modelName].filter(Boolean).join(" / ");

  switch (error.code) {
    case "P2021": {
      const table = String(meta.table ?? "");
      return new ApiError(
        503,
        table.includes("advisor_call_applied")
          ? "Cette page nécessite une migration : exécutez prisma/sql/007-advisor-call-applied.sql."
          : "Les réglages d'appels ne sont pas encore disponibles : exécutez prisma/sql/006-advisor-call-settings.sql."
      );
    }
    case "P2022":
      return new ApiError(
        503,
        `Colonne manquante en base${where ? ` (${where})` : ""} : une table est incomplète. ` +
          "Relancez prisma/sql/006-advisor-call-settings.sql puis 007-advisor-call-applied.sql, même s'ils ont " +
          "déjà été exécutés : ils réparent une table partielle."
      );
    case "P2024":
    case "P2037":
    case "P1017":
      return new ApiError(
        503,
        `Connexion à la base saturée ou interrompue (Prisma ${error.code}). Réessayez dans un instant ; ` +
          "si cela persiste, vérifiez la limite de connexions de DATABASE_URL (connection_limit=1 avec le pooler)."
      );
    // Codes the shared handler already answers precisely (duplicate, bad reference, not found).
    case "P2002":
    case "P2003":
    case "P2025":
      return error;
    default:
      return new ApiError(500, `Erreur de base de données (Prisma ${error.code}${where ? ` — ${where}` : ""})`);
  }
}
