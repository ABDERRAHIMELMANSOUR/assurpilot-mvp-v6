// src/lib/azzurRoutesStore.ts
//
// Reads and writes the four AZZUR links (table azzur_routes, prisma/sql/009).
// If the table has not been created yet everything still works: the settings are
// simply empty, so every call goes to the main link, and the settings page says so.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROUTE_KEYS, type RouteKey, type RouteSettings } from "@/lib/azzurRouting";

export type LoadedRoutes = {
  routes: RouteSettings;
  /** False when azzur_routes does not exist (migration 009 not run yet). */
  tableAvailable: boolean;
  /** Which keys come from the database and which from AZZUR_MER_URL_<KEY>. */
  origin: Partial<Record<RouteKey, "base" | "env">>;
};

function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

/** Database value first, then the AZZUR_MER_URL_<KEY> environment variable. */
export async function loadAzzurRoutes(env: Record<string, string | undefined> = process.env): Promise<LoadedRoutes> {
  const routes: RouteSettings = {};
  const origin: LoadedRoutes["origin"] = {};
  let tableAvailable = true;

  try {
    const rows = await prisma.azzurRoute.findMany();
    for (const row of rows) {
      if ((ROUTE_KEYS as readonly string[]).includes(row.key) && row.url.trim()) {
        routes[row.key as RouteKey] = row.url.trim();
        origin[row.key as RouteKey] = "base";
      }
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    tableAvailable = false;
  }

  for (const key of ROUTE_KEYS) {
    const fromEnv = (env[`AZZUR_MER_URL_${key}`] ?? "").trim();
    if (!routes[key] && fromEnv) {
      routes[key] = fromEnv;
      origin[key] = "env";
    }
  }
  return { routes, tableAvailable, origin };
}

/** Stores (or, with an empty value, clears) one link. */
export async function saveAzzurRoute(key: RouteKey, value: string, userId: string | null): Promise<void> {
  if (!value) {
    await prisma.azzurRoute.deleteMany({ where: { key } });
    return;
  }
  await prisma.azzurRoute.upsert({
    where: { key },
    create: { key, url: value, updatedById: userId },
    update: { url: value, updatedById: userId },
  });
}

export { isMissingTable };
