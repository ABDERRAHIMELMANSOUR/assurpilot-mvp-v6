// src/lib/keyyoStandard.ts
//
// The lines of the Keyyo standard (the numbers published on Google Ads) and what they stand for:
//   Ligne santé ALM -> standard Santé ALM, agence ALM, « Équipe sante ALM »
//   Ligne auto ALM  -> standard Auto ALM,  agence ALM, « Équipe auto ALM »
//   Ligne santé CPA -> standard Santé CPA, agence CPA, « Équipe sante CPA »
//   Ligne auto CPA  -> standard Auto CPA,  agence CPA, « Équipe auto CPA »
// Read from the active lines of the "Lignes" page and the team each is attached to (phone_lines.
// teamId), the four production lines (LINE_ROUTES) filling any gap. The TEAM decides the agency
// and the space; the label only when the line has no team. Its advisers are that team's members.
import { prisma } from "@/lib/prisma";
import { LINE_ROUTES, normalizePhone } from "@/lib/phone";
import { entityOfTeamName, subTeamOfTeamName } from "@/lib/entity";

export type StandardLine = {
  numero: string;
  label: string;
  agency: "CPA" | "ALM" | null;
  space: "SANTE" | "AUTO" | null;
  /** The AssurPilot team of the line (its advisers answer its calls); null if none. */
  teamId: string | null;
  teamName: string | null;
};

export async function loadStandardLines(): Promise<Map<string, StandardLine>> {
  const [lines, teams] = await Promise.all([
    prisma.phoneLine.findMany({ where: { isActive: true }, select: { numeroMasque: true, label: true, teamId: true, team: { select: { nom: true } } } }).catch(() => []),
    prisma.team.findMany({ select: { id: true, nom: true } }).catch(() => []),
  ]);
  const teamByName = new Map(teams.map((t) => [t.nom, t] as const));
  const out = new Map<string, StandardLine>();
  for (const r of LINE_ROUTES) {
    const team = teamByName.get(r.team) ?? null;
    out.set(r.numero, {
      numero: r.numero, label: r.label, teamId: team?.id ?? null, teamName: team?.nom ?? r.team,
      agency: entityOfTeamName(r.team) ?? entityOfTeamName(r.label), space: subTeamOfTeamName(r.team) ?? subTeamOfTeamName(r.label),
    });
  }
  for (const l of lines) {
    const numero = normalizePhone(l.numeroMasque);
    if (!numero) continue;
    const known = out.get(numero);
    const teamName = l.team?.nom ?? known?.teamName ?? null;
    out.set(numero, {
      numero,
      label: l.label || known?.label || numero,
      teamId: l.teamId ?? known?.teamId ?? null,
      teamName,
      agency: entityOfTeamName(teamName) ?? entityOfTeamName(l.label) ?? known?.agency ?? null,
      space: subTeamOfTeamName(teamName) ?? subTeamOfTeamName(l.label) ?? known?.space ?? null,
    });
  }
  return out;
}

/** « Standard Santé ALM » for a line, from its space and agency. */
export function standardName(l: Pick<StandardLine, "space" | "agency" | "label">): string {
  if (!l.space || !l.agency) return l.label;
  return `Standard ${l.space === "SANTE" ? "Santé" : "Auto"} ${l.agency}`;
}

// ── Overview for /admin/keyyo ───────────────────────────────────────────────────────
export type StandardOverview = StandardLine & {
  name: string;
  advisers: Array<{ id: string; name: string; email: string; role: string; ringoverLinked: boolean }>;
  /** What would stop a call of this line from being filed on the right adviser. */
  problems: string[];
};

const plain = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function loadStandardOverview(ringoverUsers: Map<string, string>): Promise<StandardOverview[]> {
  const standard = await loadStandardLines();
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ["CONSEILLER", "SUPERVISEUR"] } },
    select: { id: true, prenom: true, nom: true, email: true, role: true, teamId: true, phoneNumber: true },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
  });
  const linked = new Set(ringoverUsers.values());
  // Same name or same phone number on two active accounts: told apart only by e-mail.
  const byName = new Map<string, typeof users>();
  const byPhone = new Map<string, typeof users>();
  for (const u of users) {
    const k = plain(`${u.prenom} ${u.nom}`);
    byName.set(k, [...(byName.get(k) ?? []), u]);
    const p = normalizePhone(u.phoneNumber);
    if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), u]);
  }
  const out: StandardOverview[] = [];
  for (const line of standard.values()) {
    const members = users.filter((u) => line.teamId && u.teamId === line.teamId);
    const problems: string[] = [];
    if (!line.teamId) problems.push("ligne rattachée à aucune équipe (page Lignes) : ses appels ne savent pas à quelle équipe aller");
    if (!line.agency) problems.push("agence (CPA / ALM) introuvable dans le nom de l'équipe ou de la ligne");
    if (line.teamId && members.length === 0) problems.push("aucun conseiller actif dans l'équipe");
    const flagged = new Set<string>();
    for (const u of members) {
      const sameName = (byName.get(plain(`${u.prenom} ${u.nom}`)) ?? []).filter((x) => x.id !== u.id);
      const samePhone = (byPhone.get(normalizePhone(u.phoneNumber)) ?? []).filter((x) => x.id !== u.id);
      const key = [u.id, ...sameName.map((x) => x.id)].sort().join();
      if (sameName.length && !flagged.has(key)) {
        flagged.add(key);
        problems.push(`${u.prenom} ${u.nom} a ${sameName.length + 1} comptes actifs (${[u, ...sameName].map((x) => x.email).join(", ")}${samePhone.length ? ", même numéro de téléphone" : ""}) : seul l'e-mail Ringover permet de choisir — vérifiez lequel est le bon et désactivez l'autre`);
      } else if (samePhone.length && !sameName.length) {
        problems.push(`${u.prenom} ${u.nom} partage son numéro ${normalizePhone(u.phoneNumber)} avec ${samePhone.map((x) => `${x.prenom} ${x.nom}`).join(", ")}`);
      }
    }
    out.push({
      ...line,
      name: standardName(line),
      advisers: members.map((u) => ({ id: u.id, name: `${u.prenom} ${u.nom}`.trim(), email: u.email, role: u.role, ringoverLinked: linked.has(u.id) })),
      problems,
    });
  }
  // ALM then CPA, Santé then Auto: the order of the agencies' standards.
  const rank = (l: StandardOverview) => `${l.agency ?? "Z"}-${l.space === "SANTE" ? 0 : l.space === "AUTO" ? 1 : 2}`;
  return out.sort((a, b) => rank(a).localeCompare(rank(b)));
}
