// src/app/api/teams/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  if (!["ADMINISTRATEUR", "SUPERVISEUR"].includes(user.role)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const teams = await prisma.team.findMany({
    include: {
      superviseur: { select: { id: true, nom: true, prenom: true } },
      users: {
        where: { role: "CONSEILLER" },
        select: { id: true },
      },
    },
    orderBy: { nom: "asc" },
  });

  return NextResponse.json(
    teams.map((t) => ({
      id: t.id,
      nom: t.nom,
      description: t.description,
      superviseurId: t.superviseurId,
      superviseur: t.superviseur,
      conseillerCount: t.users.length,
    }))
  );
}
