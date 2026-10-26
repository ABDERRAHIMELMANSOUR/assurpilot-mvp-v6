// src/lib/contracts.ts
//
// Which call results count as a signed contract, and which as a quote (devis).
//
// `CallResult.resultat` holds the `value` of a `CallResultOption` row, and
// administrators create those options freely in /admin/resultats: production
// has "Contrats", "Devis"… next to the seeded CONTRAT_SIGNE / DEVIS_REALISE.
// Matching one hard-coded value showed 0 contracts while advisers were ticking
// "Contrats" all day. So a result is classified by its WORDING — the option's
// value and, when known, its label — not by one exact code:
//
//   contrat  the wording mentions "contrat"   (Contrats, Contrat signé, CONTRAT_SIGNE…)
//   devis    the wording mentions "devis"     (Devis, Devis réalisé, Devis envoyé, DEVIS_REALISE…)
//
// Accents and case are ignored. A negative wording ("Pas de devis", "Contrat
// annulé", "Refus contrat") counts as neither. "contrat" wins over "devis", so
// one call is never counted twice. Client-safe: no database access here; the
// callers pass the value → label map they loaded.

export type ResultKind = "contrat" | "devis";

/** value → label of the result options; a Map or a plain object. */
export type ResultLabels = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

/** The canonical option, used by the seed and the migration. */
export const CONTRACT_RESULT_OPTION = {
  label: "Contrat signé",
  value: "CONTRAT_SIGNE",
  color: "green",
  isActive: true,
  // First in the dropdown: it is the outcome the business cares about most.
  order: 0,
};

/** Kept for compatibility: the seeded contract value. Any "contrat" wording counts. */
export const CONTRACT_RESULT_VALUES = [CONTRACT_RESULT_OPTION.value] as const;

// Words that turn a wording into its opposite. Compared on whole words, by prefix
// for the verbs ("annulé", "annulation", "refusé", "refus").
const NEGATIVE_WORDS = new Set(["non", "pas", "sans", "aucun", "aucune", "ni"]);
const NEGATIVE_PREFIXES = ["annul", "refus", "resili"];

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function labelOf(value: string, labels?: ResultLabels): string {
  if (!labels) return "";
  const label = labels instanceof Map ? labels.get(value) : (labels as Record<string, string>)[value];
  return typeof label === "string" ? label : "";
}

/** Classifies one result from its stored value and, when given, its option label. */
export function resultKind(
  resultat: string | null | undefined,
  labels?: ResultLabels
): ResultKind | null {
  if (!resultat) return null;
  const all = words(`${resultat} ${labelOf(resultat, labels)}`);
  if (all.some((w) => NEGATIVE_WORDS.has(w) || NEGATIVE_PREFIXES.some((p) => w.startsWith(p)))) return null;
  if (all.some((w) => w.startsWith("contrat"))) return "contrat";
  if (all.some((w) => w === "devis")) return "devis";
  return null;
}

/** True when a result marks the call as having produced a signed contract. */
export function isContractResult(resultat: string | null | undefined, labels?: ResultLabels): boolean {
  return resultKind(resultat, labels) === "contrat";
}

/** True when a result marks the call as a quote (devis réalisé, envoyé, "Devis"…). */
export function isDevisResult(resultat: string | null | undefined, labels?: ResultLabels): boolean {
  return resultKind(resultat, labels) === "devis";
}
