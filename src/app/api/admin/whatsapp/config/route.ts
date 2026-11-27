// src/app/api/admin/whatsapp/config/route.ts
//
// ADMINISTRATOR ONLY. The WhatsApp configuration page:
//   GET : the two numbers (main, backup) as configured in the environment, which
//         one is sending, which variables are set (booleans, never their
//         values), the webhook URL to paste into Meta, and the switch history.
//   PUT : { activeSlot: "PRIMARY" | "BACKUP" } — switch the sending number.
//         Incoming messages keep arriving on both numbers; only sending moves.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, conflict, handleApiError, readJson, requireRole } from "@/lib/api";
import {
  allNumbers,
  configStatus,
  loadActiveSlot,
  publicBaseUrl,
  saveActiveSlot,
  waNumber,
  type WaSlot,
} from "@/lib/whatsapp/config";
import { withWhatsAppTables } from "@/lib/whatsapp/tables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function webhookUrl(): string | null {
  const base = publicBaseUrl().replace(/\/+$/, "");
  return base ? `${base}/api/whatsapp/webhook` : null;
}

async function state() {
  const [activeSlot, history, unassigned] = await Promise.all([
    loadActiveSlot(),
    withWhatsAppTables(() => prisma.waSwitchLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 })),
    withWhatsAppTables(() => prisma.waConversation.count({ where: { ownerUserId: null } })),
  ]);
  return {
    activeSlot,
    numbers: allNumbers(),
    status: configStatus(),
    webhookUrl: webhookUrl(),
    unassigned,
    history,
  };
}

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    return NextResponse.json(await state());
  } catch (error) {
    return handleApiError(error, "GET /api/admin/whatsapp/config");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ activeSlot?: unknown }>(req);
    if (body.activeSlot !== "PRIMARY" && body.activeSlot !== "BACKUP") {
      throw badRequest('activeSlot doit valoir "PRIMARY" ou "BACKUP"');
    }
    const to = body.activeSlot as WaSlot;
    if (!waNumber(to).configured) {
      throw conflict(`${waNumber(to).label} n'est pas configuré (Phone Number ID manquant dans les variables d'environnement)`);
    }
    const from = await loadActiveSlot();
    if (from !== to) {
      await saveActiveSlot(to, admin.userId);
      await withWhatsAppTables(() =>
        prisma.waSwitchLog.create({ data: { fromSlot: from, toSlot: to, actorId: admin.userId, actorName: admin.name ?? "" } })
      );
    }
    return NextResponse.json(await state());
  } catch (error) {
    return handleApiError(error, "PUT /api/admin/whatsapp/config");
  }
}
