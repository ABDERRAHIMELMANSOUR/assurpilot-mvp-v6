// src/lib/rates.ts
//
// THE « Taux global » (taux de conversion) of AssurPilot, the same for every view (admin, coachs,
// conseillers) and every table:
//
//     Taux global = (Nombre de contrats signés ÷ Nombre total d'appels) × 100
//
// - contrats signés: calls whose result is a contract (isContractResult, every "contrat" wording);
// - total d'appels: every call of the period, answered or missed.
// Kept to one decimal: with a few contracts for thousands of calls, a whole number would show 0 %.

export const TAUX_GLOBAL_FORMULE = "Contrats signés ÷ total des appels × 100";

/** (contrats ÷ appels) × 100, one decimal; 0 when there is no call. */
export function tauxGlobal(contrats: number, totalAppels: number): number {
  if (!totalAppels || totalAppels <= 0 || !contrats || contrats <= 0) return 0;
  return Math.round((contrats / totalAppels) * 1000) / 10;
}

/** « 0,8 % » — French decimal comma, non-breaking space before the sign. */
export function formatTaux(taux: number | null | undefined): string {
  const value = typeof taux === "number" && Number.isFinite(taux) ? taux : 0;
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %`;
}
