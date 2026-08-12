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

/** Matches team names belonging to an entity, optionally narrowed to a sub-team. */
function teamNameFilter(entity: Entity, subTeam?: SubTeam | null): Prisma.TeamWhereInput {
  const clauses: Prisma.TeamWhereInput[] = [
    { nom: { contains: entity, mode: "insensitive" } },
  ];
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
