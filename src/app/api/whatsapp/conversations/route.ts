// src/app/api/whatsapp/conversations/route.ts
//
// GET: the conversations the viewer may see (src/lib/whatsapp/scope.ts), most
// recent first. Filters: ?owner=<userId> (a coach's adviser, or anyone for an
// admin), ?unassigned=1 (admin: the queue), ?q= (number or name).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireUser } from "@/lib/api";
import { conversationScopeFor } from "@/lib/whatsapp/scope";
import { withWhatsAppTables, WHATSAPP_TABLES_HINT, isMissingTable } from "@/lib/whatsapp/tables";
import { activeNumber } from "@/lib/whatsapp/config";
import { serviceWindow } from "@/lib/whatsapp/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 300;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const p = req.nextUrl.searchParams;

    const clauses: Prisma.WaConversationWhereInput[] = [conversationScopeFor(user)];
    const owner = p.get("owner");
    if (owner) clauses.push({ ownerUserId: owner });
    if (p.get("unassigned") === "1") clauses.push({ ownerUserId: null });
    const q = (p.get("q") ?? "").trim();
    if (q) {
      const digits = q.replace(/\D/g, "");
      clauses.push({
        OR: [
          { clientName: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 3 ? [{ waId: { contains: digits.replace(/^0/, "") } }, { clientPhone: { contains: digits } }] : []),
        ],
      });
    }

    const [rows, number] = await Promise.all([
      withWhatsAppTables(() =>
        prisma.waConversation.findMany({
          where: { AND: clauses },
          include: { owner: { select: { id: true, nom: true, prenom: true } } },
          orderBy: { lastMessageAt: "desc" },
          take: MAX_ROWS,
        })
      ),
      activeNumber(),
    ]);

    return NextResponse.json({
      activeSlot: number.slot,
      conversations: rows.map((c) => ({
        id: c.id,
        waId: c.waId,
        clientPhone: c.clientPhone,
        clientName: c.clientName,
        owner: c.owner,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
        unreadCount: c.unreadCount,
        windowOpen: serviceWindow(c, number.phoneNumberId).open,
      })),
    });
  } catch (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: WHATSAPP_TABLES_HINT }, { status: 503 });
    return handleApiError(error, "GET /api/whatsapp/conversations");
  }
}
