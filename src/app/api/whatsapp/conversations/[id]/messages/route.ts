// src/app/api/whatsapp/conversations/[id]/messages/route.ts
//
// POST: send a message in a conversation, from the ACTIVE number.
//   { type: "text", body }                         — only inside the 24-hour window
//   { type: "template", templateName, params[] }   — any time
// Only the conversation's owner or an administrator may send.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { forbidden, handleApiError, readJson, requireUser } from "@/lib/api";
import { canReply, loadVisibleConversation } from "@/lib/whatsapp/scope";
import { parseSendRequest, sendInConversation } from "@/lib/whatsapp/send";
import { withWhatsAppTables } from "@/lib/whatsapp/tables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const request = parseSendRequest(await readJson(req));
    const conv = await withWhatsAppTables(() => loadVisibleConversation(user, params.id));
    if (!canReply(user, conv)) throw forbidden("Seul le conseiller de ce client ou un administrateur peut écrire");

    const message = await sendInConversation(conv, request, user.userId);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "POST /api/whatsapp/conversations/[id]/messages");
  }
}
