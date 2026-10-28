// src/app/api/admin/azzur/users/import/route.ts
//
// Preview of AZZUR ids matched to advisers, from AZZUR's user list pasted as is. ADMIN ONLY.
// Nothing is saved here: the page shows the proposals, the admin ticks them, and the chosen
// ones are saved with PUT /api/admin/azzur/users { assignments }.
//
//   POST { text, space?: "ALM" | "CPA" }  -> ImportPreview (space guessed from the list if absent)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, readJson, requireRole } from "@/lib/api";
import { parseEntity } from "@/lib/entity";
import { loadAzzurUserMap } from "@/lib/azzurRoutesStore";
import { guessSpace, parseAzzurUsers, previewAzzurImport } from "@/lib/azzurUserImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMINISTRATEUR");
    const body = await readJson<{ text?: unknown; space?: unknown }>(req);
    const text = typeof body.text === "string" ? body.text.slice(0, 500_000) : "";
    if (!text.trim()) throw badRequest("Collez la liste des utilisateurs copiée depuis AZZUR.");

    const [users, ids] = await Promise.all([
      prisma.user.findMany({
        where: { role: { in: ["CONSEILLER", "SUPERVISEUR"] }, isActive: true },
        select: { id: true, nom: true, prenom: true, email: true, phoneNumber: true, team: { select: { nom: true } } },
      }),
      loadAzzurUserMap(),
    ]);
    const space = parseEntity(typeof body.space === "string" ? body.space : null) ?? guessSpace(parseAzzurUsers(text), text);
    const preview = previewAzzurImport(
      text,
      users.map((u) => ({
        id: u.id, nom: u.nom, prenom: u.prenom, email: u.email, phoneNumber: u.phoneNumber ?? "",
        team: u.team?.nom ?? null, currentAzzurId: ids[u.id] ?? "",
      })),
      space
    );
    if (!preview.rows) throw badRequest("Aucun utilisateur reconnu : copiez les lignes du tableau AZZUR (avec la colonne Id).");
    return NextResponse.json(preview);
  } catch (error) {
    return handleApiError(error, "POST /api/admin/azzur/users/import");
  }
}
