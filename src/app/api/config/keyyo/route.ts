// src/app/api/config/keyyo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Helper: get or create the single KeyyoConfig row
async function getOrCreateConfig() {
  let config = await prisma.keyyoConfig.findFirst();
  if (!config) {
    config = await prisma.keyyoConfig.create({
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
  return config;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  if (user.role !== "ADMINISTRATEUR") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const config = await getOrCreateConfig();

  // Mask the API key in the response (show only last 4 chars)
  return NextResponse.json({
    ...config,
    apiKeyMasked: config.apiKey
      ? "••••••••••••" + config.apiKey.slice(-4)
      : "",
    apiKey: "", // never send the real key back to the client
  });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  if (user.role !== "ADMINISTRATEUR") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  const { apiKey, webhookUrl, phoneNumber, distributionMode, maxRingSeconds, isActive } = body;

  const config = await getOrCreateConfig();

  const updateData: any = {};
  if (webhookUrl   !== undefined) updateData.webhookUrl      = webhookUrl;
  if (phoneNumber  !== undefined) updateData.phoneNumber     = phoneNumber;
  if (distributionMode !== undefined) updateData.distributionMode = distributionMode;
  if (maxRingSeconds   !== undefined) updateData.maxRingSeconds   = Number(maxRingSeconds);
  if (isActive     !== undefined) updateData.isActive        = isActive;
  // Only update API key if a new non-empty value is provided
  if (apiKey && apiKey.trim() !== "") updateData.apiKey = apiKey.trim();

  const updated = await prisma.keyyoConfig.update({
    where: { id: config.id },
    data: updateData,
  });

  return NextResponse.json({
    ...updated,
    apiKeyMasked: updated.apiKey ? "••••••••••••" + updated.apiKey.slice(-4) : "",
    apiKey: "",
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = session.user as any;
  if (user.role !== "ADMINISTRATEUR") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const config = await getOrCreateConfig();

  // Simulate a Keyyo connection test
  // In production, this would make a real API call to Keyyo
  const hasApiKey    = config.apiKey.length > 0;
  const hasPhone     = config.phoneNumber.length > 0;
  const hasWebhook   = config.webhookUrl.length > 0;

  let success = false;
  let message = "";

  if (!hasApiKey) {
    message = "Clé API manquante. Veuillez configurer votre clé API Keyyo.";
  } else if (!hasPhone) {
    message = "Numéro de téléphone manquant. Veuillez saisir votre numéro Keyyo.";
  } else if (!hasWebhook) {
    message = "URL de webhook manquante. Veuillez configurer l'URL de réception des appels.";
  } else {
    // Simulate a successful test
    success = true;
    message = `Connexion Keyyo simulée avec succès. Numéro ${config.phoneNumber} · Mode de distribution : ${config.distributionMode}`;
  }

  // Save test result
  await prisma.keyyoConfig.update({
    where: { id: config.id },
    data: {
      lastTestedAt: new Date(),
      lastTestSuccess: success,
      lastTestMessage: message,
    },
  });

  return NextResponse.json({ success, message });
}
