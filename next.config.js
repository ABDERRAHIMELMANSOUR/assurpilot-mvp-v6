/**
 * next-auth reads NEXTAUTH_URL at MODULE SCOPE (next-auth/react builds its
 * `__NEXTAUTH` config with parseUrl(process.env.NEXTAUTH_URL) on import). Because
 * the root layout pulls in SessionProvider, that code runs while Next prerenders
 * every page — including /_not-found, which cannot be opted out of static
 * generation. A malformed value therefore fails the whole build with a bare
 * `TypeError: Invalid URL` and no indication of which variable is at fault.
 *
 * parseUrl() only throws on two shapes:
 *   ""            -> set but empty
 *   "https://"    -> protocol with no host
 * `undefined` is safe (it falls back to localhost, or VERCEL_URL on Vercel) and a
 * missing protocol is safe (parseUrl prepends https://).
 *
 * So: normalise what we can, and drop what we cannot, before anything imports
 * next-auth. Dropping is the correct fallback — on Vercel, next-auth then derives
 * the origin from VERCEL_URL, which is always right for the deployment.
 *
 * next.config.js is loaded in the build process and in each static-generation
 * worker, so the mutation applies everywhere the prerender runs.
 */
function normalizeNextAuthUrl() {
  const raw = process.env.NEXTAUTH_URL;

  // Not set at all: already safe, leave it alone.
  if (raw === undefined) return;

  // Strip whitespace and quotes accidentally included when pasting into a
  // dashboard env-var field (the quotes make it a syntactically valid but
  // wrong host rather than an error, which is worse — it fails silently).
  const cleaned = raw.trim().replace(/^(['"])(.*)\1$/, "$2").trim();

  const drop = (reason) => {
    delete process.env.NEXTAUTH_URL;
    console.warn(
      `[next.config] NEXTAUTH_URL ${reason}; ignoring it for this build. ` +
        `next-auth will fall back to VERCEL_URL (or http://localhost:3000 locally). ` +
        `Set it to a full origin such as https://your-app.vercel.app, or remove it entirely.`
    );
  };

  if (cleaned === "") return drop("is set but empty");
  if (/^https?:\/\/$/i.test(cleaned)) return drop("has a protocol but no host");

  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    // Same construction next-auth performs; if it throws here it would throw there.
    const parsed = new URL(withProtocol);
    if (!parsed.hostname) return drop("has no hostname");
    process.env.NEXTAUTH_URL = withProtocol;
  } catch {
    drop(`is not a valid URL (${JSON.stringify(raw)})`);
  }
}

normalizeNextAuthUrl();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel serves the app behind its own proxy; the framework header adds
  // nothing and only advertises the stack.
  poweredByHeader: false,
  eslint: {
    dirs: ["src"],
  },
};

module.exports = nextConfig;
