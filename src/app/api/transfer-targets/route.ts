// src/app/api/transfer-targets/route.ts
//
// The conseillers the caller may hand a call to. Exists as its own endpoint
// because /api/users is admin/coach-only, and a conseiller needs this list to
// populate the transfer picker without being granted user-management access.
//
// Rules:
//   CONSEILLER  -> any active conseiller in the SAME entity (CPA or ALM),
//                  across every coach in that entity. Never across entities.
//   SUPERVISEUR -> the conseillers reporting to them.
//   ADMIN       -> every active conseiller.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireUser } from "@/lib/api";
import { directReportsWhere } from "@/lib/scope";
import { entityOfTeamName, userEntityWhere } from "@/lib/entity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();

    if (user.role === "ADMINISTRATEUR") {
      const all = await prisma.user.findMany({
        where: { role: "CONSEILLER", isActive: true },
        select: { id: true, nom: true, prenom: true, team: { select: { nom: true } } },
        orderBy: [{ nom: "asc" }],
      });
      return NextResponse.json({ entity: null, targets: all });
    }

    if (user.role === "SUPERVISEUR") {
      const mine = await prisma.user.findMany({
        where: { ...directReportsWhere(user.userId), isActive: true },
        select: { id: true, nom: true, prenom: true, team: { select: { nom: true } } },
        orderBy: [{ nom: "asc" }],
      });
      return NextResponse.json({ entity: null, targets: mine });
    }

    // Conseiller: entity comes from their own team.
    const me = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { team: { select: { nom: true } } },
    });
    const entity = entityOfTeamName(me?.team?.nom);

    // No entity means the conseiller sits outside the CPA/ALM structure; with
    // no boundary to enforce, offering targets would risk a cross-entity
    // transfer, so the list is empty rather than unrestricted.
    if (!entity) return NextResponse.json({ entity: null, targets: [] });

    const peers = await prisma.user.findMany({
      where: {
        AND: [
          { role: "CONSEILLER", isActive: true },
          userEntityWhere(entity),
          { NOT: { id: user.userId } }, // no point transferring to yourself
        ],
      },
      select: { id: true, nom: true, prenom: true, team: { select: { nom: true } } },
      orderBy: [{ nom: "asc" }],
    });

    return NextResponse.json({ entity, targets: peers });
  } catch (error) {
    return handleApiError(error, "GET /api/transfer-targets");
  }
}
