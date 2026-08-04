// src/app/api/teams/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireRole } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR", "SUPERVISEUR");

    const teams = await prisma.team.findMany({
      include: {
        superviseur: { select: { id: true, nom: true, prenom: true } },
        users: { where: { role: "CONSEILLER" }, select: { id: true } },
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
