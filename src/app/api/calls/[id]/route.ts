// src/app/api/calls/[id]/route.ts
// Admin-only: read, update, delete a single call (only manual/imported calls)
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role: string) {
  if (role !== "ADMINISTRATEUR") {
    return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const deny = adminOnly((session.user as any).role);
  if (deny) return deny;

  const call = await prisma.call.findUnique({
    where: { id: params.id },
    include: {
      phoneLine:    true,
      assignedUser: { select: { id: true, nom: true, prenom: true, phoneNumber: true } },
      result:       true,
    },
  });
  if (!call) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });
  return NextResponse.json(call);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const deny = adminOnly((session.user as any).role);
  if (deny) return deny;

  const call = await prisma.call.findUnique({ where: { id: params.id } });
  if (!call) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });

  // Only allow editing manual/imported calls
  if (!call.isManual) {
    return NextResponse.json({
      error: "Seuls les appels importés manuellement peuvent être modifiés",
    }, { status: 400 });
  }

  const body = await req.json();
  const {
    callerNumber, assignedUserId, phoneLineId,
    startedAt, durationSeconds, statut, isMissed,
    // result fields
    resultat, notes,
  } = body;

  const dur        = durationSeconds !== undefined ? Number(durationSeconds) : call.durationSeconds;
  const missedBool = isMissed !== undefined ? isMissed : call.isMissed;
  const started    = startedAt ? new Date(startedAt) : call.startedAt;

  const updatedCall = await prisma.call.update({
    where: { id: params.id },
    data: {
      ...(callerNumber    !== undefined && { callerNumber }),
      ...(assignedUserId  !== undefined && { assignedUserId: assignedUserId || null }),
      ...(phoneLineId     !== undefined && { phoneLineId }),
      startedAt:      started,
      durationSeconds: dur,
      isMissed:       missedBool,
      statut:         statut ?? (missedBool ? "MANQUE" : "REPONDU"),
      endedAt:        missedBool ? null : new Date(started.getTime() + dur * 1000),
    },
    include: {
      phoneLine:    true,
      assignedUser: { select: { id: true, nom: true, prenom: true } },
      result:       true,
    },
  });

  // Upsert result if provided
  if (resultat !== undefined && assignedUserId) {
    const userId = (session.user as any).userId;
    if (resultat === null || resultat === "") {
      await prisma.callResult.deleteMany({ where: { callId: params.id } });
    } else {
      await prisma.callResult.upsert({
        where:  { callId: params.id },
        create: { callId: params.id, userId, resultat, notes: notes ?? null },
        update: { resultat, notes: notes ?? null },
      });
    }
  }

  return NextResponse.json(updatedCall);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const deny = adminOnly((session.user as any).role);
  if (deny) return deny;

  const call = await prisma.call.findUnique({ where: { id: params.id } });
  if (!call) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });

  // Only allow deleting manual/imported calls
  if (!call.isManual) {
    return NextResponse.json({
      error: "Seuls les appels importés manuellement peuvent être supprimés",
    }, { status: 400 });
  }

  // Delete result first (FK constraint), then call
  await prisma.callResult.deleteMany({ where: { callId: params.id } });
  await prisma.call.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
