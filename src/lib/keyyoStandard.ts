// src/lib/keyyoStandard.ts
//
// The lines of the Keyyo standard, with their agency (CPA / ALM) and space (Santé / Auto): the four
// production lines (LINE_ROUTES) and the active lines of the "Lignes" page. Used to recognise a
// Ringover call forwarded by the standard and to file it in the right agency.
import { prisma } from "@/lib/prisma";
import { LINE_ROUTES, normalizePhone } from "@/lib/phone";
import { entityOfTeamName, subTeamOfTeamName } from "@/lib/entity";

export type StandardLine = { numero: string; label: string; agency: "CPA" | "ALM" | null; space: "SANTE" | "AUTO" | null };

export async function loadStandardLines(): Promise<Map<string, StandardLine>> {
  const out = new Map<string, StandardLine>();
  for (const r of LINE_ROUTES) {
    out.set(r.numero, { numero: r.numero, label: r.label, agency: entityOfTeamName(r.team) ?? entityOfTeamName(r.label), space: subTeamOfTeamName(r.team) ?? subTeamOfTeamName(r.label) });
  }
  const lines = await prisma.phoneLine.findMany({ where: { isActive: true }, select: { numeroMasque: true, label: true } }).catch(() => []);
  for (const l of lines) {
    const numero = normalizePhone(l.numeroMasque);
    if (!numero) continue;
    const known = out.get(numero);
    out.set(numero, {
      numero,
      label: l.label || known?.label || numero,
      agency: entityOfTeamName(l.label) ?? known?.agency ?? null,
      space: subTeamOfTeamName(l.label) ?? known?.space ?? null,
    });
  }
  return out;
}
