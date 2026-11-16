// src/lib/callFilters.ts
//
// The filter set shared by GET /api/calls and the Excel export, so an export
// always contains exactly the rows the screen is showing.
import type { Prisma } from "@prisma/client";
import { buildDateRange, defaultPeriodFor } from "@/lib/dates";
import { callEntityWhere, callSubTeamWhere, callTeamWhere, isEntity, parseSubTeam } from "@/lib/entity";
import { badRequest } from "@/lib/api";

/**
 * Reads the line / product dropdown under any of the spellings in use:
 * `lineType` is what ScopeFilter sends, `subTeam` is what /api/calls was first
 * written against, `pole` is what the export links use. Reading only one of
 * them silently dropped the filter — an export that ignored the line while the
 * screen applied it.
 */
function readSubTeam(params: URLSearchParams) {
  const raw =
    params.get("lineType") ?? params.get("subTeam") ?? params.get("pole");
  if (!raw) return null;
  const parsed = parseSubTeam(raw);
  if (!parsed) throw badRequest(`Pôle inconnu : ${raw}`);
  return parsed;
}

/** Builds the optional `where` clauses from query params (no auth scoping). */
export function callFilterClauses(params: URLSearchParams, role?: string | null): Prisma.CallWhereInput[] {
  const clauses: Prisma.CallWhereInput[] = [];

  // A coach who names no period gets the current month (see defaultPeriodFor).
  const range = buildDateRange(params, { defaultPeriod: defaultPeriodFor(role) });
  if (range) clauses.push({ startedAt: range });

  const entity = params.get("entity");
  const subTeam = readSubTeam(params);

  if (entity) {
    if (!isEntity(entity)) throw badRequest(`Entité inconnue : ${entity}`);
    clauses.push(callEntityWhere(entity, subTeam));
  } else if (subTeam) {
    // A line filter with no entity still narrows: "Auto across both entities".
    clauses.push(callSubTeamWhere(subTeam));
  }

  const teamId = params.get("teamId");
  // The team that HANDLED the call, read through its conseiller — same rule as
  // the entity filter, so `?teamId=` and `?entity=` cannot disagree.
  if (teamId) clauses.push(callTeamWhere(teamId));

  const lineId = params.get("lineId") ?? params.get("phoneLineId");
  if (lineId) clauses.push({ phoneLineId: lineId });

  const statut = params.get("statut");
  if (statut) clauses.push({ statut });

  // Result of the call (qualification): a CallResultOption value, or
  // RESULTAT_A_QUALIFIER for calls not qualified yet.
  const resultat = params.get("resultat");
  if (resultat) clauses.push(resultat === RESULTAT_A_QUALIFIER ? { result: { is: null } } : { result: { is: { resultat } } });

  return clauses;
}

/** `?resultat=` value for "no result recorded yet". */
export const RESULTAT_A_QUALIFIER = "A_QUALIFIER";

export type DurationSort = "duration_desc" | "duration_asc";

/** `?sort=duration_desc|duration_asc`; anything else = the usual newest-first order. */
export function readDurationSort(params: URLSearchParams): DurationSort | null {
  const sort = params.get("sort");
  return sort === "duration_desc" || sort === "duration_asc" ? sort : null;
}

/** Longest (or shortest) first; equal durations stay newest first. */
export function compareByDuration(sort: DurationSort) {
  const dir = sort === "duration_desc" ? -1 : 1;
  return (a: { durationSeconds: number; startedAt: Date | string }, b: { durationSeconds: number; startedAt: Date | string }) =>
    dir * ((a.durationSeconds ?? 0) - (b.durationSeconds ?? 0)) ||
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
}
