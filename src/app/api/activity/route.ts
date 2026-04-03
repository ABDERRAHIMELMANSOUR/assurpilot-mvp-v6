// src/app/api/activity/route.ts
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

  // Build user scope
  let userWhere: any = { role: "CONSEILLER" };
  if (user.role === "SUPERVISEUR") {
    userWhere.teamId = user.teamId;
  }

  const users = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true, nom: true, prenom: true, email: true,
      role: true, isActive: true, lastLoginAt: true,
      loginLogs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, createdAt: true, ip: true },
      },
    },
    orderBy: { lastLoginAt: "desc" },
  });

  return NextResponse.json(users);
}
