// src/app/api/calls/mock/route.ts — dev only, simulate an inbound call
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const FAKE_NUMBERS = [
  "+33 6 12 34 56 78", "+33 7 65 43 21 09", "+33 6 98 76 54 32",
  "+33 9 11 22 33 44", "+33 6 55 66 77 88", "+33 7 99 88 77 66",
];

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Non disponible en production" }, { status: 403 });
  }

  const { isMissed = false, userId } = await req.json().catch(() => ({}));

  const lines = await prisma.phoneLine.findMany({ where: { isActive: true } });
  if (!lines.length) return NextResponse.json({ error: "Aucune ligne configurée" }, { status: 400 });
  const line = lines[Math.floor(Math.random() * lines.length)];

  let agentId = userId;
  if (!agentId) {
    const agents = await prisma.user.findMany({ where: { role: "CONSEILLER", isActive: true } });
    if (!agents.length) return NextResponse.json({ error: "Aucun conseiller actif" }, { status: 400 });
    agentId = agents[Math.floor(Math.random() * agents.length)].id;
  }

  const duration  = isMissed ? 0 : Math.floor(Math.random() * 480) + 60;
  const startedAt = new Date();
  const caller    = FAKE_NUMBERS[Math.floor(Math.random() * FAKE_NUMBERS.length)];

  const call = await prisma.call.create({
    data: {
      phoneLineId:    line.id,
      assignedUserId: agentId,
      callerNumber:   isMissed ? "+33 6 00 00 00 00" : caller,
      isMissed,
      durationSeconds: duration,
      startedAt,
      endedAt: isMissed ? null : new Date(startedAt.getTime() + duration * 1000),
      statut:  isMissed ? "MANQUE" : "REPONDU",
    },
    include: { phoneLine: true, assignedUser: { select: { nom: true, prenom: true } } },
  });

  return NextResponse.json({ success: true, call });
}
