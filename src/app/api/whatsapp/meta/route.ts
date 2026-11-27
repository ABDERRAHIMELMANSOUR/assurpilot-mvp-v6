// src/app/api/whatsapp/meta/route.ts
//
// GET: what the chat panel needs besides the conversations — the templates and
// their expected number of variables, and the people the viewer may assign a
// conversation to (none for a conseiller; self + direct reports for a coach;
// every active conseiller and coach for an admin).
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireUser } from "@/lib/api";
import { directReportsWhere } from "@/lib/scope";
import { TEMPLATES, templateParamCounts } from "@/lib/whatsapp/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const counts = templateParamCounts();

    let where: Prisma.UserWhereInput | null = null;
    if (user.role === "ADMINISTRATEUR") where = { isActive: true, role: { in: ["CONSEILLER", "SUPERVISEUR"] } };
    if (user.role === "SUPERVISEUR") where = { isActive: true, OR: [{ id: user.userId }, directReportsWhere(user.userId)] };

    const assignees = where
      ? await prisma.user.findMany({
          where,
          select: { id: true, nom: true, prenom: true, role: true, superviseurId: true },
          orderBy: [{ nom: "asc" }, { prenom: "asc" }],
        })
      : [];

    return NextResponse.json({
      templates: TEMPLATES.map((t) => ({ ...t, params: counts[t.name] ?? null })),
      assignees,
    });
  } catch (error) {
    return handleApiError(error, "GET /api/whatsapp/meta");
  }
}
