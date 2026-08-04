// src/lib/fetchJson.ts
//
// Client-side fetch helper. A failing serverless function can answer with an
// HTML error page rather than JSON, so `res.json()` must never be called
// unguarded — otherwise the UI throws instead of showing the error.

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function fallbackMessage(status: number): string {
  if (status === 401) return "Session expirée. Veuillez vous reconnecter.";
  if (status === 403) return "Accès refusé.";
  if (status === 404) return "Ressource introuvable.";
  if (status === 413) return "Le fichier envoyé est trop volumineux.";
  if (status === 503) return "Service temporairement indisponible. Réessayez dans un instant.";
  if (status >= 500) return "Le serveur a rencontré une erreur. Réessayez dans un instant.";
  return "Une erreur est survenue.";
}

/**
 * Performs a request and returns the parsed JSON body.
 * Throws an `HttpError` carrying the API's `{ error }` message when available.
 */
export async function fetchJson<T = unknown>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new HttpError(0, "Erreur réseau. Vérifiez votre connexion.");
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null; // Not JSON — most likely an HTML error page from the platform.
    }
  }

  if (!res.ok) {
    const apiMessage =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : null;
    throw new HttpError(res.status, apiMessage ?? fallbackMessage(res.status));
  }

  return body as T;
}

/** Same as `fetchJson`, but resolves to `fallback` instead of throwing. */
export async function fetchJsonOr<T>(
  fallback: T,
  input: RequestInfo,
  init?: RequestInit
): Promise<T> {
  try {
    return await fetchJson<T>(input, init);
  } catch {
    return fallback;
  }
}

/** Normalises anything thrown into a message suitable for the UI. */
export function errorMessage(error: unknown, fallback = "Une erreur est survenue."): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
