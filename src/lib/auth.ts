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
          if (!credentials?.email || !credentials?.password) return null;

          const email = credentials.email.trim().toLowerCase();
          const user = await prisma.user.findUnique({ where: { email } });
          if (!user || !user.isActive) return null;

          const valid = await bcrypt.compare(credentials.password, user.password);
          if (!valid) return null;

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
          // A thrown error here becomes a 500 from /api/auth/callback/credentials.
          // Returning null keeps it a clean "invalid credentials" response.
          console.error("[auth] authorize failed:", error);
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
