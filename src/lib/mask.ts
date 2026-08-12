// src/lib/mask.ts
//
// Caller-number masking for non-admin roles.
//
// This is applied on the SERVER, in the API responses, not in the components.
// Hiding digits in JSX would leave the full number sitting in the JSON payload,
// where anyone can read it from the network tab — that is a display convention,
// not a control. Masking at the source means every table, list, modal and the
// Excel export are covered by construction, and no future component can leak
// the number by forgetting to call a formatter.

/** Digits kept at the start of a masked number. */
const KEEP_PREFIX = 3;
/** Digits kept at the end of a masked number. */
const KEEP_SUFFIX = 4;

/**
 * Masks the middle of a phone number: "33687814485" -> "336****4485".
 *
 * The number of asterisks matches the number of hidden digits. Formatting
 * characters are dropped so masked values are consistent regardless of how the
 * number was typed ("+33 6 87..." and "33687..." mask identically).
 */
export function maskPhoneNumber(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";

  // Too short to keep both ends without revealing the whole thing: hide it all.
  if (digits.length <= KEEP_PREFIX + KEEP_SUFFIX) return "*".repeat(digits.length);

  return (
    digits.slice(0, KEEP_PREFIX) +
    "*".repeat(digits.length - KEEP_PREFIX - KEEP_SUFFIX) +
    digits.slice(-KEEP_SUFFIX)
  );
}

/** Only an administrator sees complete caller numbers. */
export function shouldMaskCallerFor(role: string | null | undefined): boolean {
  return role !== "ADMINISTRATEUR";
}

/** Returns the caller number as the given role is allowed to see it. */
export function callerNumberFor(role: string | null | undefined, raw: string): string {
  return shouldMaskCallerFor(role) ? maskPhoneNumber(raw) : raw;
}

/** Applies `callerNumberFor` across a list of call rows. */
export function maskCallsFor<T extends { callerNumber: string }>(
  role: string | null | undefined,
  calls: T[]
): T[] {
  if (!shouldMaskCallerFor(role)) return calls;
  return calls.map((call) => ({ ...call, callerNumber: maskPhoneNumber(call.callerNumber) }));
}
