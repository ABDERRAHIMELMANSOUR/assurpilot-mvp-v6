// src/app/api/whatsapp/webhook/route.ts
//
// The URL registered in Meta (App → WhatsApp → Configuration → Webhook),
// subscribed to the "messages" field. PUBLIC: no session; it authenticates
// Meta instead.
//
//   GET  : Meta's one-time verification. Answers hub.challenge only when
//          hub.verify_token equals WHATSAPP_VERIFY_TOKEN.
//   POST : incoming messages and statuses of our messages. The body is accepted
//          only with a valid X-Hub-Signature-256 (HMAC of the raw body with
//          WHATSAPP_APP_SECRET). Meta retries anything that is not a 2xx, and a
//          message delivered twice is stored once (unique Meta id).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { appSecret, verifyToken } from "@/lib/whatsapp/config";
import { verifySignature } from "@/lib/whatsapp/graph";
import { ingestWebhook, type WaWebhookPayload } from "@/lib/whatsapp/store";
import { withWhatsAppTables } from "@/lib/whatsapp/tables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = verifyToken();
  if (!expected) return new NextResponse("WHATSAPP_VERIFY_TOKEN non configuré", { status: 503 });
  if (p.get("hub.mode") === "subscribe" && sameText(p.get("hub.verify_token") ?? "", expected)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = appSecret();
  // Unsigned bodies are accepted only on a developer's machine, on purpose.
  const allowUnsigned = process.env.NODE_ENV !== "production" && process.env.WHATSAPP_ALLOW_UNSIGNED === "true";

  if (!secret && !allowUnsigned) {
    console.error("[whatsapp] webhook refused: WHATSAPP_APP_SECRET is not set");
    return NextResponse.json({ error: "Webhook non configuré" }, { status: 503 });
  }
  if (secret && !verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    console.error("[whatsapp] webhook refused: bad signature");
    return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
  }

  let payload: WaWebhookPayload;
  try {
    payload = JSON.parse(raw) as WaWebhookPayload;
  } catch {
    // Signed but not JSON: nothing to retry.
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const report = await withWhatsAppTables(() => ingestWebhook(payload));
    if (report.ignored) console.info("[whatsapp] webhook:", report);
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    // A 5xx makes Meta retry later, which is what we want on a database hiccup.
    console.error("[whatsapp] webhook processing failed:", error);
    return NextResponse.json({ error: "Traitement impossible" }, { status: 500 });
  }
}
