// src/app/api/admin/keyyo/webhook/route.ts
//
// Settings of the Keyyo "Notification d'appels" webhook, for /admin/keyyo. ADMIN ONLY.
//
//   GET                              -> on/off, the URL (with Keyyo's _KEYWORDS_) to configure on
//                                       each line in the Keyyo Manager, the two Ringover
//                                       webhook URLs (same token), the last notifications
//                                       received
//   POST { action: "regenerate" }    -> new secret token (the old URL stops working)
//   POST { action: "enable" | "disable" }
//   POST { action: "ringoverNumbers", entries: [{ ringover, keyyo }] }
//                                    -> Ringover numbers the Keyyo standard forwards to, EACH with
//                                       the standard line it serves (so its agency CPA / ALM)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { getSiteUrl } from "@/lib/site-url";
import { KEYYO_URL_PARAMS } from "@/lib/keyyoWebhook";
import {
  loadKeyyoEvents, loadKeyyoWebhookSettings, loadRingoverForwardTargetsText, regenerateKeyyoToken, saveRingoverForwardTargetsText, setKeyyoWebhookEnabled,
} from "@/lib/keyyoStore";
import { forwardTargetEntries, parseForwardTargets, validateForwardPairs } from "@/lib/ringoverWebhook";
import { loadStandardLines, type StandardLine } from "@/lib/keyyoStandard";

type ForwardRow = {
  ringover: string; keyyo: string | null; label: string | null; agency: StandardLine["agency"]; space: StandardLine["space"];
  /** Why the entry does not count (no line, or not a standard line); null when it is fine. */
  problem: string | null;
};

/** The stored setting as rows, each with its standard line, agency and space. */
function forwardRows(text: string, standard: Map<string, StandardLine>): ForwardRow[] {
  const rows: ForwardRow[] = [];
  for (const [ringover, keyyo] of parseForwardTargets(text)) {
    const line = keyyo ? standard.get(keyyo) : undefined;
    rows.push({
      ringover, keyyo, label: line?.label ?? null, agency: line?.agency ?? null, space: line?.space ?? null,
      problem: !keyyo ? "ligne du standard Keyyo à choisir" : !line ? `${keyyo} n'est pas une ligne du standard Keyyo` : null,
    });
  }
  return rows;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originOf(req: NextRequest): string {
  // The address Keyyo / Ringover must call: this deployment's public origin.
  return req.headers.get("x-forwarded-host") ? `https://${req.headers.get("x-forwarded-host")}` : getSiteUrl();
}

function ringoverUrls(req: NextRequest, token: string | null) {
  if (!token) return null;
  const q = `?token=${encodeURIComponent(token)}`;
  return { answered: `${originOf(req)}/api/ringover/answered${q}`, ended: `${originOf(req)}/api/ringover/ended${q}` };
}

function webhookUrl(req: NextRequest, token: string | null): string | null {
  if (!token) return null;
  const origin = originOf(req);
  // Keyyo replaces the _KEYWORDS_ on each notification (see src/lib/keyyoWebhook.ts).
  return `${origin}/api/keyyo/webhook?token=${encodeURIComponent(token)}&${KEYYO_URL_PARAMS}`;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const [settings, events, ringoverKeyyoNumbers, standard] = await Promise.all([
      loadKeyyoWebhookSettings(), loadKeyyoEvents(100), loadRingoverForwardTargetsText(), loadStandardLines(),
    ]);
    const envText = (process.env.RINGOVER_KEYYO_NUMBERS ?? "").trim();
    return NextResponse.json({
      enabled: settings.enabled,
      url: webhookUrl(req, settings.token),
      ringover: ringoverUrls(req, settings.token),
      ringoverSigned: !!(process.env.RINGOVER_WEBHOOK_SECRET ?? "").trim(),
      ringoverForwards: forwardRows(ringoverKeyyoNumbers, standard),
      ringoverForwardsEnv: forwardRows(envText, standard),
      standardLines: [...standard.values()],
      tokenFromEnv: !!(process.env.KEYYO_WEBHOOK_TOKEN ?? "").trim(),
      events,
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/keyyo/webhook");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const { action, value, entries } = await readJson<{ action?: unknown; value?: unknown; entries?: unknown }>(req);
    if (action === "ringoverNumbers") {
      // Rows { ringover, keyyo } (the page), or the « ringover=keyyo » text (one per line).
      const pairs: Array<{ ringover: string; keyyo: string }> = Array.isArray(entries)
        ? entries.map((e) => ({ ringover: String((e as { ringover?: unknown })?.ringover ?? ""), keyyo: String((e as { keyyo?: unknown })?.keyyo ?? "") }))
        : forwardTargetEntries(typeof value === "string" ? value : "").map((x) => {
            const [ringover, keyyo] = x.split("=");
            return { ringover: ringover ?? "", keyyo: keyyo ?? "" };
          });
      const standard = await loadStandardLines();
      const checked = validateForwardPairs(pairs, new Set(standard.keys()));
      if (checked.errors.length) throw badRequest(checked.errors.join(" ; "));
      // Stored normalised, one « ringover=keyyo » per line.
      await saveRingoverForwardTargetsText(checked.pairs.map(([r, k]) => `${r}=${k}`).join("\n"), admin.userId);
      return NextResponse.json({ ok: true, ringoverForwards: forwardRows(await loadRingoverForwardTargetsText(), standard) });
    }
    if (action === "regenerate") {
      if ((process.env.KEYYO_WEBHOOK_TOKEN ?? "").trim()) throw badRequest("Le jeton est fixé par la variable KEYYO_WEBHOOK_TOKEN de Vercel.");
      await regenerateKeyyoToken(admin.userId);
    } else if (action === "enable" || action === "disable") {
      const settings = await loadKeyyoWebhookSettings();
      if (action === "enable" && !settings.token) await regenerateKeyyoToken(admin.userId);
      await setKeyyoWebhookEnabled(action === "enable", admin.userId);
    } else {
      throw badRequest("action : regenerate, enable, disable ou ringoverNumbers");
    }
    const settings = await loadKeyyoWebhookSettings();
    return NextResponse.json({ enabled: settings.enabled, url: webhookUrl(req, settings.token), ringover: ringoverUrls(req, settings.token) });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/keyyo/webhook");
  }
}
