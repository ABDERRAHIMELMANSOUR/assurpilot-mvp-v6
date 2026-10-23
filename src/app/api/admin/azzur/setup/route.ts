// src/app/api/admin/azzur/setup/route.ts
//
// Creates, completes or REPAIRS the azzur_routes table on an administrator's request, from the
// "Créer / réparer la table" button on /admin/azzur — the same statement as
// prisma/sql/009-azzur-routes.sql. A table of another shape is renamed aside, never deleted.
// ADMIN ONLY.
import { NextResponse } from "next/server";
import { ApiError, handleApiError, requireRole } from "@/lib/api";
import { azzurRoutesTableProblem, ensureAzzurRoutesTable } from "@/lib/azzurRoutesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED = ["key", "url", "updatedAt", "updatedById"];

export async function POST() {
  try {
    await requireRole("ADMINISTRATEUR");
    let result: { columns: string[]; schema: string };
    try {
      result = await ensureAzzurRoutesTable();
    } catch (error) {
      // Typically a database role without CREATE rights: say so, with Postgres's own words.
      const detail = error instanceof Error ? error.message.split("\n").filter(Boolean).pop() : String(error);
      throw new ApiError(500, `Création impossible depuis l'application (${detail}). Exécutez prisma/sql/009-azzur-routes.sql dans le SQL editor de Supabase.`);
    }
    const missing = EXPECTED.filter((c) => !result.columns.includes(c));
    if (missing.length) {
      throw new ApiError(500, `La table azzur_routes reste incomplète (colonnes manquantes : ${missing.join(", ")}).`);
    }
    const problem = await azzurRoutesTableProblem();
    if (problem) throw new ApiError(500, `La réparation n'a pas suffi : ${problem}`);
    return NextResponse.json({ ok: true, schema: result.schema, columns: result.columns });
  } catch (error) {
    return handleApiError(error, "POST /api/admin/azzur/setup");
  }
}
