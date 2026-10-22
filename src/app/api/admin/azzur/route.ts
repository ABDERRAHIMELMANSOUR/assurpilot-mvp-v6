// src/app/api/admin/azzur/route.ts
//
// Status of the AZZUR push, for debugging: is it on, is it configured, what are
// the settings (never the secret key), and the last results this server instance
// saw. ADMIN ONLY. Sends nothing to AZZUR: a "test" push would create a real
// fiche in the CRM.
import { NextResponse } from "next/server";
import { handleApiError, requireRole } from "@/lib/api";
import { readAzzurConfig, recentAzzurResults } from "@/lib/azzur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const config = readAzzurConfig();
    return NextResponse.json({
      enabled: config.enabled,
      ready: config.ready,
      problem: config.problem,
      // Host and provenance only: the URL's cle_ws is a secret and stays out.
      host: config.url?.host ?? null,
      path: config.url?.pathname ?? null,
      idProv: config.url?.searchParams.get("id_prov") ?? null,
      method: config.method,
      retourWs: config.retourWs,
      format: config.format,
      fields: config.fields,
      provenance: config.provenance,
      placeholders: config.placeholders,
      mappedAdvisers: Object.keys(config.userMap).length,
      defaultUserId: config.defaultUserId,
      timeoutMs: config.timeoutMs,
      maxAgeHours: config.maxAgeHours,
      onlyAnswered: config.onlyAnswered,
      // Per server instance: on serverless, the platform logs are the full record.
      recent: recentAzzurResults(),
    });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/azzur");
  }
}
