// src/lib/phone.ts
//
// Phone-number normalisation and the business-line -> team routing table.
// Shared by the import route and the seed so both agree on what a number means.

/**
 * Normalise a French phone number to its 10-digit national form (0XXXXXXXXX).
 *
 * Handles every shape these files arrive in:
 *   "+33 1 82 28 73 64" / "0033182287364" / "33182287364" / "0182287364"
 * and the case a spreadsheet mangles by storing the column as a number, which
 * silently drops the leading zero: 182287364 -> 0182287364.
 */
export function normalizePhone(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("0033") && digits.length === 13) return "0" + digits.slice(4);
  if (digits.startsWith("33") && digits.length === 11) return "0" + digits.slice(2);
  if (digits.length === 9 && digits[0] !== "0") return "0" + digits;
  return digits;
}

/** A business line and the team that answers it. */
export type LineRoute = {
  /** National form, the key used for matching. */
  numero: string;
  /** Human label for the line itself. */
  label: string;
  /** Team that owns the line. */
  team: string;
};

/**
 * The four production lines. `numero` is stored normalised, so an inbound
 * "+33182287364", "33182287364" or "0182287364" all resolve to the same route.
 */
export const LINE_ROUTES: LineRoute[] = [
  { numero: "0182287364", label: "Ligne santé CPA", team: "Équipe sante CPA" },
  { numero: "0988288997", label: "Ligne auto CPA", team: "Équipe auto CPA" },
  { numero: "0180873462", label: "Ligne santé ALM", team: "Équipe sante ALM" },
  { numero: "0988288362", label: "Ligne auto ALM", team: "Équipe auto ALM" },
];

/** Distinct team names, in the order they should be created. */
export const TEAM_NAMES = LINE_ROUTES.map((r) => r.team);

/** Look up the route for any format of an inbound number. */
export function routeForNumber(raw: string | number | null | undefined): LineRoute | null {
  const normalized = normalizePhone(raw);
  if (!normalized) return null;
  return LINE_ROUTES.find((route) => route.numero === normalized) ?? null;
}
