// src/lib/entity.ts
//
// CPA / ALM is an organisational split over the existing teams, not a new
// column: the four teams are already named "Équipe auto CPA", "Équipe sante
// CPA", "Équipe auto ALM", "Équipe sante ALM". Deriving the entity from the
// team name keeps the database exactly as it is — no migration, no backfill,
// no risk to existing rows.
import type { Prisma } from "@prisma/client";

export const ENTITIES = ["CPA", "ALM"] as const;
export type Entity = (typeof ENTITIES)[number];

export const SUB_TEAMS = ["AUTO", "SANTE"] as const;
export type SubTeam = (typeof SUB_TEAMS)[number];

export function isEntity(value: string | null | undefined): value is Entity {
  return value === "CPA" || value === "ALM";
}

export function isSubTeam(value: string | null | undefined): value is SubTeam {
  return value === "AUTO" || value === "SANTE";
}

/** Strips accents and upper-cases, so "santé" and "sante" compare equal. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/** The entity a team name belongs to, or null when it names neither. */
export function entityOfTeamName(nom: string | null | undefined): Entity | null {
  if (!nom) return null;
  const folded = fold(nom);
  if (/\bCPA\b/.test(folded)) return "CPA";
  if (/\bALM\b/.test(folded)) return "ALM";
  return null;
}

/** Auto vs Santé within an entity. */
export function subTeamOfTeamName(nom: string | null | undefined): SubTeam | null {
  if (!nom) return null;
  const folded = fold(nom);
  if (/\bAUTO\b/.test(folded)) return "AUTO";
  if (/\bSANTE\b/.test(folded)) return "SANTE";
  return null;
}

/** Human label for a sub-team. */
export const SUB_TEAM_LABEL: Record<SubTeam, string> = {
  AUTO: "Auto",
  SANTE: "Santé",
};

/**
 * Matches team names by entity and/or sub-team. Either half may be omitted, so
 * "all entities + Auto only" and "CPA + all lines" are both expressible.
 */
function teamNameFilter(entity: Entity | null, subTeam?: SubTeam | null): Prisma.TeamWhereInput {
  const clauses: Prisma.TeamWhereInput[] = [];
  if (entity) clauses.push({ nom: { contains: entity, mode: "insensitive" } });
  if (subTeam === "AUTO") clauses.push({ nom: { contains: "auto", mode: "insensitive" } });
  // "sante" matches "Santé" too: Postgres ILIKE is accent-sensitive, so cover
  // both spellings rather than assuming how the team was typed.
  if (subTeam === "SANTE") {
    clauses.push({
      OR: [
        { nom: { contains: "sante", mode: "insensitive" } },
        { nom: { contains: "santé", mode: "insensitive" } },
      ],
    });
  }
  return { AND: clauses };
}

/** Users belonging to an entity, via their team. */
export function userEntityWhere(entity: Entity, subTeam?: SubTeam | null): Prisma.UserWhereInput {
  return { team: teamNameFilter(entity, subTeam) };
}

/**
 * Users narrowed by entity and/or sub-team. Returns an empty clause when
 * neither is set, so it can always be AND-ed into a wider query.
 */
export function userScopeWhere(
  entity: Entity | null,
  subTeam: SubTeam | null
): Prisma.UserWhereInput {
  if (!entity && !subTeam) return {};
  return { team: teamNameFilter(entity, subTeam) };
}

/**
 * Reads the "line / product" dropdown. The UI labels it Auto / Santé, so accept
 * those spellings (accented or not, any case) alongside the canonical values,
 * and `subTeam` as an alias for consistency with /api/calls.
 */
export function parseSubTeam(raw: string | null | undefined): SubTeam | null {
  if (!raw) return null;
  const folded = fold(raw).trim();
  if (folded === "AUTO") return "AUTO";
  if (folded === "SANTE") return "SANTE";
  return null;
}

/** Reads the entity dropdown; returns null for "all entities". */
export function parseEntity(raw: string | null | undefined): Entity | null {
  if (!raw) return null;
  const folded = fold(raw).trim();
  return folded === "CPA" ? "CPA" : folded === "ALM" ? "ALM" : null;
}

/**
 * Calls belonging to an entity.
 *
 * Checks the call's own team first (stamped at import), then falls back to the
 * team that owns its phone line — calls imported before team routing existed
 * have a null teamId but still sit on a routed line.
 */
export function callEntityWhere(entity: Entity, subTeam?: SubTeam | null): Prisma.CallWhereInput {
  const team = teamNameFilter(entity, subTeam);
  return { OR: [{ team }, { phoneLine: { team } }] };
}
