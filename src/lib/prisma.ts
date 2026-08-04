// src/lib/prisma.ts
//
// Prisma Client singleton.
//
// Next.js dev mode hot-reloads modules on every edit, and each serverless
// invocation on Vercel may reuse a warm module scope. Creating a new
// PrismaClient per reload/invocation opens a new pool every time and quickly
// exhausts the database connection limit. Caching the instance on `globalThis`
// keeps exactly one client per process.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

// In production each lambda already has its own module scope, so the global
// cache is only needed to survive dev-server hot reloads.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
