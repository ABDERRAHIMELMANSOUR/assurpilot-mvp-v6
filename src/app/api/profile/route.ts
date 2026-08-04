// src/app/api/profile/route.ts
// Self-service profile management — any authenticated user can read and update their own profile.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  conflict,
  handleApiError,
  notFound,
  readJson,
  requireUser,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROFILE_SELECT = {
  id: true,
  email: true,
  nom: true,
  prenom: true,
  phoneNumber: true,
  role: true,
  isActive: true,
  createdAt: true,
  lastLoginAt: true,
  team: { select: { id: true, nom: true } },
  superviseur: { select: { id: true, nom: true, prenom: true } },
} as const;

type ProfilePayload = {
  nom?: string;
  prenom?: string;
  phoneNumber?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
};

export async function GET() {
  try {
    const sessionUser = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.userId },
      select: PROFILE_SELECT,
    });
    if (!user) throw notFound("Utilisateur introuvable");
    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error, "GET /api/profile");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const sessionUser = await requireUser();
    const { nom, prenom, phoneNumber, email, currentPassword, newPassword } =
      await readJson<ProfilePayload>(req);

    if (!nom?.trim() || !prenom?.trim()) {
      throw badRequest("Prénom et nom sont obligatoires");
    }

    const user = await prisma.user.findUnique({ where: { id: sessionUser.userId } });
    if (!user) throw notFound("Utilisateur introuvable");

    const data: Prisma.UserUpdateInput = {
      nom: nom.trim(),
      prenom: prenom.trim(),
      phoneNumber: phoneNumber?.trim() ?? user.phoneNumber,
    };

    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) throw badRequest("L'email ne peut pas être vide");
      if (normalizedEmail !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) throw conflict("Cette adresse email est déjà utilisée");
        data.email = normalizedEmail;
      }
    }

    if (newPassword) {
      if (!currentPassword) {
        throw badRequest("Veuillez saisir votre mot de passe actuel pour le modifier");
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) throw badRequest("Mot de passe actuel incorrect");
      if (newPassword.length < 6) {
        throw badRequest("Le nouveau mot de passe doit contenir au moins 6 caractères");
      }
      data.password = await bcrypt.hash(newPassword, 10);
    }

    const updated = await prisma.user.update({
      where: { id: sessionUser.userId },
      data,
      select: PROFILE_SELECT,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, "PUT /api/profile");
  }
}
