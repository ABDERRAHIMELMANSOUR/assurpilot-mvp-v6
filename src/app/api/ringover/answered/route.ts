// src/app/api/ringover/answered/route.ts — PUBLIC Ringover webhook "Appels décrochés".
// Logic, security and payload: src/lib/ringoverEndpoint.ts and src/lib/ringoverWebhook.ts.
import type { NextRequest } from "next/server";
import { handleRingoverWebhook } from "@/lib/ringoverEndpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return handleRingoverWebhook(req, "answered");
}

// Ringover sends POST; GET (query string) is accepted for a test by hand.
export async function GET(req: NextRequest) {
  return handleRingoverWebhook(req, "answered");
}
