// src/lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/types/next-auth";

// NextAuth signs its JWTs with NEXTAUTH_SECRET. Without it every request to
// /api/auth/* fails in production, which surfaces as a 500/502 on Vercel.
// Surface the cause at boot rather than leaving an opaque runtime failure.
const secret = process.env.NEXTAUTH_SECRET;
if (!secret && process.env.NODE_ENV === "production") {
  console.error(
    "[auth] NEXTAUTH_SECRET is not set. Add it to the Vercel project environment " +
      "variables (generate one with `openssl rand -base64 32`) — authentication " +
      "will fail without it."
  );
}

/**
 * Signals that the failure was infrastructure/configuration, not a wrong
 * password, so the UI can say so instead of blaming the user's credentials.
 */
class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

/** Renders an unknown thrown value into something useful in the Vercel logs. */
function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { name?: string; code?: string; message?: string };
    const parts = [e.name, e.code && `code=${e.code}`, e.message].filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return String(error);
}

/** Extracts a header value from the raw request NextAuth hands to `authorize`. */
function headerValue(req: unknown, name: string): string {
  const headers = (req as { headers?: Record<string, string | string[] | undefined> })?.headers;
  const raw = headers?.[name];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return typeof raw === "string" ? raw : "";
}

export const authOptions: NextAuthOptions = {
  secret,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials, req) {
        try {
          if (!credentials?.email || !credentials?.password) {
            console.error("[auth] REJECTED: email or password missing from the request");
            return null;
          }

          const email = credentials.email.trim().toLowerCase();

          // The database lookup is isolated so a connectivity/config failure is
          // never silently reported as "wrong password" — by far the most common
          // cause of a login that fails only once deployed.
          let user: Awaited<ReturnType<typeof prisma.user.findUnique>>;
          try {
            user = await prisma.user.findUnique({ where: { email } });
          } catch (dbError) {
            console.error(
              "[auth] DATABASE ERROR during user lookup — this is NOT a bad password. " +
                "Check DATABASE_URL (is the password percent-encoded?) and that the " +
                "schema has been applied.",
              describeError(dbError)
            );
            throw new AuthConfigurationError("database unreachable");
          }

          if (!user) {
            console.error(`[auth] REJECTED: no user row with email ${email}`);
            return null;
          }
          if (!user.isActive) {
            console.error(`[auth] REJECTED: user ${email} exists but isActive = false`);
            return null;
          }
          if (typeof user.password !== "string" || !/^\$2[aby]\$/.test(user.password)) {
            console.error(
              `[auth] REJECTED: stored password for ${email} is not a bcrypt hash ` +
                `(got ${typeof user.password}, length ${String(user.password ?? "").length}). ` +
                "Was the row seeded with a plaintext password?"
            );
            return null;
          }

          let valid: boolean;
          try {
            valid = await bcrypt.compare(credentials.password, user.password);
          } catch (compareError) {
            console.error("[auth] REJECTED: bcrypt.compare threw", describeError(compareError));
            return null;
          }
          if (!valid) {
            console.error(`[auth] REJECTED: password mismatch for ${email}`);
            return null;
          }
          console.info(`[auth] OK: ${email} authenticated as ${user.role}`);

          // Audit trail — must never block a legitimate login if it fails.
          try {
            await prisma.user.update({
              where: { id: user.id },
              data: { lastLoginAt: new Date() },
            });
            await prisma.loginLog.create({
              data: {
                userId: user.id,
                ip: headerValue(req, "x-forwarded-for"),
                userAgent: headerValue(req, "user-agent"),
              },
            });
          } catch (logError) {
            console.error("[auth] login audit failed:", logError);
          }

          return {
            id: user.id,
            email: user.email,
            name: `${user.prenom} ${user.nom}`,
            role: user.role,
            teamId: user.teamId,
            superviseurId: user.superviseurId,
          };
        } catch (error) {
          // Configuration/infrastructure failures are re-thrown so NextAuth
          // reports them as something other than "bad credentials"; the login
          // page uses that to show an accurate message. Everything else is
          // swallowed to avoid leaking which accounts exist.
          if (error instanceof AuthConfigurationError) throw error;
          console.error("[auth] REJECTED: unexpected error in authorize", describeError(error));
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = (user.role as AppRole) ?? "CONSEILLER";
        token.teamId = user.teamId ?? null;
        token.superviseurId = user.superviseurId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.userId = token.userId;
        session.user.role = token.role;
        session.user.teamId = token.teamId;
        session.user.superviseurId = token.superviseurId;
      }
      return session;
    },
  },
};
