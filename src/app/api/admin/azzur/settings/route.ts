// src/app/api/admin/azzur/settings/route.ts
//
// The two runtime switches on /admin/azzur. ADMIN ONLY. A change applies at once, without a
// redeploy, because it is stored in the database and read on every send.
//
//   PUT { autoPush: boolean }   "Envois automatiques": a call being saved sends it to AZZUR
//   PUT { enabled: boolean }    global switch (replaces AZZUR_WEBHOOK_ENABLED): off = nothing
//                               is sent at all, not even from the review
//
// Turning "Envois automatiques" on only affects calls that are SAVED one by one (manual
// entry); Excel imports always go through the review. And whatever the switches say, a call
// whose category has no link configured is never sent.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ApiError, badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { isMissingTable, loadEffectiveConfig, MIGRATION_HINT, saveAzzurSetting, type SwitchName } from "@/lib/azzurRoutesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  try {
    const user = await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ autoPush?: unknown; enabled?: unknown }>(req);

    const changes: Array<[SwitchName, boolean]> = [];
    for (const name of ["autoPush", "enabled"] as const) {
      if (body[name] === undefined) continue;
      if (typeof body[name] !== "boolean") throw badRequest(`${name} doit être true ou false`);
      changes.push([name, body[name] as boolean]);
    }
    if (changes.length === 0) throw badRequest("Aucun réglage à modifier (autoPush ou enabled)");

    try {
      for (const [name, value] of changes) await saveAzzurSetting(name, value, user.userId);
    } catch (error) {
      if (isMissingTable(error)) throw new ApiError(503, MIGRATION_HINT);
      throw error;
    }

    const { config, source } = await loadEffectiveConfig();
    return NextResponse.json({ ok: true, enabled: config.enabled, autoPush: config.autoPush, switchSource: source });
  } catch (error) {
    return handleApiError(error, "PUT /api/admin/azzur/settings");
  }
}
