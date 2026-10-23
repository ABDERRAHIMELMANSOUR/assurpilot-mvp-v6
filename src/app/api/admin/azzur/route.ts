// src/app/api/admin/azzur/route.ts
//
// Status of the AZZUR push, for debugging: is it on, is it configured, what are
// the settings (never the secret key), and the last results this server instance
// saw. ADMIN ONLY. Sends nothing to AZZUR: a "test" push would create a real
// fiche in the CRM.
import { NextResponse } from "next/server";
import { handleApiError, requireRole } from "@/lib/api";
import { recentAzzurResults } from "@/lib/azzur";
import { azzurRoutesTableProblem, loadAzzurRoutes, loadEffectiveConfig } from "@/lib/azzurRoutesStore";
import { resolveEndpoint, ROUTE_KEYS } from "@/lib/azzurRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const { config, source } = await loadEffectiveConfig();
    const tableProblem = await azzurRoutesTableProblem().catch(() => null);
    const tableAvailable = tableProblem === null;
    const { routes } = await loadAzzurRoutes().catch(() => ({ routes: {} }));
    return NextResponse.json({
      enabled: config.enabled,
      ready: config.ready,
      problem: config.problem,
      // Host and provenance only: the URL's cle_ws is a secret and stays out.
      // AZZUR_MER_URL is only a reference for reading the documentation, never a destination.
      referenceHost: config.url?.host ?? null,
      autoPush: config.autoPush,
      // Where each switch's value comes from: the page ("base") or the environment ("env").
      switchSource: source,
      tableAvailable,
      migrationHint: tableProblem,
      linksConfigured: ROUTE_KEYS.filter((k) => resolveEndpoint(k, routes).url !== null).length,
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
