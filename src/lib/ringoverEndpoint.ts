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
//
// FILTER: only INBOUND calls FORWARDED FROM THE KEYYO STANDARD go through:
//   - data.direction = inbound (outbound, internal, missing direction: dropped);
//   - and the call comes from a Keyyo standard line (keyyoStandardOrigin in ringoverWebhook.ts:
//     a redirection / transfer field naming a standard line, the number called being a Ringover
//     number declared on /admin/keyyo WITH its standard line, or the number called being a
//     standard line). A direct call to Ringover or from elsewhere: dropped.
// The standard line gives the agency (CPA / ALM): the call is filed on that line and the
// adviser of that agency is preferred (same person with an account in each agency).
// Dropped events are answered 200 (Ringover does not retry): no call, no journal row, no number
// logged. A kept call is filed on the standard line it came from; the journal keeps the
// customer's number (from_number / caller), the number called (to_number / callee), the Keyyo
// standard line, with the event, direction and call_id.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadStandardLines } from "@/lib/keyyoStandard";
import { applyKeyyoNotification, type ApplyResult } from "@/lib/keyyoCalls";
import { keyyoStandardOrigin, parseForwardTargets, parseRingoverPayload, ringoverSignatureValid, type RingoverEndpoint } from "@/lib/ringoverWebhook";
import {
  loadKeyyoWebhookSettings, loadRingoverForwardTargetsText, loadRingoverUserMap, recordKeyyoEvent, saveRingoverUser, tokenMatches,
} from "@/lib/keyyoStore";


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

  // Inbound calls only. Everything else is dropped here, before anything is written.
  const dropped =
    resource !== "call" ? `ressource « ${resource} »`
      : n.internal ? "appel interne"
        : !n.inbound ? (n.rawDirection ? `appel ${n.rawDirection === "out" || n.rawDirection === "outbound" ? "sortant" : `« ${n.rawDirection} »`}` : "direction absente")
          : null;
  if (dropped) {
    console.log(`[ringover] ${endpoint} ${n.rawType} ${n.callRef ?? "-"} : ${dropped}, ignoré (seuls les appels entrants sont traités)`);
    return NextResponse.json({ ok: true, ignored: true, outcome: `${dropped} : ignoré (seuls les appels entrants sont traités)` });
  }

  // …and only those forwarded from the Keyyo standard.
  const [standard, targetsText] = await Promise.all([loadStandardLines(), loadRingoverForwardTargetsText()]);
  const targets = parseForwardTargets(`${targetsText}\n${process.env.RINGOVER_KEYYO_NUMBERS ?? ""}`);
  const origin = keyyoStandardOrigin(n, new Set(standard.keys()), targets);
  if (!origin) {
    console.log(`[ringover] ${endpoint} ${n.rawType} ${n.callRef ?? "-"} : ne vient pas du standard Keyyo, ignoré`);
    return NextResponse.json({ ok: true, ignored: true, outcome: "appel ne venant pas du standard Keyyo : ignoré" });
  }
  // Filed on the standard line it came from (the "Ligne" column, the CRM link of the team), in its
  // agency: the adviser of that agency is preferred.
  const standardLine = origin.line ? standard.get(origin.line) ?? null : null;
  if (origin.line) n.lineCandidates = [origin.line, ...n.lineCandidates.filter((x) => x !== origin.line)];
  n.preferAgency = standardLine?.agency ?? null;

  // The customer: from_number, unless that is one of our own numbers (the standard presenting its
  // line, or a declared Ringover number) — then the original caller of another field.
  const ours = (x: string) => standard.has(x) || targets.has(x);
  if (n.from && ours(n.from)) {
    const original = n.customerAlternates.find((x) => !ours(x));
    n.customer = original ?? "";
  }

  let result: ApplyResult = { outcome: "", callId: null, adviserId: null, adviserName: null };
  if (!settings.enabled) {
    result.outcome = "notifications désactivées sur /admin/keyyo : reçu, aucun appel créé";
  } else {
    try {
      // The adviser already linked to this Ringover user in this agency (else in any).
      const users = await loadRingoverUserMap();
      const userKey = n.ringoverUserId && n.preferAgency ? `${n.ringoverUserId}@${n.preferAgency}` : null;
      const linked = (userKey && users.get(userKey)) || (n.ringoverUserId && users.get(n.ringoverUserId)) || null;
      if (linked) n.adviserHint = { ...n.adviserHint, userId: linked };
      // A hangup of an answered call whose "answered" never came (lost, or that webhook not set):
      // the answer is applied first, so the call is « Répondu » with its agent, not « Manqué ».
      if (n.type === "ended" && n.answeredBeforeEnd) {
        await applyKeyyoNotification({ ...n, type: "answered", rawType: `${n.rawType} (décroché)`, eventAt: n.answeredBeforeEnd, durationSeconds: null });
      }
      result = await applyKeyyoNotification(n);
      if (n.ringoverUserId && result.adviserId && (result.matchedBy === "email" || result.matchedBy === "nom" || result.matchedBy === "id")) {
        // Remembered per agency: one Ringover user may have an AssurPilot account in CPA and in ALM.
        const key = userKey ?? n.ringoverUserId;
        if (users.get(key) !== result.adviserId) await saveRingoverUser(key, result.adviserId);
      }
    } catch (error) {
      result.outcome = `erreur : ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
      console.error("[ringover] événement non traité:", result.outcome);
    }
  }
  // Journal: the two numbers of the inbound call, and only what identifies the event.
  await recordKeyyoEvent({
    type: `ringover:${n.rawType}`, callRef: n.callRef, customer: n.customer, called: n.called, adviserId: result.adviserId,
    adviserName: result.adviserName, callId: result.callId, outcome: result.outcome,
    params: {
      endpoint, event: n.rawType, direction: n.rawDirection, call_id: n.callRef?.replace(/^ringover:/, "") ?? null,
      from_number: n.customer, ...(n.from !== n.customer ? { from_number_recu: n.from } : {}), to_number: n.called,
      standard_keyyo: origin.line, ligne: standardLine?.label ?? null, agence: standardLine?.agency ?? null, via: origin.via,
    },
  });
  console.log(`[ringover] ${endpoint} ${n.rawType} entrant (standard Keyyo ${standardLine?.label ?? origin.line ?? "?"}, ${origin.via}) ${n.callRef ?? "-"} client=${n.customer || "(masqué)"} appelé=${n.called || "-"} -> ${result.outcome}`);
  return NextResponse.json({ ok: true, outcome: result.outcome, callId: result.callId });
}
