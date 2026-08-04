// src/app/api/call-result-options/[id]/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, notFound, readJson, requireRole } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

type OptionPayload = {
  label?: string;
  color?: string;
  isActive?: boolean;
  order?: number | string;
};

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    await requireRole("ADMINISTRATEUR");
    const { label, color, isActive, order } = await readJson<OptionPayload>(req);

    const option = await prisma.callResultOption.findUnique({ where: { id: params.id } });
    if (!option) throw notFound("Option introuvable");

    const data: Prisma.CallResultOptionUpdateInput = {};
    if (label !== undefined) {
      if (!label.trim()) throw badRequest("Le label ne peut pas être vide");
      data.label = label.trim();
    }
    if (color !== undefined) data.color = color;
    if (isActive !== undefined) data.isActive = isActive;
    if (order !== undefined) {
      const parsedOrder = Number(order);
      if (!Number.isFinite(parsedOrder)) throw badRequest("Ordre invalide");
      data.order = parsedOrder;
    }

    const updated = await prisma.callResultOption.update({ where: { id: params.id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, `PUT /api/call-result-options/${params.id}`);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireRole("ADMINISTRATEUR");

    const option = await prisma.callResultOption.findUnique({ where: { id: params.id } });
    if (!option) throw notFound("Option introuvable");

    const inUse = await prisma.callResult.count({ where: { resultat: option.value } });
    if (inUse > 0) {
      // Soft delete — hard-deleting would orphan the historical results.
      const updated = await prisma.callResultOption.update({
        where: { id: params.id },
        data: { isActive: false },
      });
      return NextResponse.json({
        ...updated,
        warning: `Cette option est utilisée par ${inUse} appel(s). Elle a été désactivée plutôt que supprimée.`,
      });
    }

    await prisma.callResultOption.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, `DELETE /api/call-result-options/${params.id}`);
  }
}
