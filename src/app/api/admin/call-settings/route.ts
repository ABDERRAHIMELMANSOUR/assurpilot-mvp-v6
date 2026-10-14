// src/app/api/admin/call-settings/route.ts
//
// Every adviser's REQUESTED call routing (what their coach set) next to what has
// been APPLIED on the telephony system, and the gap between the two. ADMIN ONLY.
import { NextResponse } from "next/server";
import { handleApiError, requireRole } from "@/lib/api";
import { asMigrationPending } from "@/lib/callSettings";
import { loadAdviserRows } from "@/lib/adminRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const advisers = await loadAdviserRows();
    // `serverTime` lets the page say how fresh the data is without trusting the
    // browser's clock against server-stamped change times.
    return NextResponse.json({ advisers, serverTime: new Date().toISOString() });
  } catch (error) {
    return handleApiError(asMigrationPending(error), "GET /api/admin/call-settings");
  }
}
