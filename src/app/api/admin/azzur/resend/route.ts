// src/app/api/admin/azzur/resend/route.ts
//
// Sends TODAY'S calls (Paris calendar day) to AZZUR on demand, to verify the
// integration end to end. ADMIN ONLY.
//
//   POST { "mode": "preview" }                 nothing is sent: counts + the exact
//                                              payload of the first calls
//   POST { "mode": "send", "limit": 1 }        sends the oldest `limit` calls of
//                                              today and returns AZZUR's answers
//
// Unlike the automatic push this one WAITS for AZZUR and reports each answer,
// which is the point. Only today's calls are ever selected, so history is not
// touched; `limit` (default 5, max 200) keeps a first test small.
//
// There is no record of what was already pushed when each call was created, so
// a call that was pushed then and is sent again here reaches AZZUR twice. AZZUR
// has its own duplicate handling ("Doublon Fiche"), but start with limit 1.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import {
  buildAzzurPayload,
  mapPool,
  parisDayBounds,
  pushCallToAzzur,
  readAzzurConfig,
  type AzzurCallEvent,
} from "@/lib/azzur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HARD_LIMIT = 200;

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ mode?: string; limit?: number }>(req);
    const mode = body.mode === "send" ? "send" : body.mode === "preview" || !body.mode ? "preview" : null;
    if (!mode) throw badRequest('mode doit être "preview" ou "send"');
    const limit = Math.min(Math.max(Math.floor(Number(body.limit ?? 5)) || 5, 1), HARD_LIMIT);

    const config = readAzzurConfig();
    if (!config.ready) {
      throw badRequest(
        config.problem ?? "Intégration AZZUR désactivée : définissez AZZUR_WEBHOOK_ENABLED=true et AZZUR_MER_URL."
      );
    }

    const { start, end } = parisDayBounds();
    const where = { startedAt: { gte: start, lt: end } };
    const [total, calls] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.findMany({
        where,
        orderBy: { startedAt: "asc" },
        take: limit,
        select: {
          id: true,
          callerNumber: true,
          startedAt: true,
          isMissed: true,
          phoneLine: { select: { label: true } },
          assignedUser: { select: { email: true, nom: true, prenom: true } },
        },
      }),
    ]);

    const events: AzzurCallEvent[] = calls.map((c) => ({
      reference: `call:${c.id}`,
      callerNumber: c.callerNumber,
      startedAt: c.startedAt,
      isMissed: c.isMissed,
      lineLabel: c.phoneLine?.label ?? null,
      conseiller: c.assignedUser,
    }));

    const base = {
      day: { from: start.toISOString(), to: end.toISOString() },
      callsToday: total,
      selected: events.length,
      limit,
      target: { host: config.url?.host, idProv: config.url?.searchParams.get("id_prov"), method: config.method, format: config.format },
    };

    if (mode === "preview") {
      return NextResponse.json({
        mode,
        ...base,
        // Exactly what would go out for the first calls.
        payloads: events.slice(0, 3).map((e) => buildAzzurPayload(e, config)),
      });
    }

    const results = await mapPool(events, 3, (event) => pushCallToAzzur(event, { config }));
    return NextResponse.json({
      mode,
      ...base,
      sent: results.filter((r) => r.outcome === "sent").length,
      failed: results.filter((r) => r.outcome === "failed").length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
      // `detail` carries the start of AZZUR's own answer.
      results,
    });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/azzur/resend");
  }
}
