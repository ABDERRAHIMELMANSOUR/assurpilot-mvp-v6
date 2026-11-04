// src/lib/keyyoCalls.ts
//
// Turns Keyyo "Notification d'appels" into calls, live:
//   SETUP    (ringing)   -> the call appears at once in the list of the adviser whose line rings,
//                           « En cours »
//   CONNECT  (answered)  -> « Répondu », filed under the adviser who answered; the fiche is
//                           sent to AZZUR (Santé) / ProAssur (Auto) — same path as a manual call
//   RELEASE  (hung up)   -> end time and duration of the line that answered; never answered =
//                           « Manqué » (and sent then, unless only answered calls are sent)
// A notification without a type is a received call: shown « Répondu » and sent at once.
//
// ONE call per customer call: a call on a numéro d'accueil (standard) rings several lines, each
// with its own CALLREF but the same SESSION_ID — they are grouped on the session (else on the
// callref), whatever order or how many times the notifications arrive. On a standard, one line's
// RELEASE without answer does not make the call missed (another line may still pick up): it is
// shown « Manqué » meanwhile but not sent; a later ring or answer of the same session takes over.
//
// Same rules as the Excel import: the adviser is the one whose line rang, the line is the
// standard number it came in on, the call's team is the adviser's team, times are Paris
// wall-clock (see parisWallClock). Calls made by a line (outgoing, per Keyyo: caller = account)
// and calls between our own lines are ignored.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone, routeForNumber } from "@/lib/phone";
import { scheduleAzzurPush } from "@/lib/azzur";
import { parisWallClock, type KeyyoNotification } from "@/lib/keyyoWebhook";

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
};

export type ApplyResult = {
  outcome: string;
  callId: string | null;
  adviserId: string | null;
  adviserName: string | null;
};

function readMeta(raw: string | null | undefined): KeyyoMeta | null {
  try {
    const m = JSON.parse(raw ?? "");
    return m && m.source === "keyyo-webhook" ? (m as KeyyoMeta) : null;
  } catch {
    return null;
  }
}

/** Applies one notification. `now` is the receive time (Keyyo sends no date). */
export async function applyKeyyoNotification(n: KeyyoNotification, now: Date = new Date()): Promise<ApplyResult> {
  const nowWall = parisWallClock(now);

  const advisers = await prisma.user.findMany({
    where: { role: { in: ["CONSEILLER", "SUPERVISEUR"] }, isActive: true },
    select: { id: true, nom: true, prenom: true, email: true, phoneNumber: true, teamId: true, team: { select: { nom: true } } },
  });
  const byPhone = new Map(advisers.map((a) => [normalizePhone(a.phoneNumber), a] as const).filter(([p]) => p));

  // A call PLACED from a line (Keyyo: caller = account), or between our own lines, is not a lead.
  if (n.direction === "outgoing" || (n.customer && (byPhone.has(n.customer) || routeForNumber(n.customer)))) {
    return { outcome: "appel sortant ou interne : ignoré", callId: null, adviserId: null, adviserName: null };
  }
  const adviser = n.adviserCandidates.map((p) => byPhone.get(p)).find(Boolean) ?? null;
  if (!adviser) {
    return { outcome: `aucun conseiller avec la ligne ${n.adviserCandidates.join(" / ") || "(vide)"} : ignoré`, callId: null, adviserId: null, adviserName: null };
  }
  const adviserName = `${adviser.prenom} ${adviser.nom}`.trim();
  if (!n.customer) {
    return { outcome: "numéro de l'appelant absent ou masqué : ignoré", callId: null, adviserId: adviser.id, adviserName };
  }

  // The standard line it came in on (for the "Ligne" column), as the import resolves it.
  const lines = await prisma.phoneLine.findMany({ where: { isActive: true }, select: { id: true, numeroMasque: true, label: true } });
  const lineByPhone = new Map(lines.map((l) => [normalizePhone(l.numeroMasque), l] as const).filter(([p]) => p));
  let line: { id: string | null; label: string | null; numero: string | null } = { id: null, label: null, numero: null };
  for (const p of n.lineCandidates) {
    const l = lineByPhone.get(p);
    const route = routeForNumber(p);
    if (l || route) { line = { id: l?.id ?? null, label: l?.label ?? route?.label ?? null, numero: p }; break; }
  }
  const lineId = line.id ?? lines[0]?.id;
  if (!lineId) return { outcome: "aucune ligne téléphonique active configurée", callId: null, adviserId: adviser.id, adviserName };

  // One customer call: its standard session, else its callref, else adviser + customer within
  // two minutes.
  const ref = n.sessionId ? `session:${n.sessionId}` : n.callRef ?? `${adviser.id}|${n.customer}|${Math.floor(nowWall.getTime() / 120_000)}`;
  const onStandard = !!n.sessionId || n.isAcd;

  const result = await prisma.$transaction(async (tx) => {
    // Serialises the notifications of ONE call: SETUP and CONNECT can arrive together.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"keyyo:" + ref}))`;
    const existing = await tx.call.findFirst({
      where: {
        rawMeta: { contains: `"keyyoRef":${JSON.stringify(ref)}` },
        startedAt: { gte: new Date(nowWall.getTime() - 12 * 3600_000) },
      },
      orderBy: { startedAt: "desc" },
    });
    const meta: KeyyoMeta = readMeta(existing?.rawMeta) ?? {
      source: "keyyo-webhook", keyyoRef: ref, numeroAppelant: line.numero, events: [], dref: n.dref,
    };
    meta.events = [...meta.events, n.rawType || n.type].slice(-20);
    if (n.callRef) meta.callRefs = [...new Set([...(meta.callRefs ?? []), n.callRef])].slice(-20);
    if (onStandard) meta.acd = true;
    if (!meta.numeroAppelant && line.numero) meta.numeroAppelant = line.numero;

    const answersNow = n.type === "answered" || n.type === "unknown";
    if (answersNow && !meta.answeredAt) {
      meta.answeredAt = nowWall.toISOString();
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
      const endWall = n.startedAt && n.durationSeconds !== null ? new Date(n.startedAt.getTime() + n.durationSeconds * 1000) : nowWall;
      data.endedAt = endWall;
      data.durationSeconds = n.durationSeconds ?? (meta.answeredAt ? Math.max(0, Math.round((endWall.getTime() - new Date(meta.answeredAt).getTime()) / 1000)) : 0);
      data.isMissed = !answered;
      data.statut = answered ? "REPONDU" : "MANQUE";
    } else if (answered) {
      data.isMissed = false;
      data.statut = "REPONDU";
    } else if (n.type === "ringing" && existing) {
      // A standard call ringing the next line: still in progress.
      data.isMissed = false;
      data.statut = "EN_COURS";
      data.endedAt = null;
    }

    // Sent once: when answered (or a plain notification), else when a missed call is over —
    // except on a standard, where one line hanging up does not end the call.
    const sendNow = !meta.pushed && (answered || (endsCall && !onStandard));
    if (sendNow) meta.pushed = true;
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
    return { call, sendNow, created: !existing };
  });

  const { call } = result;
  if (result.sendNow) {
    // Same path as a call saved by hand: gated by « Envois automatiques », one fiche per number
    // (journal), AZZUR for Santé / ProAssur for Auto according to the adviser's team.
    scheduleAzzurPush([{
      reference: `call:${call.id}`,
      externalId: call.id.slice(-24),
      teamName: adviser.team?.nom ?? null,
      callerNumber: call.callerNumber,
      startedAt: call.startedAt,
      isMissed: call.isMissed,
      lineLabel: line.label,
      conseiller: { id: adviser.id, email: adviser.email, nom: adviser.nom, prenom: adviser.prenom },
    }]);
  }
  const what = result.created ? "appel créé" : "appel mis à jour";
  return {
    outcome: `${what} (${call.statut === "EN_COURS" ? "en cours" : call.statut === "MANQUE" ? "manqué" : "répondu"})${result.sendNow ? ", envoi CRM déclenché" : ""}`,
    callId: call.id,
    adviserId: adviser.id,
    adviserName,
  };
}
