// src/app/api/calls/[id]/result/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  forbidden,
  handleApiError,
  notFound,
  readJson,
  requireUser,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };
type ResultPayload = { resultat?: string; notes?: string | null };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireUser();
    const { resultat, notes } = await readJson<ResultPayload>(req);
    if (!resultat?.trim()) throw badRequest("Résultat requis");

    const call = await prisma.call.findUnique({ where: { id: params.id } });
    if (!call) throw notFound("Appel introuvable");

    // A conseiller may only qualify their own calls; a superviseur, their team's.
    if (user.role === "CONSEILLER" && call.assignedUserId !== user.userId) {
      throw forbidden();
    }
    if (user.role === "SUPERVISEUR" && call.assignedUserId) {
      const owner = await prisma.user.findUnique({
        where: { id: call.assignedUserId },
        select: { teamId: true },
      });
      if (owner?.teamId !== user.teamId) throw forbidden();
    }

    const result = await prisma.callResult.upsert({
      where: { callId: params.id },
      create: {
        callId: params.id,
        userId: user.userId,
        resultat: resultat.trim(),
        notes: notes ?? null,
      },
      update: { resultat: resultat.trim(), notes: notes ?? null },
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, `POST /api/calls/${params.id}/result`);
  }
}
