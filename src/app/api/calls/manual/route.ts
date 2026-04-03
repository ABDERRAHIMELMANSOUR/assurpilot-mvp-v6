// src/app/api/calls/manual/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  if (user.role !== "ADMINISTRATEUR") {
    return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  const {
    callerNumber,
    assignedUserId,
    phoneLineId,
    startedAt,
    durationSeconds,
    statut,
    isMissed,
    resultat,
    notes,
  } = body;

  if (!callerNumber?.trim()) {
    return NextResponse.json({ error: "Le numéro appelant est obligatoire" }, { status: 400 });
  }
  if (!assignedUserId) {
    return NextResponse.json({ error: "Le conseiller est obligatoire" }, { status: 400 });
  }
  if (!phoneLineId) {
    return NextResponse.json({ error: "La ligne téléphonique est obligatoire" }, { status: 400 });
  }
  if (!startedAt) {
    return NextResponse.json({ error: "La date et l'heure sont obligatoires" }, { status: 400 });
  }
  if (!statut) {
    return NextResponse.json({ error: "Le statut est obligatoire" }, { status: 400 });
  }

  const startDate    = new Date(startedAt);
  const dur          = Number(durationSeconds) || 0;
  const endDate      = dur > 0 ? new Date(startDate.getTime() + dur * 1000) : null;
  const missedBool   = isMissed === true || statut === "MANQUE";

  const call = await prisma.call.create({
    data: {
      phoneLineId,
      assignedUserId,
      callerNumber:   callerNumber.trim(),
      isManual:       true,
      isMissed:       missedBool,
      durationSeconds: dur,
      startedAt:      startDate,
      endedAt:        endDate,
      statut,
    },
    include: {
      phoneLine:    true,
      assignedUser: { select: { id: true, nom: true, prenom: true } },
      result:       true,
    },
  });

  // If a result was provided, create it immediately
  if (resultat && !missedBool) {
    await prisma.callResult.create({
      data: {
        callId:   call.id,
        userId:   user.userId,
        resultat,
        notes:    notes ?? null,
      },
    });
  }

  return NextResponse.json(call, { status: 201 });
}
