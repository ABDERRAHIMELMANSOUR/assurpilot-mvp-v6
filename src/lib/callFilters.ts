// src/lib/callFilters.ts
//
// The filter set shared by GET /api/calls and the Excel export, so an export
// always contains exactly the rows the screen is showing.
import type { Prisma } from "@prisma/client";
import { buildDateRange } from "@/lib/dates";
import { callEntityWhere, isEntity, isSubTeam } from "@/lib/entity";
import { badRequest } from "@/lib/api";

/** Builds the optional `where` clauses from query params (no auth scoping). */
export function callFilterClauses(params: URLSearchParams): Prisma.CallWhereInput[] {
  const clauses: Prisma.CallWhereInput[] = [];

  const range = buildDateRange(params);
  if (range) clauses.push({ startedAt: range });

  const entity = params.get("entity");
  if (entity) {
    if (!isEntity(entity)) throw badRequest(`Entité inconnue : ${entity}`);
    const subTeam = params.get("subTeam");
    if (subTeam && !isSubTeam(subTeam)) throw badRequest(`Pôle inconnu : ${subTeam}`);
    clauses.push(callEntityWhere(entity, isSubTeam(subTeam) ? subTeam : null));
  }

  const teamId = params.get("teamId");
  if (teamId) clauses.push({ teamId });

  const lineId = params.get("lineId") ?? params.get("phoneLineId");
  if (lineId) clauses.push({ phoneLineId: lineId });

  const statut = params.get("statut");
  if (statut) clauses.push({ statut });

  return clauses;
}
