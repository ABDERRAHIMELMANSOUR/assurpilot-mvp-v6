// src/lib/site-url.ts
//
// Resolves the canonical origin of the deployment.
//
// This runs at module scope in the root layout, i.e. during static generation.
// A `new URL()` that throws here fails the entire build with a bare
// `TypeError: Invalid URL`, so every candidate is validated before use.
//
// Note that `process.env.X || fallback` is NOT sufficient: `||` only rejects
// empty/undefined, while a truthy-but-malformed value such as "https://" or
// "my app.com" still throws. Validation has to actually attempt construction.

const LOCAL_FALLBACK = "http://localhost:3000";

/** Returns the origin if `value` can be parsed as an absolute URL, else null. */
function toOrigin(value: string | undefined): string | null {
  if (!value) return null;

  // Tolerate whitespace and quotes pasted into a dashboard env-var field.
  const cleaned = value.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
  if (!cleaned) return null;

  const candidate = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    const url = new URL(candidate);
    return url.hostname ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Preference order:
 *   1. NEXT_PUBLIC_APP_URL  — explicit override (custom domain)
 *   2. NEXTAUTH_URL         — already the canonical origin for auth callbacks
 *   3. VERCEL_URL           — set automatically on every Vercel deployment
 *   4. http://localhost:3000
 * The first candidate that parses wins; malformed ones are skipped, never thrown.
 */
export function getSiteUrl(): string {
  return (
    toOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
    toOrigin(process.env.NEXTAUTH_URL) ??
    toOrigin(process.env.VERCEL_URL) ??
    LOCAL_FALLBACK
  );
}

/** Same value as a URL instance, for `metadata.metadataBase`. Never throws. */
export function getSiteUrlObject(): URL {
  try {
    return new URL(getSiteUrl());
  } catch {
    return new URL(LOCAL_FALLBACK);
  }
}
