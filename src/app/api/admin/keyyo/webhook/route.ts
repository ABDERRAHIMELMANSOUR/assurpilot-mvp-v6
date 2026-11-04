// src/app/api/admin/keyyo/webhook/route.ts
//
// Settings of the Keyyo "Notification d'appels" webhook, for /admin/keyyo. ADMIN ONLY.
//
//   GET                              -> on/off, the URL to configure on each Keyyo line, the
//                                       last notifications received
//   POST { action: "regenerate" }    -> new secret token (the old URL stops working)
//   POST { action: "enable" | "disable" }
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { getSiteUrl } from "@/lib/site-url";
import { loadKeyyoEvents, loadKeyyoWebhookSettings, regenerateKeyyoToken, setKeyyoWebhookEnabled } from "@/lib/keyyoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function webhookUrl(req: NextRequest, token: string | null): string | null {
  if (!token) return null;
  // The address Keyyo must call: this deployment's public origin.
  const origin = req.headers.get("x-forwarded-host") ? `https://${req.headers.get("x-forwarded-host")}` : getSiteUrl();
  return `${origin}/api/keyyo/webhook?token=${encodeURIComponent(token)}`;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const [settings, events] = await Promise.all([loadKeyyoWebhookSettings(), loadKeyyoEvents(100)]);
    return NextResponse.json({
      enabled: settings.enabled,
      url: webhookUrl(req, settings.token),
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
    return NextResponse.json({ enabled: settings.enabled, url: webhookUrl(req, settings.token) });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/keyyo/webhook");
  }
}
