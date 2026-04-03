// src/app/api/call-result-options/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // All roles can read options (needed for the result modal)
  const options = await prisma.callResultOption.findMany({
    orderBy: { order: "asc" },
  });
  return NextResponse.json(options);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  if (user.role !== "ADMINISTRATEUR") {
    return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });
  }

  const { label, value, color, isActive, order } = await req.json();
  if (!label?.trim() || !value?.trim()) {
    return NextResponse.json({ error: "Label et valeur sont obligatoires" }, { status: 400 });
  }

  // Normalize value: uppercase, no spaces
  const normalizedValue = value.trim().toUpperCase().replace(/\s+/g, "_");

  const existing = await prisma.callResultOption.findUnique({ where: { value: normalizedValue } });
  if (existing) return NextResponse.json({ error: "Cette valeur existe déjà" }, { status: 409 });

  const maxOrder = await prisma.callResultOption.aggregate({ _max: { order: true } });
  const nextOrder = (maxOrder._max.order ?? -1) + 1;

  const option = await prisma.callResultOption.create({
    data: {
      label: label.trim(),
      value: normalizedValue,
      color: color ?? "gray",
      isActive: isActive !== undefined ? isActive : true,
      order: order !== undefined ? order : nextOrder,
    },
  });
  return NextResponse.json(option, { status: 201 });
}
