// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// bcryptjs and Prisma both need the Node.js runtime, and every auth request
// depends on cookies, so this segment must never be statically optimised.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
