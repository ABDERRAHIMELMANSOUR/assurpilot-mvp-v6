// src/types/next-auth.d.ts
//
// Module augmentation so the extra fields our credentials provider puts on the
// session/JWT are typed everywhere instead of being reached through `as any`.
import type { DefaultSession } from "next-auth";

export type AppRole = "ADMINISTRATEUR" | "SUPERVISEUR" | "CONSEILLER";

declare module "next-auth" {
  interface Session {
    user: {
      userId: string;
      role: AppRole;
      teamId: string | null;
      superviseurId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    teamId: string | null;
    superviseurId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    role: AppRole;
    teamId: string | null;
    superviseurId: string | null;
  }
}
