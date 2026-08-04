// src/app/api/config/keyyo/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { KeyyoConfig, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KeyyoPayload = {
  apiKey?: string;
  webhookUrl?: string;
  phoneNumber?: string;
  distributionMode?: string;
  maxRingSeconds?: number | string;
  isActive?: boolean;
};

/** Get or create the single KeyyoConfig row. */
async function getOrCreateConfig(): Promise<KeyyoConfig> {
  const existing = await prisma.keyyoConfig.findFirst();
  if (existing) return existing;
  return prisma.keyyoConfig.create({
    data: {
      apiKey: "",
      webhookUrl: "",
      phoneNumber: "",
      distributionMode: "ROUND_ROBIN",
      maxRingSeconds: 30,
      isActive: false,
    },
  });
}

/** Never return the raw API key to the client — only a masked hint. */
function toPublicConfig(config: KeyyoConfig) {
  return {
    ...config,
    apiKeyMasked: config.apiKey ? "••••••••••••" + config.apiKey.slice(-4) : "",
    apiKey: "",
  };
}

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const config = await getOrCreateConfig();
    return NextResponse.json(toPublicConfig(config));
  } catch (error) {
    return handleApiError(error, "GET /api/config/keyyo");
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const { apiKey, webhookUrl, phoneNumber, distributionMode, maxRingSeconds, isActive } =
      await readJson<KeyyoPayload>(req);

    const config = await getOrCreateConfig();

    const data: Prisma.KeyyoConfigUpdateInput = {};
    if (webhookUrl !== undefined) data.webhookUrl = webhookUrl.trim();
    if (phoneNumber !== undefined) data.phoneNumber = phoneNumber.trim();
    if (distributionMode !== undefined) data.distributionMode = distributionMode;
    if (isActive !== undefined) data.isActive = isActive;
    if (maxRingSeconds !== undefined) {
      const seconds = Number(maxRingSeconds);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw badRequest("Durée de sonnerie invalide");
      }
      data.maxRingSeconds = Math.round(seconds);
    }
    // An empty apiKey means "leave the stored key untouched".
    if (apiKey && apiKey.trim() !== "") data.apiKey = apiKey.trim();

    const updated = await prisma.keyyoConfig.update({ where: { id: config.id }, data });
    return NextResponse.json(toPublicConfig(updated));
  } catch (error) {
    return handleApiError(error, "PUT /api/config/keyyo");
  }
}

/** Connection test. Simulated for now — replace with a real Keyyo API call. */
export async function POST() {
  try {
    await requireRole("ADMINISTRATEUR");
    const config = await getOrCreateConfig();

    let success = false;
    let message: string;

    if (!config.apiKey) {
      message = "Clé API manquante. Veuillez configurer votre clé API Keyyo.";
    } else if (!config.phoneNumber) {
      message = "Numéro de téléphone manquant. Veuillez saisir votre numéro Keyyo.";
    } else if (!config.webhookUrl) {
      message = "URL de webhook manquante. Veuillez configurer l'URL de réception des appels.";
    } else {
      success = true;
      message =
        `Connexion Keyyo simulée avec succès. Numéro ${config.phoneNumber} ` +
        `· Mode de distribution : ${config.distributionMode}`;
    }

    await prisma.keyyoConfig.update({
      where: { id: config.id },
      data: { lastTestedAt: new Date(), lastTestSuccess: success, lastTestMessage: message },
    });

    return NextResponse.json({ success, message });
  } catch (error) {
    return handleApiError(error, "POST /api/config/keyyo");
  }
}
