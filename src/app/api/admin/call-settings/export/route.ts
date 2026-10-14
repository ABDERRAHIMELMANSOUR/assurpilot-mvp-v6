// src/app/api/admin/call-settings/export/route.ts
//
// Excel export of the routing list. The page sends the ids it is DISPLAYING, in
// display order, so the workbook is exactly the filtered view on screen — no
// second implementation of the page's filters to keep in step. Values are read
// fresh from the database, not echoed from the browser.
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { asMigrationPending } from "@/lib/callSettings";
import { loadAdviserRows } from "@/lib/adminRouting";
import { pendingSummary } from "@/lib/routingState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 2_000;

/** "JJ/MM/AAAA HH:mm", as text so Excel cannot re-read the day/month order. */
function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const HEADER = [
  "Conseiller", "Téléphone", "Équipe", "Coach",
  "Appels entrants", "Booster", "Statut standard", "Dernière modification",
];

export async function GET() {
  // The page POSTs; a GET has nothing to say about which rows are wanted.
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ ids?: unknown }>(req);
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== "string")) {
      throw badRequest("Aucun conseiller à exporter");
    }
    if (ids.length > MAX_IDS) throw badRequest(`Pas plus de ${MAX_IDS} conseillers à la fois`);

    const rows = await loadAdviserRows(ids as string[]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Back into the order the admin was looking at.
    const ordered = (ids as string[]).map((id) => byId.get(id)).filter((r) => !!r);

    const data = ordered.map((r) => [
      `${r!.prenom} ${r!.nom}`,
      // Typed as text below, so the leading zero of 0988… survives.
      r!.phoneNumber,
      r!.team ?? "",
      r!.coach ? `${r!.coach.prenom} ${r!.coach.nom}` : "",
      r!.requested.isActiveForCalls ? "Activé" : "Désactivé",
      r!.requested.isBoosted ? "Actif" : "Inactif",
      pendingSummary(r!.pending),
      r!.requestedAt
        ? `${formatDateTime(r!.requestedAt)}${r!.requestedBy ? ` — ${r!.requestedBy.prenom} ${r!.requestedBy.nom}` : ""}`
        : "",
    ]);

    const sheet = XLSX.utils.aoa_to_sheet([HEADER, ...data]);
    sheet["!cols"] = [
      { wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 22 },
      { wch: 16 }, { wch: 10 }, { wch: 52 }, { wch: 36 },
    ];
    // Force every cell to be a string so nothing is re-interpreted on opening —
    // a number-looking phone, or text starting with "=", "+" or "-", must stay
    // exactly what it says rather than become a number or a formula.
    for (const addr of Object.keys(sheet)) {
      if (addr.startsWith("!")) continue;
      const cell = sheet[addr] as XLSX.CellObject;
      cell.t = "s";
      cell.v = String(cell.v ?? "");
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Routage");
    const buffer: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="routage-appels-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(data.length),
      },
    });
  } catch (error) {
    return handleApiError(asMigrationPending(error), "POST /api/admin/call-settings/export");
  }
}
