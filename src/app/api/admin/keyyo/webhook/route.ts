// src/app/api/admin/keyyo/webhook/route.ts
//
// Settings of the Keyyo "Notification d'appels" webhook, for /admin/keyyo. ADMIN ONLY.
//
//   GET                              -> on/off, the URL (with Keyyo's _KEYWORDS_) to configure on
//                                       each line in the Keyyo Manager, the two Ringover
//                                       webhook URLs (same token), the standard lines with their
//                                       agency, team and advisers, the last notifications received
//   POST { action: "regenerate" }    -> new secret token (the old URL stops working)
//   POST { action: "enable" | "disable" }
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { getSiteUrl } from "@/lib/site-url";
import { KEYYO_URL_PARAMS } from "@/lib/keyyoWebhook";
import { loadKeyyoEvents, loadKeyyoWebhookSettings, loadRingoverUserMap, regenerateKeyyoToken, setKeyyoWebhookEnabled } from "@/lib/keyyoStore";
import { loadStandardOverview } from "@/lib/keyyoStandard";

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
    const [settings, events, ringoverUsers] = await Promise.all([loadKeyyoWebhookSettings(), loadKeyyoEvents(100), loadRingoverUserMap()]);
    const standardOverview = await loadStandardOverview(ringoverUsers);
    return NextResponse.json({
      standardOverview,
      enabled: settings.enabled,
      url: webhookUrl(req, settings.token),
      ringover: ringoverUrls(req, settings.token),
      ringoverSigned: !!(process.env.RINGOVER_WEBHOOK_SECRET ?? "").trim(),
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
    const { action } = await readJson<{ action?: unknown }>(req);
    if (action === "regenerate") {
      if ((process.env.KEYYO_WEBHOOK_TOKEN ?? "").trim()) throw badRequest("Le jeton est fixé par la variable KEYYO_WEBHOOK_TOKEN de Vercel.");
      await regenerateKeyyoToken(admin.userId);
    } else if (action === "enable" || action === "disable") {
      const settings = await loadKeyyoWebhookSettings();
      if (action === "enable" && !settings.token) await regenerateKeyyoToken(admin.userId);
      await setKeyyoWebhookEnabled(action === "enable", admin.userId);
    } else {
      throw badRequest("action : regenerate, enable ou disable");
    }
    const settings = await loadKeyyoWebhookSettings();
    return NextResponse.json({ enabled: settings.enabled, url: webhookUrl(req, settings.token), ringover: ringoverUrls(req, settings.token) });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/keyyo/webhook");
  }
}
