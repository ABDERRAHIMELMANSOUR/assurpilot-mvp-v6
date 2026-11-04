// src/lib/ringoverEndpoint.ts
//
// Handler shared by the PUBLIC Ringover webhook routes:
//   /api/ringover/answered  -> "Appels décrochés"   (the call is answered: « Répondu », fiche sent)
//   /api/ringover/ended     -> "Appels raccrochés"  (end time and duration; a "missed" event, if
//                              Ringover's "Appels manqués" is pointed here too, = « Manqué »)
// The After-Call Work webhook (the existing n8n workflow) is not touched.
//
// Security, either of:
//   - the secret token of /admin/keyyo in the URL (?token=…) or header x-ringover-token;
//   - the Ringover signature (header X-Ringover-Webhook-Signature, JWT HS512) checked with the
//     webhook key of the Ringover dashboard, set as RINGOVER_WEBHOOK_SECRET in Vercel.
// Otherwise 401 and nothing is written. The on/off switch of /admin/keyyo applies.
// Always answers 200 fast (Ringover retries otherwise); the CRM sending runs in the background.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { applyKeyyoNotification, type ApplyResult } from "@/lib/keyyoCalls";
import { parseRingoverPayload, ringoverSignatureValid, type RingoverEndpoint } from "@/lib/ringoverWebhook";
import { loadKeyyoWebhookSettings, loadRingoverUserMap, recordKeyyoEvent, saveRingoverUser, tokenMatches } from "@/lib/keyyoStore";

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = Object.fromEntries(req.nextUrl.searchParams.entries());
  if (req.method !== "POST") return out;
  try {
    const raw = await req.text();
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("json") || /^\s*[{[]/.test(raw)) {
      const body = JSON.parse(raw);
      if (body && typeof body === "object" && !Array.isArray(body)) Object.assign(out, body);
    } else {
      for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    }
  } catch {
    // Unreadable body: the query string alone is used.
  }
  return out;
}

export async function handleRingoverWebhook(req: NextRequest, endpoint: RingoverEndpoint): Promise<NextResponse> {
  const body = await readBody(req);
  const settings = await loadKeyyoWebhookSettings().catch(() => ({ token: null, enabled: false }));
  const token = req.headers.get("x-ringover-token") ?? (typeof body.token === "string" ? body.token : null);
  const signed = ringoverSignatureValid(req.headers.get("x-ringover-webhook-signature"), (process.env.RINGOVER_WEBHOOK_SECRET ?? "").trim() || null);
  if (!signed && !tokenMatches(token, settings.token)) {
    console.warn(`[ringover] ${endpoint} refusé : jeton ou signature absent ou invalide`);
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  delete body.token;

  const n = parseRingoverPayload(body, endpoint);
  const resource = typeof body.resource === "string" ? body.resource.toLowerCase() : "call";
  let result: ApplyResult = { outcome: "", callId: null, adviserId: null, adviserName: null };
  if (resource !== "call") {
    result.outcome = `ressource Ringover « ${resource} » : ignorée`;
  } else if (!settings.enabled) {
    result.outcome = "notifications désactivées sur /admin/keyyo : reçu, aucun appel créé";
  } else if (n.internal) {
    result.outcome = "appel interne Ringover : ignoré";
  } else {
    try {
      const users = await loadRingoverUserMap();
      if (n.ringoverUserId && users.has(n.ringoverUserId)) n.adviserHint = { ...n.adviserHint, userId: users.get(n.ringoverUserId) };
      // A hangup of an answered call whose "answered" never came (lost, or that webhook not set):
      // the answer is applied first, so the call is « Répondu » with its agent, not « Manqué ».
      if (n.type === "ended" && n.answeredBeforeEnd) {
        await applyKeyyoNotification({ ...n, type: "answered", rawType: `${n.rawType} (décroché)`, eventAt: n.answeredBeforeEnd, durationSeconds: null });
      }
      result = await applyKeyyoNotification(n);
      if (n.ringoverUserId && result.adviserId && (result.matchedBy === "email" || result.matchedBy === "nom") && users.get(n.ringoverUserId) !== result.adviserId) {
        await saveRingoverUser(n.ringoverUserId, result.adviserId);
      }
    } catch (error) {
      result.outcome = `erreur : ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
      console.error("[ringover] événement non traité:", result.outcome);
    }
  }
  await recordKeyyoEvent({
    type: `ringover:${n.rawType}`, callRef: n.callRef, customer: n.customer, adviserId: result.adviserId,
    adviserName: result.adviserName, callId: result.callId, outcome: result.outcome, params: body,
  });
  console.log(`[ringover] ${endpoint} ${n.rawType} ${n.callRef ?? "-"} -> ${result.outcome}`);
  return NextResponse.json({ ok: true, outcome: result.outcome, callId: result.callId });
}
