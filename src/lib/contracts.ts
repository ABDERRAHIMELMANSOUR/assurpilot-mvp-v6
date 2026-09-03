// src/lib/contracts.ts
//
// Which call results count as a signed contract.
//
// `CallResult.resultat` holds the `value` of a `CallResultOption` row, so this
// is a data question, not a schema one: the option is inserted alongside the
// existing ones (see prisma/seed.ts and the idempotent SQL migration) and no
// column changes. Keeping the set here means the leaderboard, the dashboard
// cards and the export all agree on what "un contrat" means.
//
// It is a set rather than a single string because a firm may record a signature
// under more than one label; add to the list instead of editing call rows.

/** Result values that count as a signed contract. */
export const CONTRACT_RESULT_VALUES = ["CONTRAT_SIGNE"] as const;

const CONTRACT_SET = new Set<string>(CONTRACT_RESULT_VALUES);

/** The canonical option, used by the seed and the migration. */
export const CONTRACT_RESULT_OPTION = {
  label: "Contrat signé",
  value: "CONTRAT_SIGNE",
  color: "green",
  isActive: true,
  // First in the dropdown: it is the outcome the business cares about most.
  order: 0,
};

/** True when a result marks the call as having produced a signed contract. */
export function isContractResult(resultat: string | null | undefined): boolean {
  return resultat ? CONTRACT_SET.has(resultat) : false;
}
