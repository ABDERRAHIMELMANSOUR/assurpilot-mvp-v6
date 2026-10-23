// src/lib/azzurReview.ts
//
// The pre-send review of calls bound for AZZUR: one LEAD per phone number, owned by
// the adviser who took the FIRST call, split by AZZUR link. Pure — no database, no
// request — so the counting rules can be read, and tested, on their own.
//
// Rules
//   * Calls are grouped by normalised number (+33 6… and 06… are one caller). A blank
//     or withheld number is never grouped: it cannot be sent, and is only counted.
//   * The lead belongs to the FIRST attempt on that number — earliest start, and on an
//     exact tie the longest call, then the lowest id — within the selection AND the
//     recent history before it. That adviser's team and product choose the link.
//   * Every other call of the selection on that number is a DUPLICATE: counted, shown,
//     never sent.
//   * If the first attempt predates the selection (it is in the history), the lead was
//     already received earlier: the selection's calls on that number are "déjà reçus"
//     and are not sent — unless `includeHistory` asks for them, in which case the lead
//     is sent once, attributed to that first adviser.
import { normalizePhone } from "@/lib/phone";
import { ROUTE_KEYS, ROUTE_LABEL, routeKeyFor, type RouteKey } from "@/lib/azzurRouting";

export type CategoryId = RouteKey | "INCONNU";

export const CATEGORY_ORDER: CategoryId[] = [...ROUTE_KEYS, "INCONNU"];
export const CATEGORY_LABEL: Record<CategoryId, string> = {
  ...ROUTE_LABEL,
  INCONNU: "Équipe non identifiée (aucun lien)",
};

export type ReviewCall = {
  id: string;
  callerNumber: string;
  startedAt: Date;
  durationSeconds: number;
  isMissed: boolean;
  /** True for the calls being reviewed; false for earlier calls kept only to find the first attempt. */
  inSelection: boolean;
  conseiller: { id: string; email: string; nom: string; prenom: string } | null;
  teamName: string | null;
  lineLabel: string | null;
};

export type Lead = {
  /** Normalised number. */
  number: string;
  category: CategoryId;
  /** The first attempt: the adviser who owns the lead and the call that is sent. */
  owner: ReviewCall;
  /** Calls of the selection on this number (the owner's own call included when it is in it). */
  calls: number;
  /** Selection calls on this number that are repeats and are not sent. */
  duplicates: number;
  /** The first attempt is earlier than the selection. */
  fromHistory: boolean;
};

export type AdviserLine = { name: string; leads: number; duplicates: number; alreadyReceived: number };

export type CategoryReview = {
  id: CategoryId;
  label: string;
  /** Selection calls attributed to this category (through the lead's first adviser). */
  calls: number;
  /** Leads to send. */
  leads: number;
  /** Repeat calls ignored: same number, a later attempt. */
  duplicates: number;
  /** Selection calls on numbers whose first attempt is in the history, not sent. */
  alreadyReceived: number;
  advisers: AdviserLine[];
};

export type Review = {
  categories: CategoryReview[];
  /** Leads in send order: category order, then first-attempt time, then id. */
  leads: Lead[];
  totals: { calls: number; leads: number; duplicates: number; alreadyReceived: number };
  /** Selection calls with no usable number: counted, never sent. */
  noNumber: number;
};

function adviserName(c: ReviewCall["conseiller"]): string {
  return c ? `${c.prenom} ${c.nom}`.trim() : "Sans conseiller";
}

/** Earliest wins; on an exact tie the longer call, then the lower id (stable). */
function byFirstAttempt(a: ReviewCall, b: ReviewCall): number {
  return (
    a.startedAt.getTime() - b.startedAt.getTime() ||
    b.durationSeconds - a.durationSeconds ||
    a.id.localeCompare(b.id)
  );
}

export function buildReview(calls: ReviewCall[], options: { includeHistory?: boolean } = {}): Review {
  const groups = new Map<string, ReviewCall[]>();
  let noNumber = 0;

  for (const call of calls) {
    const key = normalizePhone(call.callerNumber);
    if (!key) {
      if (call.inSelection) noNumber++;
      continue;
    }
    const bucket = groups.get(key);
    if (bucket) bucket.push(call);
    else groups.set(key, [call]);
  }

  const cats = new Map<CategoryId, CategoryReview & { byAdviser: Map<string, AdviserLine> }>(
    CATEGORY_ORDER.map((id) => [id, { id, label: CATEGORY_LABEL[id], calls: 0, leads: 0, duplicates: 0, alreadyReceived: 0, advisers: [], byAdviser: new Map() }])
  );
  const leads: Lead[] = [];

  for (const [number, group] of groups) {
    const selection = group.filter((c) => c.inSelection);
    if (selection.length === 0) continue; // history only: not part of this review

    const owner = [...group].sort(byFirstAttempt)[0];
    const fromHistory = !owner.inSelection;
    const category: CategoryId = routeKeyFor(owner.teamName, owner.lineLabel) ?? "INCONNU";
    const cat = cats.get(category)!;

    const line =
      cat.byAdviser.get(owner.conseiller?.id ?? "-") ??
      (() => {
        const created: AdviserLine = { name: adviserName(owner.conseiller), leads: 0, duplicates: 0, alreadyReceived: 0 };
        cat.byAdviser.set(owner.conseiller?.id ?? "-", created);
        return created;
      })();

    cat.calls += selection.length;

    if (fromHistory && !options.includeHistory) {
      cat.alreadyReceived += selection.length;
      line.alreadyReceived += selection.length;
      continue;
    }

    // The owner's own call is the lead; everything else of the selection is a repeat.
    const duplicates = fromHistory ? selection.length : selection.length - 1;
    cat.leads += 1;
    cat.duplicates += duplicates;
    line.leads += 1;
    line.duplicates += duplicates;
    leads.push({ number, category, owner, calls: selection.length, duplicates, fromHistory });
  }

  const order = (c: CategoryId) => CATEGORY_ORDER.indexOf(c);
  leads.sort(
    (a, b) =>
      order(a.category) - order(b.category) ||
      a.owner.startedAt.getTime() - b.owner.startedAt.getTime() ||
      a.owner.id.localeCompare(b.owner.id)
  );

  const categories: CategoryReview[] = [];
  for (const id of CATEGORY_ORDER) {
    const { byAdviser, ...rest } = cats.get(id)!;
    // The four links are always shown, even at zero; the fallback row only when it has calls.
    if (id === "INCONNU" && rest.calls === 0) continue;
    categories.push({
      ...rest,
      advisers: [...byAdviser.values()].sort((a, b) => b.leads + b.alreadyReceived - (a.leads + a.alreadyReceived) || a.name.localeCompare(b.name, "fr")),
    });
  }

  const sum = (f: (c: CategoryReview) => number) => categories.reduce((n, c) => n + f(c), 0);
  return {
    categories,
    leads,
    totals: {
      calls: sum((c) => c.calls),
      leads: sum((c) => c.leads),
      duplicates: sum((c) => c.duplicates),
      alreadyReceived: sum((c) => c.alreadyReceived),
    },
    noNumber,
  };
}
