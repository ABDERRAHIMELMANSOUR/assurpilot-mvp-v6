// src/app/api/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const USER_SELECT = {
  id: true, nom: true, prenom: true, email: true, phoneNumber: true,
  role: true, isActive: true, teamId: true,
  superviseurId: true, createdAt: true, lastLoginAt: true,
  team:        { select: { id: true, nom: true } },
  superviseur: { select: { id: true, nom: true, prenom: true, phoneNumber: true } },
} as const;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  const { searchParams } = new URL(req.url);
  const roleFilter = searchParams.get("role");

  let where: any = {};
  if (user.role === "SUPERVISEUR") {
    where = { role: "CONSEILLER", teamId: user.teamId };
  } else if (user.role === "ADMINISTRATEUR") {
    where.role = roleFilter ? roleFilter : { in: ["CONSEILLER", "SUPERVISEUR"] };
  } else {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where,
    select: USER_SELECT,
    orderBy: [{ role: "asc" }, { nom: "asc" }],
  });
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const currentUser = session.user as any;
  if (!["ADMINISTRATEUR", "SUPERVISEUR"].includes(currentUser.role)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json();
  const { email, nom, prenom, phoneNumber, password, role, teamId, superviseurId, isActive } = body;

  if (!email || !nom || !prenom || !password) {
    return NextResponse.json({ error: "Champs obligatoires manquants (email, nom, prénom, mot de passe)" }, { status: 400 });
  }
  if (currentUser.role === "SUPERVISEUR" && role && role !== "CONSEILLER") {
    return NextResponse.json({ error: "Vous ne pouvez créer que des conseillers" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "Cette adresse email est déjà utilisée" }, { status: 409 });

  const finalSuperviseurId = currentUser.role === "SUPERVISEUR" ? currentUser.userId : (superviseurId ?? null);

  const newUser = await prisma.user.create({
    data: {
      email, password: await bcrypt.hash(password, 10),
      nom, prenom,
      phoneNumber: phoneNumber ?? "",
      role:         currentUser.role === "SUPERVISEUR" ? "CONSEILLER" : (role ?? "CONSEILLER"),
      teamId:       currentUser.role === "SUPERVISEUR" ? currentUser.teamId : (teamId ?? null),
      superviseurId: finalSuperviseurId,
      isActive:     isActive !== undefined ? isActive : true,
    },
    select: USER_SELECT,
  });
  return NextResponse.json(newUser, { status: 201 });
}
