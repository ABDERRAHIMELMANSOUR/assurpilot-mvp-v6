// src/lib/keyyoCalls.ts
//
// Turns Keyyo "Notification d'appels" into calls, live:
//   SETUP    (ringing)   -> the call appears at once in the adviser's list, « En cours »
//   CONNECT  (answered)  -> « Répondu », filed under the adviser who answered; the fiche is
//                           sent to AZZUR (Santé) / ProAssur (Auto) — same path as a manual call
//   RELEASE  (hung up)   -> end time and duration; never answered = « Manqué » (and sent then,
//                           unless only answered calls are sent)
// One call per Keyyo callref, whatever order or how many times the notifications arrive. A
// notification without a type is a received call: shown « Répondu » and sent at once.
//
// Same rules as the Excel import: the adviser is the one whose line was called, the line is the
// standard number it came in on, the call's team is the adviser's team, times are Paris
// wall-clock (see parisWallClock). Calls made BY an adviser (outgoing) are ignored.
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

  // A call PLACED by an adviser (the "caller" is one of our lines) is not an incoming lead.
  if (n.customer && (byPhone.has(n.customer) || routeForNumber(n.customer))) {
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

  // Without a callref, a call is identified by adviser + customer within two minutes.
  const ref = n.callRef ?? `${adviser.id}|${n.customer}|${Math.floor(nowWall.getTime() / 120_000)}`;

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
    meta.events = [...meta.events, n.rawType || n.type].slice(-12);

    const answered = n.type === "answered" || n.type === "unknown" || !!meta.answeredAt;
    if ((n.type === "answered" || n.type === "unknown") && !meta.answeredAt) meta.answeredAt = nowWall.toISOString();
    const ended = n.type === "ended";

    const data: Prisma.CallUncheckedUpdateInput = {};
    if (n.type === "answered" || n.type === "unknown" || !existing) {
      // Filed under the adviser who answered (a hunt group rings several lines first).
      data.assignedUserId = adviser.id;
      data.teamId = adviser.teamId;
    }
    if (ended) {
      const endWall = n.startedAt && n.durationSeconds !== null ? new Date(n.startedAt.getTime() + n.durationSeconds * 1000) : nowWall;
      data.endedAt = endWall;
      data.durationSeconds = n.durationSeconds ?? (meta.answeredAt ? Math.max(0, Math.round((endWall.getTime() - new Date(meta.answeredAt).getTime()) / 1000)) : 0);
      data.isMissed = !answered;
      data.statut = answered ? "REPONDU" : "MANQUE";
    } else if (answered) {
      data.isMissed = false;
      data.statut = "REPONDU";
    }

    // Sent once: when answered (or a plain notification), else at the end of a missed call.
    const sendNow = !meta.pushed && (answered || ended);
    if (sendNow) meta.pushed = true;

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
