// src/lib/api.ts
//
// Shared helpers for App Router route handlers.
//
// Every handler wraps its body in try/catch and funnels failures through
// `handleApiError`, so an unexpected throw becomes a JSON 4xx/5xx response
// instead of an unhandled rejection — which is what makes the serverless
// function crash and surface as a 502 Bad Gateway on Vercel.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import type { Session } from "next-auth";
import type { AppRole } from "@/types/next-auth";

export type Role = AppRole;

/** Shape of `session.user` once our NextAuth callbacks have run. */
export type SessionUser = Session["user"];

/** Standard JSON error envelope: `{ "error": "..." }`. */
export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Throwable error carrying the HTTP status the client should receive. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const unauthorized = () => new ApiError(401, "Non autorisé");
export const forbidden = (message = "Accès refusé") => new ApiError(403, message);
export const notFound = (message = "Ressource introuvable") => new ApiError(404, message);
export const badRequest = (message: string) => new ApiError(400, message);
export const conflict = (message: string) => new ApiError(409, message);

/**
 * Converts anything thrown inside a handler into a JSON response.
 * Unknown errors are logged server-side and reported generically so internal
 * details never leak to the client.
 */
export function handleApiError(error: unknown, context: string): NextResponse {
  if (error instanceof ApiError) {
    return jsonError(error.message, error.status);
  }

  // `req.json()` on a malformed/empty body throws a SyntaxError.
  if (error instanceof SyntaxError) {
    return jsonError("Corps de requête JSON invalide", 400);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return jsonError("Cette valeur est déjà utilisée", 409);
      case "P2003":
        return jsonError("Référence invalide vers un enregistrement lié", 400);
      case "P2025":
        return jsonError("Enregistrement introuvable", 404);
      default:
        console.error(`[${context}] Prisma ${error.code}:`, error.message);
        return jsonError("Erreur de base de données", 500);
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    console.error(`[${context}] Prisma initialisation:`, error);
    return jsonError("Base de données indisponible", 503);
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    console.error(`[${context}] Prisma validation:`, error.message);
    return jsonError("Requête invalide", 400);
  }

  console.error(`[${context}]`, error);
  return jsonError("Erreur interne du serveur", 500);
}

/** Returns the authenticated user or throws a 401. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userId) throw unauthorized();
  return session.user;
}

/** Returns the authenticated user, or throws 401/403 if the role is not allowed. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

/** Parses a JSON body, turning a malformed payload into a clean 400. */
export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest("Corps de requête JSON invalide");
  }
}
