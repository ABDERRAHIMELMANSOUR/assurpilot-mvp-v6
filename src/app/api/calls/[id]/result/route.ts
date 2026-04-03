// src/app/api/calls/[id]/result/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  const { resultat, notes } = await req.json();

  if (!resultat) return NextResponse.json({ error: "Résultat requis" }, { status: 400 });

  // Verify the call belongs to this user (for CONSEILLER)
  const call = await prisma.call.findUnique({ where: { id: params.id } });
  if (!call) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });

  if (user.role === "CONSEILLER" && call.assignedUserId !== user.userId) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const result = await prisma.callResult.upsert({
    where: { callId: params.id },
    create: { callId: params.id, userId: user.userId, resultat, notes },
    update: { resultat, notes },
  });

  return NextResponse.json(result);
}
