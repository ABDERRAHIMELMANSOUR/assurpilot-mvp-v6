// src/app/api/teams/route.ts
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireRole } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireRole("ADMINISTRATEUR", "SUPERVISEUR");

    // A coach only sees the teams they belong to or supervise; an admin sees
    // all of them (the team picker on the user form needs the full list).
    const where: Prisma.TeamWhereInput =
      user.role === "SUPERVISEUR"
        ? {
            OR: [
              ...(user.teamId ? [{ id: user.teamId }] : []),
              { superviseurId: user.userId },
            ],
          }
        : {};

    const teams = await prisma.team.findMany({
      where,
      include: {
        superviseur: { select: { id: true, nom: true, prenom: true } },
        // The conseiller count must reflect the caller's scope, not the whole team.
        users: {
          where:
            user.role === "SUPERVISEUR"
              ? { role: "CONSEILLER", superviseurId: user.userId }
              : { role: "CONSEILLER" },
          select: { id: true },
        },
      },
      orderBy: { nom: "asc" },
    });

    return NextResponse.json(
      teams.map((team) => ({
        id: team.id,
        nom: team.nom,
        description: team.description,
        superviseurId: team.superviseurId,
        superviseur: team.superviseur,
        conseillerCount: team.users.length,
      }))
    );
  } catch (error) {
    return handleApiError(error, "GET /api/teams");
  }
}
