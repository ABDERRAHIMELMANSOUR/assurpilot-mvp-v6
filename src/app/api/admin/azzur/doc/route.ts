// src/app/api/admin/azzur/doc/route.ts
//
// Reads AZZUR's own documentation of the MER web service — the page its
// "Voir l'URL" button opens — and returns its text, so the exact variable names
// can be read from /admin/azzur. ADMIN ONLY.
//
// It requests the base URL ONLY (ws, id_prov, cle_ws): no contact data is sent,
// nothing is inserted. That is how AZZUR documents the page ("Cette URL vous donne
// accès à la documentation du web service").
import { NextResponse } from "next/server";
import { handleApiError, requireRole, badRequest } from "@/lib/api";
import { azzurSecret, htmlToText, readAzzurConfig, redactSecrets } from "@/lib/azzur";
import { loadAzzurRoutes } from "@/lib/azzurRoutesStore";
import { resolveEndpoint, ROUTE_KEYS, type RouteSettings } from "@/lib/azzurRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 60_000;

export async function GET() {
  try {
    await requireRole("ADMINISTRATEUR");
    const config = readAzzurConfig();
    // The documentation is the same for every link; read it through the reference URL
    // (AZZUR_MER_URL) if there is one, else through the first link that is configured.
    let base: URL | null = config.url;
    if (!base) {
      const { routes } = await loadAzzurRoutes().catch(() => ({ routes: {} as RouteSettings }));
      // AZZUR MER links only: opening a supplier script (ProAssur…) without data could insert an empty lead.
      base = ROUTE_KEYS.map((k) => resolveEndpoint(k, routes)).filter((e) => e.kind === "mer").map((e) => e.url).find((u): u is URL => u !== null) ?? null;
    }
    if (!base) throw badRequest("La documentation se lit via un lien AZZUR MER (gestfiches.com) : aucun n’est configuré. Les scripts fournisseur (ProAssur…) n’en ont pas.");

    const url = new URL(base.toString());
    // Keep only the three identifying parameters.
    for (const key of [...url.searchParams.keys()]) {
      if (!["ws", "id_prov", "cle_ws"].includes(key)) url.searchParams.delete(key);
    }
    url.searchParams.set("ws", "mer");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "text/html,*/*" } });
      const raw = await res.text();
      // The page prints the key in its example URL: remove it before it leaves the server.
      const text = redactSecrets(
        /<\s*(html|body|table|div)/i.test(raw) ? htmlToText(raw) : raw.replace(/\s+/g, " ").trim(),
        azzurSecret({ url: base })
      );
      return NextResponse.json({
        status: res.status,
        host: url.host,
        chars: text.length,
        truncated: text.length > MAX_CHARS,
        text: text.slice(0, MAX_CHARS),
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? "délai dépassé" : String(error);
      throw badRequest(redactSecrets(`Impossible de lire la documentation AZZUR : ${message}`, azzurSecret({ url: base })));
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return handleApiError(error, "GET /api/admin/azzur/doc");
  }
}
