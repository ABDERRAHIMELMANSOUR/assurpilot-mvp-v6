// src/lib/azzurUserImport.ts
//
// Fills the adviser -> AZZUR id_user table from AZZUR's own user list, pasted as it is copied
// from Administration > Utilisateurs (one row per line: Id, Nom, Prénom, Tél, Mail, Login,
// Agence, Rôle, Etat…). Pure: parsing and matching only, so the rules can be tested alone.
//
// Matching, strongest first, against the Assurpilot advisers of the chosen space:
//   email  same e-mail address
//   nom    same first and last name (accents, case, order and hyphens ignored), or the name
//          read from the AZZUR e-mail ("benjamin.lombardi@…" for a user named "THEO Benjamin")
//   ligne  the AZZUR user's number is the adviser's direct line AND they share a name word
// The phone alone is NOT trusted: lines are handed from one adviser to the next, and AZZUR keeps
// the old holder's number (Soraya Alvar's line is someone else's today). A number match with a
// different name is shown as "à vérifier", never pre-ticked.
// A proposal is pre-selected only when it is unambiguous: one AZZUR user for one adviser, in
// the right space, and no different id already saved. Everything else is shown, not applied.
import { normalizePhone } from "@/lib/phone";
import { entityOfTeamName, type Entity } from "@/lib/entity";

export type AzzurUserRow = {
  azzurId: string;
  nom: string;
  prenom: string;
  phones: string[];
  email: string;
  /** "Actif" / "Désactivé"… as written in AZZUR, when present. */
  etat: string;
  role: string;
};

export type ImportCandidate = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  phoneNumber: string;
  team: string | null;
  /** Id already saved for this adviser, "" if none. */
  currentAzzurId: string;
};

export type MatchReason = "ligne" | "email" | "nom" | "ligne-seule";

export type ImportProposal = {
  azzur: AzzurUserRow;
  status: "match" | "deja" | "ambigu" | "a-verifier" | "autre-espace" | "aucun" | "desactive";
  reason: MatchReason | null;
  adviser: { id: string; name: string; team: string | null; currentAzzurId: string } | null;
  /** Pre-ticked in the review: safe to apply as is. */
  selected: boolean;
  note: string;
};

export type ImportPreview = {
  space: Entity | null;
  rows: number;
  proposals: ImportProposal[];
  /** Advisers of the space that no AZZUR row matched and that have no id yet. */
  unmatchedAdvisers: Array<{ id: string; name: string; team: string | null }>;
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+33\s?|0033\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g;

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Name as a sorted set of words, so "ALAMI Hajar" and "Hajar ALAMI" compare equal. */
function nameKey(...parts: string[]): string {
  return fold(parts.join(" ")).split(" ").filter(Boolean).sort().join(" ");
}

/** One AZZUR user per line; lines without an id are skipped (headers, blank lines). */
export function parseAzzurUsers(text: string): AzzurUserRow[] {
  const out: AzzurUserRow[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // A copied HTML table gives tab-separated cells; fall back to runs of spaces.
    let cells = (line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/)).map((c) => c.trim());
    let idIndex = cells.findIndex((c) => /^\d{1,7}$/.test(c));
    if (idIndex < 0) {
      // Single spaces only ("Editer Dupliquer 147 Alvar Soraya 01 62 53 81 27 …"): the id is the
      // number before the name, the name is what stands between it and the first phone number.
      const m = line.match(/(?:^|\s)(\d{1,7})\s+(\S+)\s+(.*?)\s+(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/);
      if (!m) continue;
      cells = [m[1], m[2], m[3], ...line.slice((m.index ?? 0) + m[0].length).split(/\s+/)];
      idIndex = 0;
    }
    const after = cells.slice(idIndex + 1);
    const email = (line.match(EMAIL)?.[0] ?? "").toLowerCase();
    const phones = [...new Set((line.match(PHONE) ?? []).map((p) => normalizePhone(p)))];
    // Nom and Prénom are the two cells right after the id (before the phone column).
    const names = after.filter((c) => c && !EMAIL.test(c) && !/\d{2}[\s.]?\d{2}[\s.]?\d{2}/.test(c));
    const azzurId = cells[idIndex];
    if (seen.has(azzurId)) continue;
    seen.add(azzurId);
    out.push({
      azzurId,
      nom: names[0] ?? "",
      prenom: names[1] ?? "",
      phones,
      email,
      etat: cells.find((c) => /^(actif|d[ée]sactiv[ée]e?|inactif)$/i.test(c)) ?? "",
      role: cells.find((c) => /conseiller|gestionnaire|administrateur|chef/i.test(c)) ?? "",
    });
  }
  return out;
}

/** ALM or CPA, from the e-mail domains or the Agence column of the pasted list. */
export function guessSpace(rows: AzzurUserRow[], text: string): Entity | null {
  const alm = (text.match(/alm-assurances|\bALM\b/gi) ?? []).length;
  const cpa = (text.match(/groupe-cpa|cpa-assurances|\bCPA\b/gi) ?? []).length;
  if (!rows.length || alm === cpa) return null;
  return alm > cpa ? "ALM" : "CPA";
}

export function previewAzzurImport(text: string, candidates: ImportCandidate[], space: Entity | null): ImportPreview {
  const rows = parseAzzurUsers(text);
  const name = (c: ImportCandidate) => `${c.prenom} ${c.nom}`.trim();
  const inSpace = (c: ImportCandidate) => !space || entityOfTeamName(c.team) === space;

  const byPhone = new Map<string, ImportCandidate[]>();
  const byEmail = new Map<string, ImportCandidate[]>();
  const byName = new Map<string, ImportCandidate[]>();
  const add = (m: Map<string, ImportCandidate[]>, k: string, c: ImportCandidate) => {
    if (!k) return;
    m.set(k, [...(m.get(k) ?? []), c]);
  };
  for (const c of candidates) {
    add(byPhone, normalizePhone(c.phoneNumber), c);
    add(byEmail, c.email.trim().toLowerCase(), c);
    add(byName, nameKey(c.prenom, c.nom), c);
  }

  // First pass: who each AZZUR user points to.
  const words = (c: ImportCandidate) => new Set(nameKey(c.prenom, c.nom).split(" ").filter((w) => w.length > 1));
  const found = rows.map((row) => {
    const rowWords = nameKey(row.prenom, row.nom).split(" ").filter((w) => w.length > 1);
    const fromEmail = row.email ? nameKey(row.email.split("@")[0].replace(/[._-]+/g, " ")) : "";
    const phoneHits = [...new Set(row.phones.flatMap((p) => byPhone.get(p) ?? []))];
    const tries: Array<[MatchReason, ImportCandidate[]]> = [
      ["email", row.email ? byEmail.get(row.email) ?? [] : []],
      ["nom", byName.get(nameKey(row.prenom, row.nom)) ?? []],
      ["nom", fromEmail ? byName.get(fromEmail) ?? [] : []],
      ["ligne", phoneHits.filter((c) => rowWords.some((w) => words(c).has(w)))],
      ["ligne-seule", phoneHits],
    ];
    for (const [reason, list] of tries) {
      let hits = [...new Set(list)];
      if (!hits.length) continue;
      // Several hits: keep those of the chosen space if that settles it.
      if (hits.length > 1 && space) {
        const local = hits.filter(inSpace);
        if (local.length) hits = local;
      }
      return { row, reason, hits };
    }
    return { row, reason: null as MatchReason | null, hits: [] as ImportCandidate[] };
  });

  // An adviser claimed by two AZZUR users is ambiguous for both.
  // A number-only guess does not count as a claim: it must not cast doubt on a name match.
  const claims = new Map<string, number>();
  for (const f of found) {
    if (f.hits.length === 1 && f.reason !== "ligne-seule") claims.set(f.hits[0].id, (claims.get(f.hits[0].id) ?? 0) + 1);
  }

  const proposals: ImportProposal[] = found.map(({ row, reason, hits }) => {
    const inactive = /d[ée]sactiv|inactif/i.test(row.etat);
    if (!hits.length) {
      return { azzur: row, status: inactive ? "desactive" : "aucun", reason: null, adviser: null, selected: false,
        note: inactive ? "Compte désactivé dans AZZUR" : "Aucun conseiller Assurpilot correspondant" };
    }
    if (hits.length > 1) {
      return { azzur: row, status: "ambigu", reason, adviser: null, selected: false,
        note: `Plusieurs conseillers possibles : ${hits.map(name).join(", ")}` };
    }
    const c = hits[0];
    const adviser = { id: c.id, name: name(c), team: c.team, currentAzzurId: c.currentAzzurId };
    if (reason === "ligne-seule") {
      return { azzur: row, status: (claims.get(c.id) ?? 0) > 0 ? "aucun" : "a-verifier", reason, adviser: (claims.get(c.id) ?? 0) > 0 ? null : adviser, selected: false,
        note: (claims.get(c.id) ?? 0) > 0
          ? `Même numéro que ${name(c)}, qui correspond déjà à un autre utilisateur AZZUR`
          : `Même numéro, mais nom différent (${name(c)}) : la ligne a peut-être changé de titulaire` };
    }
    if ((claims.get(c.id) ?? 0) > 1) {
      return { azzur: row, status: "ambigu", reason, adviser, selected: false,
        note: "Plusieurs utilisateurs AZZUR correspondent à ce conseiller : choisissez à la main" };
    }
    if (!inSpace(c)) {
      return { azzur: row, status: "autre-espace", reason, adviser, selected: false,
        note: `${name(c)} n'est pas dans une équipe ${space} : vérifiez avant d'appliquer` };
    }
    if (c.currentAzzurId === row.azzurId) {
      return { azzur: row, status: "deja", reason, adviser, selected: false, note: "Déjà enregistré" };
    }
    return {
      azzur: row, status: "match", reason, adviser,
      // Never overwrite silently: a different id already saved is shown but not ticked.
      selected: !inactive && !c.currentAzzurId,
      note: [
        c.currentAzzurId ? `Remplacerait l'id ${c.currentAzzurId}` : "",
        inactive ? "Compte désactivé dans AZZUR" : "",
      ].filter(Boolean).join(" · "),
    };
  });

  const matched = new Set(
    proposals.filter((p) => p.adviser && ["match", "deja", "autre-espace"].includes(p.status)).map((p) => p.adviser!.id)
  );
  const unmatchedAdvisers = candidates
    .filter((c) => inSpace(c) && !c.currentAzzurId && !matched.has(c.id))
    .map((c) => ({ id: c.id, name: name(c), team: c.team }));

  return { space, rows: rows.length, proposals, unmatchedAdvisers };
}
