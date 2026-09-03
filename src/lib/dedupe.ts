// src/lib/dedupe.ts
//
// Collapsing repeat calls from the same number into a single "lead" row.
//
// The same prospect calling three times is one lead, not three: counting them
// as three inflates every volume figure and, worse, lets a second conseiller
// pick up a number a colleague is already working. Grouping is opt-in
// (`?group=1`) so the ungrouped payload stays exactly what it was for every
// caller that has not asked for it.
//
// Attribution rule: the group belongs to the FIRST conseiller who received the
// number. Later attempts, whoever they land on, do not take the lead away.
import { normalizePhone } from "@/lib/phone";

/** A person as the call payload carries them. */
type Person = { id?: string; nom: string; prenom: string } | null | undefined;

/** The minimum a call must expose to be groupable. */
export type GroupableCall = {
  id: string;
  callerNumber: string;
  startedAt: Date | string;
  assignedUser?: Person;
};

/**
 * Who first took a given number, looked up WITHOUT the viewer's scope.
 *
 * This is the point of the warning: a conseiller only ever sees their own
 * calls, so a colleague's earlier attempt is invisible to them — which is
 * exactly the collision the badge exists to prevent. The lookup therefore runs
 * over every call in the window, and the only thing it discloses is a
 * colleague's name against a number the viewer is already looking at.
 */
export type PriorContact = {
  startedAt: Date;
  user: { id?: string; nom: string; prenom: string } | null;
};

/** Fields the grouped payload adds on top of the master call. */
export type GroupMeta = {
  /** How many calls this row stands for. 1 when the number called once. */
  attemptCount: number;
  /** Ids of every call folded into this row, newest first. */
  groupedCallIds: string[];
  /** Timestamp of the FIRST attempt; the row itself carries the latest. */
  firstAttemptAt: string;
  /** The conseiller the lead is attributed to — the first one to receive it. */
  firstContactBy: { id?: string; nom: string; prenom: string } | null;
  /**
   * Set when a later attempt reached a conseiller other than the first one,
   * i.e. the lead is being worked by more than one person. Drives the
   * "Déjà contacté par" badge.
   */
  alreadyContacted: boolean;
};

function personKey(person: Person): string | null {
  if (!person) return null;
  return person.id ?? `${person.prenom} ${person.nom}`;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Groups by normalised caller number.
 *
 * Normalising matters: the same mobile arrives as "+33687814485" from the API
 * and "0687814485" from a spreadsheet import, and an exact-string group would
 * treat them as two leads. Numbers that normalise to nothing (blank / withheld)
 * are never grouped with each other — "unknown" is not one caller.
 *
 * `calls` must be ordered newest-first; the result keeps that order, ranked by
 * each group's most recent attempt.
 */
export function groupCallsByCaller<T extends GroupableCall>(
  calls: T[],
  priorContacts?: Map<string, PriorContact>
): Array<T & GroupMeta> {
  const groups = new Map<string, T[]>();
  const ungroupable: T[] = [];

  for (const call of calls) {
    const key = normalizePhone(call.callerNumber);
    if (!key) {
      ungroupable.push(call);
      continue;
    }
    const bucket = groups.get(key);
    if (bucket) bucket.push(call);
    else groups.set(key, [call]);
  }

  const rows: Array<T & GroupMeta> = [];

  for (const [key, bucket] of groups.entries()) {
    // Newest first on the way in, so the last entry is the earliest attempt.
    const sorted = [...bucket].sort(
      (a, b) => toDate(b.startedAt).getTime() - toDate(a.startedAt).getTime()
    );
    const newest = sorted[0];
    const oldest = sorted[sorted.length - 1];

    // The lead belongs to whoever answered first anywhere, which may be
    // someone whose calls this viewer cannot see.
    const prior = priorContacts?.get(key);
    const priorIsEarlier =
      prior !== undefined && prior.startedAt.getTime() < toDate(oldest.startedAt).getTime();

    const firstContactBy = priorIsEarlier
      ? prior.user
      : oldest.assignedUser
        ? {
            id: oldest.assignedUser.id,
            nom: oldest.assignedUser.nom,
            prenom: oldest.assignedUser.prenom,
          }
        : null;

    const firstOwner = personKey(firstContactBy);
    const alreadyContacted =
      firstOwner !== null &&
      sorted.some((call) => {
        const owner = personKey(call.assignedUser);
        return owner !== null && owner !== firstOwner;
      });

    // The master row is the LATEST call: it holds the group's current state —
    // its status, its qualification — and its id is what the Résultat and
    // Transférer buttons act on, so what the row shows is what the button
    // edits. Building the row from the earliest call instead would have shown
    // "À qualifier" on a lead whose most recent call was already a signed
    // contract. Attribution to the first conseiller is carried separately, by
    // `firstContactBy` and the "Déjà contacté par" badge.
    rows.push({
      ...newest,
      attemptCount: sorted.length,
      groupedCallIds: sorted.map((c) => c.id),
      firstAttemptAt: toDate(oldest.startedAt).toISOString(),
      firstContactBy,
      alreadyContacted,
    });
  }

  for (const call of ungroupable) {
    rows.push({
      ...call,
      attemptCount: 1,
      groupedCallIds: [call.id],
      firstAttemptAt: toDate(call.startedAt).toISOString(),
      firstContactBy: call.assignedUser
        ? { id: call.assignedUser.id, nom: call.assignedUser.nom, prenom: call.assignedUser.prenom }
        : null,
      alreadyContacted: false,
    });
  }

  rows.sort((a, b) => toDate(b.startedAt).getTime() - toDate(a.startedAt).getTime());
  return rows;
}

/**
 * Folds an unscoped list of calls into "who took this number first".
 *
 * Feed it the cheapest possible projection — caller number, start time and the
 * assigned user's name — for the window being displayed.
 */
export function buildPriorContactMap(
  calls: Array<{ callerNumber: string; startedAt: Date; assignedUser?: Person }>
): Map<string, PriorContact> {
  const map = new Map<string, PriorContact>();

  for (const call of calls) {
    const key = normalizePhone(call.callerNumber);
    if (!key) continue;
    const current = map.get(key);
    if (current && current.startedAt.getTime() <= call.startedAt.getTime()) continue;
    map.set(key, {
      startedAt: call.startedAt,
      user: call.assignedUser
        ? { id: call.assignedUser.id, nom: call.assignedUser.nom, prenom: call.assignedUser.prenom }
        : null,
    });
  }

  return map;
}

/** True when the caller asked for grouped rows. */
export function wantsGrouping(params: URLSearchParams): boolean {
  const raw = params.get("group") ?? params.get("dedupe");
  return raw === "1" || raw === "true";
}
