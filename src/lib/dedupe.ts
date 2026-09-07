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
// Master-row rule: the row shown is the LONGEST call of the group, with the
// most recent call breaking a tie. A two-minute conversation is the one that
// actually happened; a fifteen-second call on the same number is a ring-through
// or a hang-up, and letting it own the row hands the lead to whoever the phone
// system happened to reach last. Choosing by duration therefore also settles
// which conseiller's workspace the lead sits in.
//
// Attribution rule: the "Déjà contacté par" badge still names the FIRST
// conseiller to receive the number — that is a different question (who is
// already working this lead) from who had the substantive conversation.
import { normalizePhone } from "@/lib/phone";

/** A person as the call payload carries them. */
type Person = { id?: string; nom: string; prenom: string } | null | undefined;

/** The minimum a call must expose to be groupable. */
export type GroupableCall = {
  id: string;
  callerNumber: string;
  startedAt: Date | string;
  durationSeconds: number;
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
  durationSeconds: number;
  user: { id?: string; nom: string; prenom: string } | null;
};

/** Fields the grouped payload adds on top of the master call. */
export type GroupMeta = {
  /** How many calls this row stands for. 1 when the number called once. */
  attemptCount: number;
  /** Ids of every call folded into this row, newest first. */
  groupedCallIds: string[];
  /**
   * First and last attempt of the group. Both are needed because the row
   * itself carries the LONGEST call, which is usually neither.
   */
  firstAttemptAt: string;
  lastAttemptAt: string;
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
 * The returned rows are ranked by each group's most recent attempt, so the list
 * still reads newest-activity-first even though the row itself is the longest
 * call rather than the latest one.
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
    // Newest first, so the last entry is the earliest attempt. Among calls
    // sharing a timestamp the shortest sorts first, which makes that last
    // entry the LONGEST of the earliest ones — the same tie-break
    // `isEarlierContact` applies, so the badge and the row agree.
    const sorted = [...bucket].sort(
      (a, b) =>
        toDate(b.startedAt).getTime() - toDate(a.startedAt).getTime() ||
        a.durationSeconds - b.durationSeconds
    );
    const newest = sorted[0];
    const oldest = sorted[sorted.length - 1];

    // The lead belongs to whoever answered first anywhere, which may be
    // someone whose calls this viewer cannot see.
    // Same tie-break as the map itself: an out-of-scope call at the identical
    // timestamp still counts as the prior contact when it is the longer one.
    // Without that, the conseiller who let the call ring for fifteen seconds
    // would be told they were first — the one person the badge must warn.
    const prior = priorContacts?.get(key);
    const priorIsEarlier = prior !== undefined && isEarlierContact(prior, oldest);

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

    // The master row is the LONGEST call of the group — the conversation that
    // actually took place — with the most recent call breaking an exact tie.
    // `sorted` is already newest-first, so a stable max over it picks the
    // longest and, among equals, the most recent without a second comparison.
    // Its id is what the Résultat and Transférer buttons act on, and its
    // `assignedUser` is the conseiller whose workspace the lead belongs to.
    const master = sorted.reduce((best, call) =>
      call.durationSeconds > best.durationSeconds ? call : best
    );

    rows.push({
      ...master,
      attemptCount: sorted.length,
      groupedCallIds: sorted.map((c) => c.id),
      firstAttemptAt: toDate(oldest.startedAt).toISOString(),
      lastAttemptAt: toDate(newest.startedAt).toISOString(),
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
      lastAttemptAt: toDate(call.startedAt).toISOString(),
      firstContactBy: call.assignedUser
        ? { id: call.assignedUser.id, nom: call.assignedUser.nom, prenom: call.assignedUser.prenom }
        : null,
      alreadyContacted: false,
    });
  }

  // Ranked by last activity, not by the master call's own timestamp — the
  // master is the longest call, which may well be the oldest of its group.
  rows.sort(
    (a, b) => new Date(b.lastAttemptAt).getTime() - new Date(a.lastAttemptAt).getTime()
  );
  return rows;
}

/**
 * Folds an unscoped list of calls into "who took this number first".
 *
 * Feed it the cheapest possible projection — caller number, start time and the
 * assigned user's name — for the window being displayed.
 */
export function buildPriorContactMap(
  calls: Array<{
    callerNumber: string;
    startedAt: Date;
    durationSeconds: number;
    assignedUser?: Person;
  }>
): Map<string, PriorContact> {
  const map = new Map<string, PriorContact>();

  for (const call of calls) {
    const key = normalizePhone(call.callerNumber);
    if (!key) continue;

    const current = map.get(key);
    if (current && !isEarlierContact(call, current)) continue;

    map.set(key, {
      startedAt: call.startedAt,
      durationSeconds: call.durationSeconds,
      user: call.assignedUser
        ? { id: call.assignedUser.id, nom: call.assignedUser.nom, prenom: call.assignedUser.prenom }
        : null,
    });
  }

  return map;
}

/**
 * Whether `candidate` is a better "first contact" than the one already held.
 *
 * Earlier wins; on an EXACT tie the longer call wins. Simultaneous timestamps
 * are not a corner case here — a switchboard ringing several advisers at once
 * stamps them to the same minute — and resolving that by row order would name
 * whichever adviser happened to be inserted first, including the one who let it
 * ring for fifteen seconds. The longer call is the real contact, which is the
 * same judgement the master-row rule makes.
 */
function isEarlierContact(
  candidate: { startedAt: Date | string; durationSeconds: number },
  current: { startedAt: Date | string; durationSeconds: number }
): boolean {
  const delta = toDate(candidate.startedAt).getTime() - toDate(current.startedAt).getTime();
  if (delta !== 0) return delta < 0;
  return candidate.durationSeconds > current.durationSeconds;
}

/** True when the caller asked for grouped rows. */
export function wantsGrouping(params: URLSearchParams): boolean {
  const raw = params.get("group") ?? params.get("dedupe");
  return raw === "1" || raw === "true";
}
