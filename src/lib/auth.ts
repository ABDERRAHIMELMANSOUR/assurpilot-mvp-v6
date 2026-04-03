// src/lib/auth.ts
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email:    { label: "Email",         type: "email"    },
        password: { label: "Mot de passe",  type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        // Update lastLoginAt + write login log
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        await prisma.loginLog.create({
          data: {
            userId:    user.id,
            ip:        (req as any)?.headers?.["x-forwarded-for"] ?? "",
            userAgent: (req as any)?.headers?.["user-agent"] ?? "",
          },
        });

        return {
          id:       user.id,
          email:    user.email,
          name:     `${user.prenom} ${user.nom}`,
          role:     user.role,
          teamId:   user.teamId,
          superviseurId: user.superviseurId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role          = (user as any).role;
        token.teamId        = (user as any).teamId;
        token.superviseurId = (user as any).superviseurId;
        token.userId        = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role          = token.role;
        (session.user as any).teamId        = token.teamId;
        (session.user as any).superviseurId = token.superviseurId;
        (session.user as any).userId        = token.userId;
      }
      return session;
    },
  },
};
