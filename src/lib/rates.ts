// src/lib/rates.ts
//
// THE « Taux global » (taux de conversion) of AssurPilot, the same for every view (admin, coachs,
// conseillers) and every table:
//
//     Taux global = (Nombre de contrats signés ÷ Nombre total d'appels prospects) × 100
//
// - contrats signés: calls whose result is a contract (isContractResult, every "contrat" wording);
// - appels prospects: the PROSPECTS of the period — the distinct numbers that called, exactly the
//   « Total prospects » card (countUniqueCallers in src/lib/dedupe.ts): a number that rang three
//   times is one prospect, its repeat calls are the « Doublons »; a withheld number counts as one.
// Kept to one decimal: with a few contracts for thousands of prospects, a whole number would show 0 %.

export const TAUX_GLOBAL_FORMULE = "Contrats signés ÷ total des prospects × 100";

/** (contrats ÷ prospects) × 100, one decimal; 0 when there is no prospect. */
export function tauxGlobal(contrats: number, totalProspects: number): number {
  if (!totalProspects || totalProspects <= 0 || !contrats || contrats <= 0) return 0;
  return Math.round((contrats / totalProspects) * 1000) / 10;
}

/** « 0,8 % » — French decimal comma, non-breaking space before the sign. */
export function formatTaux(taux: number | null | undefined): string {
  const value = typeof taux === "number" && Number.isFinite(taux) ? taux : 0;
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %`;
}
