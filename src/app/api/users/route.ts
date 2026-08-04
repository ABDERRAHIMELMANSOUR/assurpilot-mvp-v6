// src/app/api/users/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { USER_SELECT } from "@/lib/selects";
import {
  badRequest,
  conflict,
  forbidden,
  handleApiError,
  readJson,
  requireRole,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserPayload = {
  email?: string;
  nom?: string;
  prenom?: string;
  phoneNumber?: string;
  password?: string;
  role?: string;
  teamId?: string | null;
  superviseurId?: string | null;
  isActive?: boolean;
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireRole("ADMINISTRATEUR", "SUPERVISEUR");
    const roleFilter = new URL(req.url).searchParams.get("role");

    const where: Prisma.UserWhereInput =
      user.role === "SUPERVISEUR"
        ? { role: "CONSEILLER", teamId: user.teamId }
        : { role: roleFilter ?? { in: ["CONSEILLER", "SUPERVISEUR"] } };

    const users = await prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: [{ role: "asc" }, { nom: "asc" }],
    });
    return NextResponse.json(users);
  } catch (error) {
    return handleApiError(error, "GET /api/users");
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await requireRole("ADMINISTRATEUR", "SUPERVISEUR");
    const body = await readJson<UserPayload>(req);
    const { email, nom, prenom, phoneNumber, password, role, teamId, superviseurId, isActive } = body;

    if (!email?.trim() || !nom?.trim() || !prenom?.trim() || !password) {
      throw badRequest("Champs obligatoires manquants (email, nom, prénom, mot de passe)");
    }
    if (currentUser.role === "SUPERVISEUR" && role && role !== "CONSEILLER") {
      throw forbidden("Vous ne pouvez créer que des conseillers");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw conflict("Cette adresse email est déjà utilisée");

    const isSuperviseur = currentUser.role === "SUPERVISEUR";
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: await bcrypt.hash(password, 10),
        nom: nom.trim(),
        prenom: prenom.trim(),
        phoneNumber: phoneNumber?.trim() ?? "",
        role: isSuperviseur ? "CONSEILLER" : role ?? "CONSEILLER",
        teamId: isSuperviseur ? currentUser.teamId : teamId ?? null,
        superviseurId: isSuperviseur ? currentUser.userId : superviseurId ?? null,
        isActive: isActive ?? true,
      },
      select: USER_SELECT,
    });
    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    return handleApiError(error, "POST /api/users");
  }
}
