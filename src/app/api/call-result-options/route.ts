// src/app/api/call-result-options/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  conflict,
  handleApiError,
  readJson,
  requireRole,
  requireUser,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OptionPayload = {
  label?: string;
  value?: string;
  color?: string;
  isActive?: boolean;
  order?: number;
};

export async function GET() {
  try {
    // Every role reads the options — the result modal needs them.
    await requireUser();
    const options = await prisma.callResultOption.findMany({ orderBy: { order: "asc" } });
    return NextResponse.json(options);
  } catch (error) {
    return handleApiError(error, "GET /api/call-result-options");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const { label, value, color, isActive, order } = await readJson<OptionPayload>(req);

    if (!label?.trim() || !value?.trim()) {
      throw badRequest("Label et valeur sont obligatoires");
    }

    const normalizedValue = value.trim().toUpperCase().replace(/\s+/g, "_");
    const existing = await prisma.callResultOption.findUnique({
      where: { value: normalizedValue },
    });
    if (existing) throw conflict("Cette valeur existe déjà");

    const maxOrder = await prisma.callResultOption.aggregate({ _max: { order: true } });

    const option = await prisma.callResultOption.create({
      data: {
        label: label.trim(),
        value: normalizedValue,
        color: color ?? "gray",
        isActive: isActive ?? true,
        order: order ?? (maxOrder._max.order ?? -1) + 1,
      },
    });
    return NextResponse.json(option, { status: 201 });
  } catch (error) {
    return handleApiError(error, "POST /api/call-result-options");
  }
}
