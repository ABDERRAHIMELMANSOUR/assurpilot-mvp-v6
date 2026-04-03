// src/app/api/call-result-options/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role: string) {
  return role !== "ADMINISTRATEUR"
    ? NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 })
    : null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const deny = adminOnly((session.user as any).role);
  if (deny) return deny;

  const body = await req.json();
  const { label, color, isActive, order } = body;

  const option = await prisma.callResultOption.findUnique({ where: { id: params.id } });
  if (!option) return NextResponse.json({ error: "Option introuvable" }, { status: 404 });

  const updated = await prisma.callResultOption.update({
    where: { id: params.id },
    data: {
      ...(label    !== undefined && { label: label.trim() }),
      ...(color    !== undefined && { color }),
      ...(isActive !== undefined && { isActive }),
      ...(order    !== undefined && { order: Number(order) }),
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const deny = adminOnly((session.user as any).role);
  if (deny) return deny;

  const option = await prisma.callResultOption.findUnique({ where: { id: params.id } });
  if (!option) return NextResponse.json({ error: "Option introuvable" }, { status: 404 });

  // Check if any call results use this option
  const inUse = await prisma.callResult.count({ where: { resultat: option.value } });
  if (inUse > 0) {
    // Soft delete — deactivate instead of hard delete
    const updated = await prisma.callResultOption.update({
      where: { id: params.id },
      data: { isActive: false },
    });
    return NextResponse.json({ ...updated, warning: `Cette option est utilisée par ${inUse} appel(s). Elle a été désactivée plutôt que supprimée.` });
  }

  await prisma.callResultOption.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
