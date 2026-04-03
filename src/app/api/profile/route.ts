// src/app/api/profile/route.ts
// Self-service profile management — any authenticated user can read and update their own profile
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const userId = (session.user as any).userId;
  const user   = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, nom: true, prenom: true,
      phoneNumber: true, role: true, isActive: true,
      createdAt: true, lastLoginAt: true,
      team:       { select: { id: true, nom: true } },
      superviseur:{ select: { id: true, nom: true, prenom: true } },
    },
  });

  if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  return NextResponse.json(user);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const userId = (session.user as any).userId;
  const body   = await req.json();
  const { nom, prenom, phoneNumber, email, currentPassword, newPassword } = body;

  if (!nom?.trim() || !prenom?.trim()) {
    return NextResponse.json({ error: "Prénom et nom sont obligatoires" }, { status: 400 });
  }

  // Fetch current user to check password if needed
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });

  const data: any = {
    nom:         nom.trim(),
    prenom:      prenom.trim(),
    phoneNumber: phoneNumber?.trim() ?? user.phoneNumber,
  };

  // Email change: check it's not already taken
  if (email && email.trim() !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: email.trim() } });
    if (existing) return NextResponse.json({ error: "Cette adresse email est déjà utilisée" }, { status: 409 });
    data.email = email.trim();
  }

  // Password change: requires currentPassword
  if (newPassword) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Veuillez saisir votre mot de passe actuel pour le modifier" }, { status: 400 });
    }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Mot de passe actuel incorrect" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: "Le nouveau mot de passe doit contenir au moins 6 caractères" }, { status: 400 });
    }
    data.password = await bcrypt.hash(newPassword, 10);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true, email: true, nom: true, prenom: true,
      phoneNumber: true, role: true,
      team: { select: { id: true, nom: true } },
    },
  });

  return NextResponse.json(updated);
}
