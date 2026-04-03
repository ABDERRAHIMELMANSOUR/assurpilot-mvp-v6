// src/app/api/users/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { USER_SELECT } from "../route";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const cu = session.user as any;
  if (!["ADMINISTRATEUR", "SUPERVISEUR"].includes(cu.role)) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const user = await prisma.user.findUnique({ where: { id: params.id }, select: USER_SELECT });
  if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  if (cu.role === "SUPERVISEUR" && (user as any).teamId !== cu.teamId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  return NextResponse.json(user);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const cu = session.user as any;
  if (!["ADMINISTRATEUR", "SUPERVISEUR"].includes(cu.role)) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  if (cu.role === "SUPERVISEUR" && (target.teamId !== cu.teamId || target.role !== "CONSEILLER")) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const { email, nom, prenom, phoneNumber, password, role, teamId, superviseurId, isActive } = await req.json();
  if (email && email !== target.email) {
    const dup = await prisma.user.findUnique({ where: { email } });
    if (dup) return NextResponse.json({ error: "Cette adresse email est déjà utilisée" }, { status: 409 });
  }

  const data: any = {};
  if (email       !== undefined) data.email       = email;
  if (nom         !== undefined) data.nom         = nom;
  if (prenom      !== undefined) data.prenom      = prenom;
  if (phoneNumber !== undefined) data.phoneNumber = phoneNumber;
  if (isActive    !== undefined) data.isActive    = isActive;
  if (password)                  data.password    = await bcrypt.hash(password, 10);
  if (cu.role === "ADMINISTRATEUR") {
    if (role          !== undefined) data.role          = role;
    if (teamId        !== undefined) data.teamId        = teamId || null;
    if (superviseurId !== undefined) data.superviseurId = superviseurId || null;
  }

  const updated = await prisma.user.update({ where: { id: params.id }, data, select: USER_SELECT });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const cu = session.user as any;
  if (!["ADMINISTRATEUR", "SUPERVISEUR"].includes(cu.role)) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  if (params.id === cu.userId) return NextResponse.json({ error: "Impossible de désactiver votre propre compte" }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  if (cu.role === "SUPERVISEUR" && (target.teamId !== cu.teamId || target.role !== "CONSEILLER")) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  await prisma.user.update({ where: { id: params.id }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
