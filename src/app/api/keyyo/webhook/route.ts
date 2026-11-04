// src/app/api/keyyo/webhook/route.ts
//
// PUBLIC endpoint for Keyyo's "Notification d'appels": the URL configured on each adviser's
// Keyyo line, https://<app>/api/keyyo/webhook?token=<secret>. Keyyo adds its parameters
// (account, caller, callee, callref, type…) to it, by GET; POST (form or JSON) is accepted too.
//
// Security: no session here, so the secret token decides (query "token" or header
// x-keyyo-token, compared in constant time; set on /admin/keyyo or by KEYYO_WEBHOOK_TOKEN).
// Wrong token -> 401, nothing written. Switched off on /admin/keyyo -> journaled, no call.
//
// Always answers fast: Keyyo does not wait for the CRM — the fiche is sent in the background.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseKeyyoNotification } from "@/lib/keyyoWebhook";
import { applyKeyyoNotification } from "@/lib/keyyoCalls";
import { loadKeyyoWebhookSettings, recordKeyyoEvent, tokenMatches } from "@/lib/keyyoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

async function readParams(req: NextRequest): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = Object.fromEntries(req.nextUrl.searchParams.entries());
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    try {
      if (type.includes("application/json")) {
        const body = await req.json();
        if (body && typeof body === "object" && !Array.isArray(body)) Object.assign(params, body);
      } else {
        const text = await req.text();
        for (const [k, v] of new URLSearchParams(text)) params[k] = v;
      }
    } catch {
      // An unreadable body: the query string alone is used.
    }
  }
  return params;
}

async function handle(req: NextRequest) {
  const params = await readParams(req);
  const settings = await loadKeyyoWebhookSettings().catch(() => ({ token: null, enabled: false }));
  const given = req.headers.get("x-keyyo-token") ?? (typeof params.token === "string" ? params.token : null);
  if (!tokenMatches(given, settings.token)) {
    console.warn("[keyyo] notification refusée : jeton absent ou invalide");
    return new NextResponse("unauthorized", { status: 401 });
  }

  const n = parseKeyyoNotification(params);
  let outcome: string;
  let callId: string | null = null;
  let adviserId: string | null = null;
  let adviserName: string | null = null;
  if (!settings.enabled) {
    outcome = "webhook désactivé sur /admin/keyyo : reçu, aucun appel créé";
  } else {
    try {
      ({ outcome, callId, adviserId, adviserName } = await applyKeyyoNotification(n));
    } catch (error) {
      outcome = `erreur : ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
      console.error("[keyyo] notification non traitée:", outcome);
    }
  }
  await recordKeyyoEvent({ type: n.rawType || n.type, callRef: n.callRef, customer: n.customer, adviserId, adviserName, callId, outcome, params });
  console.log(`[keyyo] ${n.rawType || n.type} ref=${n.callRef ?? "-"} -> ${outcome}`);
  // Keyyo only needs a 200; the text helps when testing the URL by hand.
  return new NextResponse(`OK ${outcome}`, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
