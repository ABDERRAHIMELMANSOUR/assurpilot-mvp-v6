// src/app/api/health/route.ts
//
// Unauthenticated diagnostic endpoint. It exists because a login failure caused
// by an unreachable database is indistinguishable, from the browser, from a
// wrong password — and you cannot authenticate to reach an authenticated
// diagnostic when login itself is what's broken.
//
// It reports only booleans and coarse counts. No connection strings, no secret
// values, no user data. Nothing here is useful to an attacker beyond "the app
// is or isn't configured", which a failed login already reveals.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, unknown> = {
    // Presence only — never the value.
    nextauthSecretSet: Boolean(process.env.NEXTAUTH_SECRET),
    databaseUrlSet: Boolean(process.env.DATABASE_URL),
    directUrlSet: Boolean(process.env.DIRECT_URL),
  };

  // A password containing / $ & ? must be percent-encoded or the URI is
  // malformed — the single most common cause of a Prisma connection failure.
  const rawUrl = process.env.DATABASE_URL;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      checks.databaseUrlParses = true;
      checks.databaseHost = parsed.hostname; // host only, no credentials
      checks.databasePort = parsed.port || "(default)";
      checks.pgbouncerFlag = parsed.searchParams.get("pgbouncer") ?? "(absent)";
    } catch {
      checks.databaseUrlParses = false;
      checks.hint =
        "DATABASE_URL is not a valid URL. If the password contains / $ & ? or @, " +
        "percent-encode it (e.g. / -> %2F, ? -> %3F).";
    }
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.databaseReachable = true;

    const [users, activeUsers, calls] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.call.count(),
    ]);
    checks.schemaApplied = true;
    checks.counts = { users, activeUsers, calls };

    if (users === 0) {
      checks.hint = "Connected, but the users table is empty — the seed has not been applied.";
    }
  } catch (error) {
    checks.databaseReachable = false;
    const e = error as { name?: string; code?: string; message?: string };
    // Error class only; the message can embed the connection string.
    checks.databaseError = [e.name, e.code && `code=${e.code}`].filter(Boolean).join(" ") || "unknown";
    checks.hint =
      e.code === "P2021" || e.code === "P2022"
        ? "Connected, but the tables are missing — run the setup SQL against this database."
        : "Could not connect. Check DATABASE_URL (percent-encode special characters in the password) and that the host allows connections.";
  }

  const healthy =
    checks.databaseReachable === true &&
    checks.schemaApplied === true &&
    checks.nextauthSecretSet === true;

  return NextResponse.json({ healthy, ...checks }, { status: healthy ? 200 : 503 });
}
