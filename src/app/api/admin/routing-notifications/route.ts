// src/app/api/admin/routing-notifications/route.ts
//
// The coach-action alerts and history for /admin/demandes-routage (and the unread
// badge in the sidebar). ADMIN ONLY.
//
//   GET   ?limit=50            newest entries + unread count + serverTime
//         ?after=<ISO date>    only entries created after that instant
//         ?unread=1            only unread entries
//         ?count=1             unread count only (the sidebar badge)
//   POST  { ids: string[] }    mark those as read
//         { all: true }        mark every unread entry as read
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { loadNotificationFeed, markNotificationsRead } from "@/lib/routingNotificationsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const params = req.nextUrl.searchParams;
    const afterRaw = params.get("after");
    const after = afterRaw ? new Date(afterRaw) : null;
    if (after && Number.isNaN(after.getTime())) throw badRequest("Paramètre after invalide");

    const feed = await loadNotificationFeed({
      limit: Number(params.get("limit")) || 50,
      after,
      unreadOnly: params.get("unread") === "1",
      countOnly: params.get("count") === "1",
    });
    return NextResponse.json({ ...feed, serverTime: new Date().toISOString() });
  } catch (error) {
    return handleApiError(error, "GET /api/admin/routing-notifications");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ ids?: unknown; all?: unknown }>(req);

    let target: string[] | "all";
    if (body.all === true) target = "all";
    else if (Array.isArray(body.ids) && body.ids.length && body.ids.every((id) => typeof id === "string")) {
      target = (body.ids as string[]).slice(0, 500);
    } else throw badRequest("Indiquez ids (liste) ou all: true");

    const marked = await markNotificationsRead(admin.userId, target);
    const { unread } = await loadNotificationFeed({ countOnly: true });
    return NextResponse.json({ marked, unread });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/routing-notifications");
  }
}
