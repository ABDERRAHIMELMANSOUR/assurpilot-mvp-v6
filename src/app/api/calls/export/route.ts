// src/app/api/calls/export/route.ts
//
// Excel export of the call log. It reuses the same auth scope and the same
// filter builder as GET /api/calls, so the workbook always contains exactly the
// rows the screen is showing — no second interpretation of the filters.
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireUser } from "@/lib/api";
import { callScopeFor, filterForCoach, filterForUser } from "@/lib/scope";
import { callFilterClauses } from "@/lib/callFilters";
import { retentionClause } from "@/lib/retention";
import { callerNumberFor } from "@/lib/mask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hard ceiling so one click cannot try to stream the entire history. */
const MAX_EXPORT_ROWS = 20_000;

const STATUT_LABEL: Record<string, string> = {
  REPONDU: "Répondu",
  MANQUE: "Manqué",
  EN_COURS: "En cours",
};

/** "JJ/MM/AAAA HH:mm", written as text so Excel cannot re-interpret the order. */
function formatDateTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}`
  );
}

/** mm:ss, matching how durations read in the UI. */
function formatDuration(seconds: number): string {
  if (!seconds) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;

    // Exactly the clause stack GET /api/calls builds, in the same order, from
    // the same helpers — the workbook cannot disagree with the screen because
    // there is no second interpretation of the filters.
    const clauses: Prisma.CallWhereInput[] = [
      callScopeFor(user),
      retentionClause(user.role),
    ];

    const targetId = params.get("userId") ?? params.get("conseillerId");
    if (targetId) clauses.push(await filterForUser(user, targetId));

    const coachId = params.get("coachId");
    if (coachId) clauses.push(await filterForCoach(user, coachId));

    // entity, lineType / pole / subTeam, teamId, lineId, statut,
    // period or dateFrom/dateTo (aliased startDate/endDate).
    clauses.push(...callFilterClauses(params));

    const calls = await prisma.call.findMany({
      where: { AND: clauses },
      include: {
        phoneLine: { select: { label: true } },
        team: { select: { nom: true } },
        assignedUser: { select: { nom: true, prenom: true } },
        transferredBy: { select: { nom: true, prenom: true } },
        result: { select: { resultat: true, notes: true } },
      },
      orderBy: { startedAt: "desc" },
      take: MAX_EXPORT_ROWS,
    });

    // Result values are stored as codes (DEVIS_REALISE); export the human label.
    const options = await prisma.callResultOption.findMany({
      select: { value: true, label: true },
    });
    const labelByValue = new Map(options.map((o) => [o.value, o.label]));

    const rows = calls.map((call) => ({
      // Same masking rule as the on-screen tables: only an admin exports
      // complete caller numbers.
      Appelant: callerNumberFor(user.role, call.callerNumber) || "",
      Conseiller: call.assignedUser
        ? `${call.assignedUser.prenom} ${call.assignedUser.nom}`
        : "",
      Ligne: call.phoneLine?.label ?? "",
      Équipe: call.team?.nom ?? "",
      "Date & Heure": formatDateTime(call.startedAt),
      Durée: formatDuration(call.durationSeconds),
      Statut: STATUT_LABEL[call.statut] ?? call.statut,
      Résultat: call.result ? labelByValue.get(call.result.resultat) ?? call.result.resultat : "",
      Notes: call.result?.notes ?? "",
      "Transféré par": call.transferredBy
        ? `${call.transferredBy.prenom} ${call.transferredBy.nom}`
        : "",
    }));

    const header = [
      "Appelant", "Conseiller", "Ligne", "Équipe", "Date & Heure",
      "Durée", "Statut", "Résultat", "Notes", "Transféré par",
    ];

    // `header` is passed explicitly so the column order is stable even when the
    // first row happens to have empty values.
    const sheet = XLSX.utils.json_to_sheet(rows, { header });
    sheet["!cols"] = [
      { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 18 },
      { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 40 }, { wch: 22 },
    ];
    // Freeze the header row.
    sheet["!freeze"] = { xSplit: "0", ySplit: "1" };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Appels");

    const buffer: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = params.get("entity") ? `-${params.get("entity")}` : "";

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="appels${suffix}-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(rows.length),
      },
    });
  } catch (error) {
    return handleApiError(error, "GET /api/calls/export");
  }
}
