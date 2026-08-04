// src/app/api/phone-lines/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireUser } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    const lines = await prisma.phoneLine.findMany({
      where: { isActive: true },
      orderBy: { label: "asc" },
    });
    return NextResponse.json(lines);
  } catch (error) {
    return handleApiError(error, "GET /api/phone-lines");
  }
}
