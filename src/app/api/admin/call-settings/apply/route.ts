// src/app/api/admin/call-settings/apply/route.ts
//
// "Marquer appliqué": the administrator confirms they have made the change on the
// telephony system, so the adviser stops showing as outstanding. Handles one
// adviser or many (the bulk button) with the same code.
//
// COMPARE-AND-SET. Each item carries the requested state the admin was LOOKING
// AT. It is applied only if that is still what is stored; otherwise it is
// reported back as `stale` and left alone. Approving is a statement that the PBX
// now matches a specific state — if a coach changed a switch a moment ago, the
// admin has not done that work, and recording it as done would mean the PBX and
// the app disagree with nothing flagging it.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { explainDbError } from "@/lib/callSettings";
import { loadAdviserRows } from "@/lib/adminRouting";
import { DEFAULT_ROUTING } from "@/lib/routingState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 500;

type Item = { id: string; isActiveForCalls: boolean; isBoosted: boolean };

function parseItems(body: unknown): Item[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) throw badRequest("Aucun conseiller à appliquer");
  if (items.length > MAX_ITEMS) throw badRequest(`Pas plus de ${MAX_ITEMS} conseillers à la fois`);

  const byId = new Map<string, Item>();
  for (const raw of items) {
    const it = raw as Partial<Item> | null;
    if (
      !it ||
      typeof it.id !== "string" ||
      typeof it.isActiveForCalls !== "boolean" ||
      typeof it.isBoosted !== "boolean"
    ) {
      throw badRequest("Chaque élément doit contenir id, isActiveForCalls et isBoosted (booléens)");
    }
    byId.set(it.id, { id: it.id, isActiveForCalls: it.isActiveForCalls, isBoosted: it.isBoosted });
  }
  return [...byId.values()];
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const items = parseItems(await readJson(req));
    const ids = items.map((i) => i.id);

    const [users, rows] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids }, role: "CONSEILLER" },
        select: { id: true, isActive: true },
      }),
      prisma.advisorCallSettings.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, isActiveForCalls: true, isBoosted: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const rowById = new Map(rows.map((r) => [r.userId, r]));

    const applied: string[] = [];
    const stale: string[] = [];
    const skipped: string[] = []; // unknown, not a conseiller, or account deactivated
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const now = new Date();

    for (const item of items) {
      const user = userById.get(item.id);
      if (!user || !user.isActive) { skipped.push(item.id); continue; }

      const row = rowById.get(item.id);
      const current = row ?? DEFAULT_ROUTING;
      if (current.isActiveForCalls !== item.isActiveForCalls || current.isBoosted !== item.isBoosted) {
        stale.push(item.id);
        continue;
      }

      applied.push(item.id);
      // No row means requested = applied = defaults: there is nothing to record.
      if (!row) continue;

      writes.push(
        prisma.advisorCallApplied.upsert({
          where: { userId: item.id },
          create: {
            userId: item.id,
            isActiveForCalls: row.isActiveForCalls,
            isBoosted: row.isBoosted,
            appliedAt: now,
            appliedById: admin.userId,
          },
          update: {
            isActiveForCalls: row.isActiveForCalls,
            isBoosted: row.isBoosted,
            appliedAt: now,
            appliedById: admin.userId,
          },
          select: { userId: true },
        })
      );
    }

    if (writes.length) await prisma.$transaction(writes);

    const fresh = await loadAdviserRows(applied.concat(stale));
    return NextResponse.json({ applied, stale, skipped, advisers: fresh });
  } catch (error) {
    return handleApiError(explainDbError(error), "POST /api/admin/call-settings/apply");
  }
}
