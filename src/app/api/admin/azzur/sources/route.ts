// src/app/api/admin/azzur/sources/route.ts
//
// What can be reviewed before sending to AZZUR: the latest Excel imports, and
// today's calls. ADMIN ONLY.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireRole } from "@/lib/api";
import { parisDayBounds } from "@/lib/azzur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const { start, end } = parisDayBounds();
    const [batches, today] = await Promise.all([
      prisma.importBatch.findMany({
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { id: true, fileName: true, importedRows: true, createdAt: true },
      }),
      prisma.call.count({ where: { startedAt: { gte: start, lt: end } } }),
    ]);
    return NextResponse.json({
      today: { source: "today", label: "Appels d'aujourd'hui", calls: today },
      batches: batches.map((b) => ({
        source: `batch:${b.id}`,
        label: b.fileName,
        calls: b.importedRows,
        at: b.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/azzur/sources");
  }
}
