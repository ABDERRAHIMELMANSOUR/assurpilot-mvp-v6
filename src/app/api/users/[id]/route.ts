// src/app/api/users/[id]/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { USER_SELECT } from "@/lib/selects";
import { isDirectReport } from "@/lib/scope";
import {
  badRequest,
  conflict,
  forbidden,
  handleApiError,
  notFound,
  readJson,
  requireRole,
  type SessionUser,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

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

/**
 * A superviseur may only manage conseillers who report directly to them.
 * Team membership is not enough: a team is shared between coaches, so keying
 * off it let one coach edit another's people.
 */
function assertCanManage(
  currentUser: SessionUser,
  target: { role: string; superviseurId: string | null }
) {
  if (currentUser.role !== "SUPERVISEUR") return;
  if (!isDirectReport(currentUser.userId, target)) throw forbidden();
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const currentUser = await requireRole("ADMINISTRATEUR", "SUPERVISEUR");
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: USER_SELECT,
    });
    if (!user) throw notFound("Utilisateur introuvable");
    assertCanManage(currentUser, { role: user.role, superviseurId: user.superviseurId });
    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error, `GET /api/users/${params.id}`);
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const currentUser = await requireRole("ADMINISTRATEUR", "SUPERVISEUR");

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw notFound("Utilisateur introuvable");
    assertCanManage(currentUser, target);

    const { email, nom, prenom, phoneNumber, password, role, teamId, superviseurId, isActive } =
      await readJson<UserPayload>(req);

    const data: Prisma.UserUpdateInput = {};

    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) throw badRequest("L'email ne peut pas être vide");
      if (normalizedEmail !== target.email) {
        const duplicate = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (duplicate) throw conflict("Cette adresse email est déjà utilisée");
      }
      data.email = normalizedEmail;
    }
    if (nom !== undefined) {
      if (!nom.trim()) throw badRequest("Le nom ne peut pas être vide");
      data.nom = nom.trim();
    }
    if (prenom !== undefined) {
      if (!prenom.trim()) throw badRequest("Le prénom ne peut pas être vide");
      data.prenom = prenom.trim();
    }
    if (phoneNumber !== undefined) data.phoneNumber = phoneNumber.trim();
    if (isActive !== undefined) data.isActive = isActive;
    if (password) data.password = await bcrypt.hash(password, 10);

    // Role, team and coach assignment stay admin-only.
    if (currentUser.role === "ADMINISTRATEUR") {
      if (role !== undefined) data.role = role;
      if (teamId !== undefined) {
        data.team = teamId ? { connect: { id: teamId } } : { disconnect: true };
      }
      if (superviseurId !== undefined) {
        data.superviseur = superviseurId
          ? { connect: { id: superviseurId } }
          : { disconnect: true };
      }
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
      select: USER_SELECT,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, `PUT /api/users/${params.id}`);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const currentUser = await requireRole("ADMINISTRATEUR", "SUPERVISEUR");
    if (params.id === currentUser.userId) {
      throw badRequest("Impossible de désactiver votre propre compte");
    }

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw notFound("Utilisateur introuvable");
    assertCanManage(currentUser, target);

    // Soft delete — the call history keeps pointing at this user.
    await prisma.user.update({ where: { id: params.id }, data: { isActive: false } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, `DELETE /api/users/${params.id}`);
  }
}
