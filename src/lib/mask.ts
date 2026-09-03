// src/lib/mask.ts
//
// Caller-number masking, applied on the SERVER in the API responses rather than
// in the components. Hiding digits in JSX would leave the full number in the
// JSON payload for anyone to read from the network tab — a display convention,
// not a control. Masking at the source covers every table, list, modal and the
// Excel export by construction.
//
// Visibility by role:
//   ADMINISTRATEUR  33602020009   full number
//   SUPERVISEUR     336****0009   middle digits hidden
//   CONSEILLER      ********009   last three digits only

/** Digits a coach keeps at the start. */
const COACH_PREFIX = 3;
/** Digits a coach keeps at the end. */
const COACH_SUFFIX = 4;
/** Digits a conseiller keeps at the end; nothing else is shown. */
const AGENT_SUFFIX = 3;

function digitsOf(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/\D/g, "");
}

/**
 * Coach view: "33687814485" -> "336****4485".
 *
 * The number of asterisks matches the number of hidden digits. Formatting
 * characters are dropped first, so "+33 6 87 81 44 85" masks identically.
 */
export function maskPhoneNumber(raw: string | null | undefined): string {
  const digits = digitsOf(raw);
  if (!digits) return "";

  // Too short to keep both ends without revealing the whole thing: hide it all.
  if (digits.length <= COACH_PREFIX + COACH_SUFFIX) return "*".repeat(digits.length);

  return (
    digits.slice(0, COACH_PREFIX) +
    "*".repeat(digits.length - COACH_PREFIX - COACH_SUFFIX) +
    digits.slice(-COACH_SUFFIX)
  );
}

/** Conseiller view: "33602020009" -> "********009". Only the last 3 digits. */
export function maskPhoneNumberStrict(raw: string | null | undefined): string {
  const digits = digitsOf(raw);
  if (!digits) return "";
  if (digits.length <= AGENT_SUFFIX) return "*".repeat(digits.length);
  return "*".repeat(digits.length - AGENT_SUFFIX) + digits.slice(-AGENT_SUFFIX);
}

/** True when the role sees anything less than the full number. */
export function shouldMaskCallerFor(role: string | null | undefined): boolean {
  return role !== "ADMINISTRATEUR";
}

/** Returns the caller number as the given role is allowed to see it. */
export function callerNumberFor(role: string | null | undefined, raw: string): string {
  if (role === "ADMINISTRATEUR") return raw;
  if (role === "CONSEILLER") return maskPhoneNumberStrict(raw);
  return maskPhoneNumber(raw);
}

/** Applies `callerNumberFor` across a list of call rows. */
export function maskCallsFor<T extends { callerNumber: string }>(
  role: string | null | undefined,
  calls: T[]
): T[] {
  if (!shouldMaskCallerFor(role)) return calls;
  return calls.map((call) => ({ ...call, callerNumber: callerNumberFor(role, call.callerNumber) }));
}
