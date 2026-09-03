// src/lib/callFilters.ts
//
// The filter set shared by GET /api/calls and the Excel export, so an export
// always contains exactly the rows the screen is showing.
import type { Prisma } from "@prisma/client";
import { buildDateRange } from "@/lib/dates";
import { callEntityWhere, callSubTeamWhere, isEntity, parseSubTeam } from "@/lib/entity";
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
export function callFilterClauses(params: URLSearchParams): Prisma.CallWhereInput[] {
  const clauses: Prisma.CallWhereInput[] = [];

  const range = buildDateRange(params);
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
  if (teamId) clauses.push({ teamId });

  const lineId = params.get("lineId") ?? params.get("phoneLineId");
  if (lineId) clauses.push({ phoneLineId: lineId });

  const statut = params.get("statut");
  if (statut) clauses.push({ statut });

  return clauses;
}
