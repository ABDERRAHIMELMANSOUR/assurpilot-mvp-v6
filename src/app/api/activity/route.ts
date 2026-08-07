// src/app/api/activity/route.ts
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireRole } from "@/lib/api";
import { directReportsWhere } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireRole("ADMINISTRATEUR", "SUPERVISEUR");

    const where: Prisma.UserWhereInput =
      user.role === "SUPERVISEUR"
        ? directReportsWhere(user.userId)
        : { role: "CONSEILLER" };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        loginLogs: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, createdAt: true, ip: true },
        },
      },
      orderBy: { lastLoginAt: "desc" },
    });

    return NextResponse.json(users);
  } catch (error) {
    return handleApiError(error, "GET /api/activity");
  }
}
