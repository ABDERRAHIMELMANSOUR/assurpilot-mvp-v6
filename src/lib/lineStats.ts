// src/lib/lineStats.ts
//
// Reconciliation of the CPA / ALM standard lines against the advisers who
// actually answered on them. Pure functions: no database, no request, so the
// counting rules can be read and tested on their own.
//
// Two different things are crossed here, and `entity.ts` explains why they
// differ: the SOURCE is the standard line a call entered on, the ADVISER side is
// the entity of the conseiller who answered (their team). Both entities answer
// on shared standard numbers, so the four combinations below are exactly the
// routing the business wants to reconcile.
//
//   CPA>ALM   standard CPA line, answered by an ALM adviser
//   ALM>ALM   standard ALM line, answered by an ALM adviser
//   CPA>CPA   standard CPA line, answered by a CPA adviser
//   ALM>CPA   standard ALM line, answered by a CPA adviser
//
// A call counts only when it was ANSWERED (not missed) by an adviser whose team
// names an entity, on a line that names one. Everything else is reported in
// `other`, so the figures can be reconciled against the total instead of
// calls silently vanishing.
//
// Doublons: within a category, calls from the same number (compared in
// normalised form, so +33687814485 and 0687814485 are one caller) beyond the
// first are repeats. doublons = gross - unique. A blank / withheld number is
// never merged with another: "unknown" is not one caller.
import { entityOfTeamName, type Entity } from "@/lib/entity";
import { countUniqueCallers, groupCallsByCaller } from "@/lib/dedupe";

export type CategoryKey = "CPA>ALM" | "ALM>ALM" | "CPA>CPA" | "ALM>CPA";

export type Category = {
  key: CategoryKey;
  source: Entity;
  adviser: Entity;
  /** Card title, worded as the business words it. */
  label: string;
};

/** Display order: the two ALM-adviser cards, then the two CPA-adviser cards. */
export const CATEGORIES: Category[] = [
  { key: "CPA>ALM", source: "CPA", adviser: "ALM", label: "Standard CPA → Conseiller ALM" },
  { key: "ALM>ALM", source: "ALM", adviser: "ALM", label: "Standard ALM → Conseiller ALM" },
  { key: "CPA>CPA", source: "CPA", adviser: "CPA", label: "Standard CPA → Conseiller CPA" },
  { key: "ALM>CPA", source: "ALM", adviser: "CPA", label: "Standard ALM → Conseiller CPA" },
];

export function isCategoryKey(value: string | null | undefined): value is CategoryKey {
  return CATEGORIES.some((c) => c.key === value);
}

/** One call, already joined with the line and adviser metadata it needs. */
export type StatCall = {
  id: string;
  callerNumber: string;
  startedAt: Date;
  durationSeconds: number;
  isMissed: boolean;
  /** Entity of the standard line the call entered on; null when it names none. */
  sourceEntity: Entity | null;
  /** Entity of the answering adviser's team; null when unassigned or unnamed. */
  adviserEntity: Entity | null;
  /** True when a conseiller is attached to the call at all. */
  hasAdviser: boolean;
};

export type ClassifiedCall<T extends StatCall = StatCall> = T & { categorie: CategoryKey };

/** Result of classifying one call: its category, or why it has none. */
export type Classification =
  | { kind: "category"; key: CategoryKey }
  | { kind: "missed" | "noAdviser" | "unknownAdviserEntity" | "unknownSource" };

export function classifyCall(call: StatCall): Classification {
  if (call.isMissed) return { kind: "missed" };
  if (!call.hasAdviser) return { kind: "noAdviser" };
  if (!call.adviserEntity) return { kind: "unknownAdviserEntity" };
  if (!call.sourceEntity) return { kind: "unknownSource" };
  return { kind: "category", key: `${call.sourceEntity}>${call.adviserEntity}` as CategoryKey };
}

export type CategoryStats = Category & {
  /** Every answered call in the category. */
  gross: number;
  /** Distinct callers: what is left once repeats are folded together. */
  unique: number;
  /** gross - unique: calls that repeat a caller already counted. */
  doublons: number;
};

export type LineStats = {
  categories: CategoryStats[];
  totals: { gross: number; unique: number; doublons: number };
  /** Calls in the period that belong to none of the four categories, by reason. */
  other: { manques: number; sansConseiller: number; entiteConseillerInconnue: number; ligneInconnue: number };
};

export function computeLineStats(calls: StatCall[]): { stats: LineStats; classified: ClassifiedCall[] } {
  const buckets = new Map<CategoryKey, ClassifiedCall[]>(CATEGORIES.map((c) => [c.key, []]));
  const other = { manques: 0, sansConseiller: 0, entiteConseillerInconnue: 0, ligneInconnue: 0 };
  const classified: ClassifiedCall[] = [];

  for (const call of calls) {
    const result = classifyCall(call);
    if (result.kind === "category") {
      const row = { ...call, categorie: result.key };
      buckets.get(result.key)!.push(row);
      classified.push(row);
    } else if (result.kind === "missed") other.manques++;
    else if (result.kind === "noAdviser") other.sansConseiller++;
    else if (result.kind === "unknownAdviserEntity") other.entiteConseillerInconnue++;
    else other.ligneInconnue++;
  }

  const categories: CategoryStats[] = CATEGORIES.map((category) => {
    const rows = buckets.get(category.key)!;
    const unique = countUniqueCallers(rows);
    return { ...category, gross: rows.length, unique, doublons: rows.length - unique };
  });

  const gross = categories.reduce((n, c) => n + c.gross, 0);
  const unique = categories.reduce((n, c) => n + c.unique, 0);
  return { stats: { categories, totals: { gross, unique, doublons: gross - unique }, other }, classified };
}

/**
 * Narrows to one source line and/or one adviser entity. Either may be null for
 * "all". Applied BEFORE counting so the cards and the table always describe
 * the same set of calls.
 */
export function filterByEntities<T extends StatCall>(
  calls: T[],
  source: Entity | null,
  adviser: Entity | null
): T[] {
  if (!source && !adviser) return calls;
  return calls.filter(
    (c) => (!source || c.sourceEntity === source) && (!adviser || c.adviserEntity === adviser)
  );
}

export type TableRow<T extends StatCall> = ClassifiedCall<T> & {
  /** How many calls this row stands for: 1 in gross view, the repeat count in net view. */
  attemptCount: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
};

/**
 * Rows for the detail table.
 *
 * gross: one row per call, newest first.
 * net:   one row per caller PER CATEGORY — the same caller appearing under two
 *        categories is listed under both, because each category's unique count
 *        counts them once. The row shown is the longest call of the group (the
 *        conversation that actually happened), exactly as the call lists do.
 */
export function buildRows<T extends StatCall>(
  classified: ClassifiedCall<T>[],
  view: "gross" | "net"
): TableRow<T>[] {
  if (view === "gross") {
    return [...classified]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .map((c) => ({
        ...c,
        attemptCount: 1,
        firstAttemptAt: c.startedAt.toISOString(),
        lastAttemptAt: c.startedAt.toISOString(),
      }));
  }

  const rows: TableRow<T>[] = [];
  for (const category of CATEGORIES) {
    const inCategory = classified.filter((c) => c.categorie === category.key);
    for (const group of groupCallsByCaller(inCategory)) {
      const { attemptCount, firstAttemptAt, lastAttemptAt } = group;
      rows.push({ ...group, attemptCount, firstAttemptAt, lastAttemptAt });
    }
  }
  return rows.sort((a, b) => new Date(b.lastAttemptAt).getTime() - new Date(a.lastAttemptAt).getTime());
}

/** Entity of a line, trying its team, then its label, then the call's own team. */
export function sourceEntityOf(
  lineTeamName: string | null | undefined,
  lineLabel: string | null | undefined,
  callTeamName: string | null | undefined
): Entity | null {
  return entityOfTeamName(lineTeamName) ?? entityOfTeamName(lineLabel) ?? entityOfTeamName(callTeamName);
}
