// src/lib/keyyoCalls.ts
//
// Turns Keyyo "Notification d'appels" into calls, live:
//   SETUP    (ringing)   -> the call appears at once in the list of the adviser whose line rings,
//                           « En cours »
//   CONNECT  (answered)  -> « Répondu », filed under the adviser who answered; the fiche is
//                           sent to AZZUR (Santé) / ProAssur (Auto) — same path as a manual call
//   RELEASE  (hung up)   -> end time and duration of the line that answered; never answered =
//                           « Manqué », sent a few seconds later if it is still missed then
//                           (another line may pick up meanwhile), unless only answered calls are sent
// A notification without a type is a received call: shown « Répondu » and sent at once.
// Times come from _TSMS_ (time of the event at Keyyo) when sent, else the receive time.
// A CONNECT answered by voicemail (22-digit number) is not an answer.
//
// Interception (supervision) and attended transfer (Keyyo guide v1.6): the line taking the call
// gets a new dialogue whose _DREF_REPLACE_ is the _DREF_ of the dialogue taken over, with the
// line as CALLER and the customer as CALLEE — it would look like an outgoing call. It is matched
// to the call holding that dialogue, and the line that takes it becomes the adviser who answered.
//
// ONE call per customer call: a call on a numéro d'accueil (standard) rings several lines, each
// with its own CALLREF but the same SESSION_ID — they are grouped on the session (else on the
// callref), whatever order or how many times the notifications arrive. On a standard, one line's
// RELEASE without answer does not make the call missed (another line may still pick up): it is
// shown « Manqué » meanwhile but not sent; a later ring or answer of the same session takes over.
//
// Ringover (src/lib/ringoverWebhook.ts) feeds the same logic: its events name the USER who
// handled the call (id, email, name) instead of a line, see adviserHint.
//
// Same rules as the Excel import: the adviser is the one whose line rang, the line is the
// standard number it came in on, the call's team is the adviser's team, times are Paris
// wall-clock (see parisWallClock). Calls made by a line (outgoing, per Keyyo: caller = account)
// and calls between our own lines are ignored.
import type { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { normalizePhone, routeForNumber } from "@/lib/phone";
import { scheduleAzzurPush } from "@/lib/azzur";
import { parisWallClock, type KeyyoNotification } from "@/lib/keyyoWebhook";
import { entityOfTeamName } from "@/lib/entity";

export type KeyyoMeta = {
  source: "keyyo-webhook";
  keyyoRef: string;
  numeroAppelant: string | null;
  events: string[];
  answeredAt?: string;
  /** CALLREF of the line that answered: only its RELEASE ends the call. */
  answeredRef?: string | null;
  /** CALLREFs of the lines this call rang. */
  callRefs?: string[];
  acd?: boolean;
  pushed?: boolean;
  dref?: string | null;
  /** _DREF_ of every dialogue of this call, to find it again on an interception or transfer. */
  drefs?: string[];
  /** "ringover" for a call notified by Ringover; absent = Keyyo. */
  provider?: "ringover";
};

/** How long a missed call waits before it is sent (another line or an interception may answer). */
const MISSED_DELAY_MS = Math.min(Math.max(Number(process.env.KEYYO_MISSED_DELAY_MS ?? 12_000) || 0, 0), 25_000);

export type ApplyResult = {
  outcome: string;
  callId: string | null;
  adviserId: string | null;
  adviserName: string | null;
  /** How the adviser was found (Ringover learns its user ids from email / name matches). */
  matchedBy?: "id" | "email" | "nom" | "ligne" | "appel";
};

/** Lower case, no accents, single spaces: names compared as people type them. */
function plainName(x: string | null | undefined): string {
  return (x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readMeta(raw: string | null | undefined): KeyyoMeta | null {
  try {
    const m = JSON.parse(raw ?? "");
    return m && m.source === "keyyo-webhook" ? (m as KeyyoMeta) : null;
  } catch {
    return null;
  }
}

/** The call holding Keyyo dialogue `dref` (last 12 hours), for an interception or a transfer. */
async function findCallByDref(dref: string, nowWall: Date) {
  const candidates = await prisma.call.findMany({
    where: {
      rawMeta: { contains: JSON.stringify(dref) },
      startedAt: { gte: new Date(nowWall.getTime() - 12 * 3600_000) },
    },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { id: true, callerNumber: true, phoneLineId: true, rawMeta: true },
  });
  for (const c of candidates) {
    const meta = readMeta(c.rawMeta);
    if (meta && (meta.dref === dref || meta.drefs?.includes(dref))) return { ...c, meta };
  }
  return null;
}

type PushTarget = {
  adviser: { id: string; email: string; nom: string; prenom: string; team: { nom: string } | null };
  lineLabel: string | null;
};

function push(call: { id: string; callerNumber: string; startedAt: Date; isMissed: boolean }, t: PushTarget) {
  // Same path as a call saved by hand: gated by « Envois automatiques », one fiche per number
  // (journal), AZZUR for Santé / ProAssur for Auto according to the adviser's team.
  scheduleAzzurPush([{
    reference: `call:${call.id}`,
    externalId: call.id.slice(-24),
    teamName: t.adviser.team?.nom ?? null,
    callerNumber: call.callerNumber,
    startedAt: call.startedAt,
    isMissed: call.isMissed,
    lineLabel: t.lineLabel,
    conseiller: { id: t.adviser.id, email: t.adviser.email, nom: t.adviser.nom, prenom: t.adviser.prenom },
  }]);
}

/**
 * A missed call is sent only if it is STILL missed and unsent a few seconds after the hang-up:
 * on a standard another line may pick up, and an interception arrives as a new dialogue.
 */
function scheduleMissedPush(callId: string, ref: string, t: PushTarget): void {
  const work = (async () => {
    await new Promise((resolve) => setTimeout(resolve, MISSED_DELAY_MS));
    const call = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"keyyo:" + ref}))`;
      const c = await tx.call.findUnique({ where: { id: callId } });
      const meta = readMeta(c?.rawMeta);
      if (!c || !meta || meta.pushed || c.statut !== "MANQUE") return null;
      meta.pushed = true;
      return tx.call.update({ where: { id: callId }, data: { rawMeta: JSON.stringify(meta) } });
    });
    if (call) push(call, t);
  })().catch((error) => console.error("[keyyo] envoi de l'appel manqué impossible:", error instanceof Error ? error.message : error));
  try {
    waitUntil(work);
  } catch {
    // Outside Vercel the promise just keeps running in this process.
  }
}

/** Applies one notification. `now` is the receive time; _TSMS_, when sent, wins. */
export async function applyKeyyoNotification(n: KeyyoNotification, now: Date = new Date()): Promise<ApplyResult> {
  const nowWall = n.eventAt ?? parisWallClock(now);

  const advisers = await prisma.user.findMany({
    where: { role: { in: ["CONSEILLER", "SUPERVISEUR"] }, isActive: true },
    select: { id: true, nom: true, prenom: true, email: true, phoneNumber: true, teamId: true, team: { select: { nom: true } } },
  });
  const byPhone = new Map(advisers.map((a) => [normalizePhone(a.phoneNumber), a] as const).filter(([p]) => p));

  // Interception / attended transfer: this dialogue takes over one of a call we already have
  // (its _DREF_REPLACE_), or is that new dialogue going on (its own _DREF_, already recorded).
  const taken =
    (n.drefReplace ? await findCallByDref(n.drefReplace, nowWall) : null) ??
    (n.direction === "outgoing" && n.dref ? await findCallByDref(n.dref, nowWall) : null);
  if (taken) {
    n = { ...n, direction: "incoming", customer: taken.callerNumber, adviserCandidates: n.account ? [n.account] : n.adviserCandidates };
  }

  // A call PLACED from a line (Keyyo: caller = account), or between our own lines, is not a lead.
  if (n.direction === "outgoing" || (n.customer && (byPhone.has(n.customer) || routeForNumber(n.customer)))) {
    return { outcome: "appel sortant ou interne : ignoré", callId: null, adviserId: null, adviserName: null };
  }
  // The adviser: the USER the source names (Ringover: known id, email, then first + last name),
  // else the line that rang, else whoever the call already belongs to (a Ringover "missed"
  // carries no user).
  const hint = n.adviserHint;
  let matchedBy: ApplyResult["matchedBy"];
  const find = (by: NonNullable<ApplyResult["matchedBy"]>, f: () => (typeof advisers)[number] | null | undefined) => {
    if (matchedBy) return null;
    const a = f() ?? null;
    if (a) matchedBy = by;
    return a;
  };
  const hintNames = hint
    ? [plainName(`${hint.firstname ?? ""} ${hint.lastname ?? ""}`), plainName(`${hint.lastname ?? ""} ${hint.firstname ?? ""}`), plainName(hint.fullName)].filter(Boolean)
    : [];
  type Adviser = (typeof advisers)[number];
  const agencyOf = (a: Adviser) => entityOfTeamName(a.team?.nom);
  const namesOf = (a: Adviser) => [plainName(`${a.prenom} ${a.nom}`), plainName(`${a.nom} ${a.prenom}`)];
  // The agency (CPA / ALM) of the standard line the call came from, when known: among the
  // advisers a clue points to, the one of that agency; the same person's account in that agency
  // when the clue points to their account in the other one. Otherwise only a single match counts
  // (two advisers with the same name are not guessed).
  const pick = (candidates: Adviser[]): Adviser | null => {
    const unique = [...new Map(candidates.map((a) => [a.id, a] as const)).values()];
    if (!unique.length) return null;
    if (n.preferAgency) {
      const inAgency = unique.filter((a) => agencyOf(a) === n.preferAgency);
      if (inAgency.length === 1) return inAgency[0];
      if (inAgency.length === 0) {
        const names = new Set(unique.flatMap(namesOf));
        const sameperson = advisers.filter((a) => agencyOf(a) === n.preferAgency && namesOf(a).some((x) => names.has(x)));
        if (sameperson.length === 1) return sameperson[0];
      }
    }
    return unique.length === 1 ? unique[0] : null;
  };
  let adviser =
    find("id", () => pick(hint?.userId ? advisers.filter((a) => a.id === hint.userId) : [])) ??
    find("email", () => pick(hint?.email ? advisers.filter((a) => a.email.toLowerCase() === hint.email!.trim().toLowerCase()) : [])) ??
    find("nom", () => pick(advisers.filter((a) => namesOf(a).some((x) => hintNames.includes(x))))) ??
    find("ligne", () => n.adviserCandidates.map((p) => byPhone.get(p)).find(Boolean));
  if (!adviser && n.callRef && !n.sessionId) {
    const prior = await prisma.call.findFirst({
      where: { rawMeta: { contains: `"keyyoRef":${JSON.stringify(n.callRef)}` }, startedAt: { gte: new Date(nowWall.getTime() - 12 * 3600_000) } },
      orderBy: { startedAt: "desc" },
      select: { assignedUserId: true },
    });
    adviser = find("appel", () => advisers.find((a) => a.id === prior?.assignedUserId));
  }
  if (!adviser) {
    const who = [hint?.fullName || [hint?.firstname, hint?.lastname].filter(Boolean).join(" "), hint?.email].filter(Boolean).join(" / ");
    if (who) {
      return { outcome: `aucun conseiller actif « ${who} » (ni par e-mail ni par nom${n.adviserCandidates.length ? `, ni par la ligne ${n.adviserCandidates.join(" / ")}` : ""}) : ignoré`, callId: null, adviserId: null, adviserName: null };
    }
  }
  if (!adviser) {
    return { outcome: `aucun conseiller avec la ligne ${n.adviserCandidates.join(" / ") || "(vide)"} : ignoré`, callId: null, adviserId: null, adviserName: null };
  }
  const adviserName = `${adviser.prenom} ${adviser.nom}`.trim();
  const adviserAgency = entityOfTeamName(adviser.team?.nom);
  const agencyWarning = n.preferAgency && adviserAgency && adviserAgency !== n.preferAgency
    ? ` — attention : appel du standard ${n.preferAgency}, conseiller de l'équipe ${adviser.team?.nom ?? adviserAgency}`
    : "";
  if (!n.customer) {
    return { outcome: "numéro de l'appelant absent ou masqué : ignoré", callId: null, adviserId: adviser.id, adviserName };
  }

  // The standard line it came in on (for the "Ligne" column), as the import resolves it.
  const lines = await prisma.phoneLine.findMany({ where: { isActive: true }, select: { id: true, numeroMasque: true, label: true } });
  const lineByPhone = new Map(lines.map((l) => [normalizePhone(l.numeroMasque), l] as const).filter(([p]) => p));
  let line: { id: string | null; label: string | null; numero: string | null } = { id: null, label: null, numero: null };
  // A call taken over keeps the line it came in on.
  const lineCandidates = taken ? (taken.meta.numeroAppelant ? [taken.meta.numeroAppelant] : []) : n.lineCandidates;
  for (const p of lineCandidates) {
    const l = lineByPhone.get(p);
    const route = routeForNumber(p);
    if (l || route) { line = { id: l?.id ?? null, label: l?.label ?? route?.label ?? null, numero: p }; break; }
  }
  const lineId = line.id ?? lines[0]?.id;
  if (!lineId) return { outcome: "aucune ligne téléphonique active configurée", callId: null, adviserId: adviser.id, adviserName };

  // One customer call: its standard session, else its callref, else adviser + customer within
  // two minutes.
  const ref = taken
    ? taken.meta.keyyoRef
    : n.sessionId ? `session:${n.sessionId}` : n.callRef ?? `${adviser.id}|${n.customer}|${Math.floor(nowWall.getTime() / 120_000)}`;
  const onStandard = !!n.sessionId || n.isAcd || !!taken?.meta.acd;

  const result = await prisma.$transaction(async (tx) => {
    // Serialises the notifications of ONE call: SETUP and CONNECT can arrive together.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"keyyo:" + ref}))`;
    const existing = taken
      ? await tx.call.findUnique({ where: { id: taken.id } })
      : await tx.call.findFirst({
          where: {
            rawMeta: { contains: `"keyyoRef":${JSON.stringify(ref)}` },
            startedAt: { gte: new Date(nowWall.getTime() - 12 * 3600_000) },
          },
          orderBy: { startedAt: "desc" },
        });
    const meta: KeyyoMeta = readMeta(existing?.rawMeta) ?? {
      source: "keyyo-webhook", keyyoRef: ref, numeroAppelant: line.numero, events: [], dref: n.dref,
      ...(n.provider ? { provider: n.provider } : {}),
    };
    meta.events = [...meta.events, `${n.rawType || n.type}${n.voicemail ? " (messagerie)" : ""}${taken ? " (interception)" : ""}`].slice(-20);
    if (n.callRef) meta.callRefs = [...new Set([...(meta.callRefs ?? []), n.callRef])].slice(-20);
    if (n.dref) meta.drefs = [...new Set([...(meta.drefs ?? []), ...(meta.dref ? [meta.dref] : []), n.dref])].slice(-20);
    if (onStandard) meta.acd = true;
    if (!meta.numeroAppelant && line.numero) meta.numeroAppelant = line.numero;

    // The line taking a call over (its SETUP is all the stealer gets) now holds it.
    const takesOver = !!taken && n.type !== "ended" && !n.voicemail;
    // Voicemail picking up is not an adviser answering.
    const answersNow = takesOver || (n.type === "answered" && !n.voicemail) || n.type === "unknown";
    const firstAnswer = answersNow && (!meta.answeredAt || (takesOver && meta.answeredRef !== n.callRef));
    if (firstAnswer) {
      meta.answeredAt ??= nowWall.toISOString();
      meta.answeredRef = n.callRef;
    }
    const answered = !!meta.answeredAt;
    // The call ends with the RELEASE of the line that answered, or of the only line it rang.
    const endsCall = n.type === "ended" && (answered ? !meta.answeredRef || !n.callRef || n.callRef === meta.answeredRef : true);

    const data: Prisma.CallUncheckedUpdateInput = {};
    if (answersNow || !existing || (n.type === "ringing" && !answered)) {
      // Shown to the adviser whose line rings, filed under the one who answers.
      data.assignedUserId = adviser.id;
      data.teamId = adviser.teamId;
    }
    if (endsCall) {
      // The event's own time when sent (_TSMS_, Ringover hangup_time), else start + duration.
      const endWall = !n.eventAt && n.startedAt && n.durationSeconds !== null ? new Date(n.startedAt.getTime() + n.durationSeconds * 1000) : nowWall;
      data.endedAt = endWall;
      data.durationSeconds = n.durationSeconds ?? (meta.answeredAt ? Math.max(0, Math.round((endWall.getTime() - new Date(meta.answeredAt).getTime()) / 1000)) : 0);
      data.isMissed = !answered;
      data.statut = answered ? "REPONDU" : "MANQUE";
    } else if (answered) {
      data.isMissed = false;
      data.statut = "REPONDU";
      // Answered after another line hung up (standard, interception, transfer): not over yet.
      if (firstAnswer) { data.endedAt = null; data.durationSeconds = 0; }
    } else if (n.type === "ringing" && existing) {
      // A standard call ringing the next line: still in progress.
      data.isMissed = false;
      data.statut = "EN_COURS";
      data.endedAt = null;
    }

    // Sent once: when answered (or a plain notification). A missed call is sent later, if it is
    // still missed then (scheduleMissedPush).
    const sendNow = !meta.pushed && answered;
    if (sendNow) meta.pushed = true;
    const sendIfStillMissed = !meta.pushed && endsCall && !answered;
    const ended = endsCall;

    let call;
    if (existing) {
      call = await tx.call.update({ where: { id: existing.id }, data: { ...data, rawMeta: JSON.stringify(meta) } });
    } else {
      call = await tx.call.create({
        data: {
          phoneLineId: lineId,
          teamId: adviser.teamId,
          assignedUserId: adviser.id,
          callerNumber: n.customer,
          isManual: false,
          isMissed: ended ? !answered : false,
          durationSeconds: (data.durationSeconds as number | undefined) ?? 0,
          startedAt: n.startedAt ?? nowWall,
          endedAt: (data.endedAt as Date | undefined) ?? null,
          statut: ended ? (answered ? "REPONDU" : "MANQUE") : answered ? "REPONDU" : "EN_COURS",
          rawMeta: JSON.stringify(meta),
        },
      });
    }
    return { call, sendNow, sendIfStillMissed, created: !existing };
  });

  const { call } = result;
  const target: PushTarget = { adviser, lineLabel: line.label };
  if (result.sendNow) push(call, target);
  else if (result.sendIfStillMissed) scheduleMissedPush(call.id, ref, target);
  const what = result.created ? "appel créé" : "appel mis à jour";
  return {
    outcome: `${what}${taken ? " (interception)" : ""}${n.voicemail ? " (messagerie : pas une réponse)" : ""} (${call.statut === "EN_COURS" ? "en cours" : call.statut === "MANQUE" ? "manqué" : "répondu"})${result.sendNow ? ", envoi CRM déclenché" : result.sendIfStillMissed ? `, envoi CRM dans ${Math.round(MISSED_DELAY_MS / 1000)} s s'il reste manqué` : ""}${agencyWarning}`,
    callId: call.id,
    adviserId: adviser.id,
    adviserName,
    matchedBy,
  };
}
