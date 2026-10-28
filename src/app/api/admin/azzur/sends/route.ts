// src/app/api/admin/azzur/sends/route.ts
//
// The journal of fiches sent to the CRMs (azzur_sends): number, link, adviser, the id_user
// put in the request and AZZUR's answer. ADMIN ONLY.
//
//   GET ?limit=200
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handleApiError, requireRole } from "@/lib/api";
import { loadAzzurSends } from "@/lib/azzurSendsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const limit = Number(req.nextUrl.searchParams.get("limit")) || 200;
    return NextResponse.json(await loadAzzurSends(limit));
  } catch (error) {
    return handleApiError(error, "GET /api/admin/azzur/sends");
  }
}
