// src/app/api/leads/proassur/auto-alm/route.ts
//
// PUBLIC entry point for an EXTERNAL website form (Auto ALM). It does not change any existing
// logic of AssurPilot: it only uses what is already there.
//
//   POST /api/leads/proassur/auto-alm
//     Header  Authorization: Bearer <WEB_LEADS_TOKEN>   (or x-lead-token: <WEB_LEADS_TOKEN>)
//     Body    JSON (or form-urlencoded): telephone (required), nom, prenom, email, code_postal,
//             date_naissance, commentaire, source, consentement — see src/lib/webLeads.ts
//
//   1. The lead is stored as a call of the team « Équipe auto ALM », on the line « Ligne auto
//      ALM », statut « En cours » (to be called back), rawMeta.source = "web-lead" with the
//      form's fields. Assigned to the adviser of WEB_LEADS_AUTO_ALM_ADVISER_EMAIL when set (an
//      active member of that team), otherwise to the team only.
//   2. It is sent to ProAssur through the EXISTING « AUTO_ALM » link, with the existing push
//      (pushCallToAzzur), the same switches (« Intégration » and « Envois automatiques » on
//      /admin/azzur) and the same one-fiche-per-number journal. Only difference: the link's name
//      fields (NomTxt / PrenomTxt) carry the form's nom / prénom, for this lead only.
//
// Security: WEB_LEADS_TOKEN (Vercel environment variable) must be sent; without it 401. Not set
// on the server -> 503 (the route is off). Browsers: only the origins of WEB_LEADS_ALLOWED_ORIGINS
// get CORS headers — but a token written in a web page is public, so call this route from the
// website's SERVER, not from the visitor's browser.
// The same number sent again within 10 minutes returns the lead already created (no duplicate).
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINE_ROUTES, normalizePhone } from "@/lib/phone";
import { parisWallClock } from "@/lib/keyyoWebhook";
import { linkForWebLead, readWebLead, type WebLead } from "@/lib/webLeads";
import { pushCallToAzzur, type PushResult } from "@/lib/azzur";
import { routeKeyFor } from "@/lib/azzurRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TEAM_NAME = "Équipe auto ALM";
const ROUTE_KEY = "AUTO_ALM" as const;
const DEDUPE_MINUTES = 10;

function allowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const allowed = (process.env.WEB_LEADS_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);
  return allowed.includes(origin.replace(/\/$/, "")) ? origin : null;
}

function reply(req: NextRequest, body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  const origin = allowedOrigin(req);
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

function tokenOk(req: NextRequest, expected: string): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const given = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : req.headers.get("x-lead-token") ?? "").trim();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await req.json();
      return body && typeof body === "object" && !Array.isArray(body) ? body : null;
    }
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return null;
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = allowedOrigin(req);
  const res = new NextResponse(null, { status: 204 });
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-lead-token");
    res.headers.set("Access-Control-Max-Age", "600");
    res.headers.set("Vary", "Origin");
  }
  return res;
}

export async function POST(req: NextRequest) {
  const expected = (process.env.WEB_LEADS_TOKEN ?? "").trim();
  if (expected.length < 16) {
    return reply(req, { ok: false, error: "point d'entrée non configuré (WEB_LEADS_TOKEN absent sur le serveur)" }, 503);
  }
  if (!tokenOk(req, expected)) return reply(req, { ok: false, error: "jeton absent ou invalide" }, 401);

  const body = await readBody(req);
  if (!body) return reply(req, { ok: false, error: "corps illisible : envoyez du JSON (Content-Type: application/json)" }, 400);
  const check = readWebLead(body);
  if (!check.ok) return reply(req, { ok: false, error: "champs invalides", fields: check.errors }, 422);
  const lead = check.lead;
  // A bot filled the hidden field: answered as a success, nothing stored or sent.
  if (lead.honeypot) return reply(req, { ok: true, leadId: null });

  try {
    const team = await prisma.team.findFirst({ where: { nom: TEAM_NAME }, select: { id: true, nom: true } });
    if (!team) return reply(req, { ok: false, error: `équipe « ${TEAM_NAME} » introuvable dans AssurPilot` }, 500);
    const autoAlm = LINE_ROUTES.find((r) => r.team === TEAM_NAME);
    const lines = await prisma.phoneLine.findMany({ where: { isActive: true }, select: { id: true, label: true, numeroMasque: true, teamId: true } });
    const line = lines.find((l) => l.teamId === team.id) ?? lines.find((l) => autoAlm && normalizePhone(l.numeroMasque) === autoAlm.numero);
    if (!line) return reply(req, { ok: false, error: "ligne Auto ALM introuvable (page Lignes)" }, 500);

    // Optional adviser the web leads are filed under (gives ProAssur its ID_US / ID_EQ).
    const adviserEmail = (process.env.WEB_LEADS_AUTO_ALM_ADVISER_EMAIL ?? "").trim().toLowerCase();
    const adviser = adviserEmail
      ? await prisma.user.findFirst({
          where: { email: { equals: adviserEmail, mode: "insensitive" }, isActive: true, teamId: team.id },
          select: { id: true, email: true, nom: true, prenom: true },
        })
      : null;

    const now = new Date();
    const startedAt = parisWallClock(now);

    // Same number within 10 minutes (double click, form sent twice): the lead already created.
    const recent = await prisma.call.findFirst({
      where: {
        teamId: team.id, callerNumber: lead.telephone, rawMeta: { contains: '"source":"web-lead"' },
        startedAt: { gte: new Date(startedAt.getTime() - DEDUPE_MINUTES * 60_000) },
      },
      select: { id: true, rawMeta: true },
    });
    if (recent) {
      let crm: string | null = null;
      try { crm = JSON.parse(recent.rawMeta ?? "{}").crm ?? null; } catch { /* ignore */ }
      return reply(req, { ok: true, leadId: recent.id, duplicate: true, proassur: crm ?? "déjà traité" });
    }

    const meta = {
      source: "web-lead",
      route: ROUTE_KEY,
      form: lead.source,
      nom: lead.nom || null,
      prenom: lead.prenom || null,
      email: lead.email || null,
      codePostal: lead.codePostal || null,
      dateNaissance: lead.dateNaissance || null,
      commentaire: lead.commentaire || null,
      consentement: lead.consentement,
      receivedAt: now.toISOString(),
      crm: null as string | null,
    };
    const call = await prisma.call.create({
      data: {
        phoneLineId: line.id,
        teamId: team.id,
        assignedUserId: adviser?.id ?? null,
        callerNumber: lead.telephone,
        isManual: false,
        isMissed: false,
        durationSeconds: 0,
        startedAt,
        statut: "EN_COURS",
        rawMeta: JSON.stringify(meta),
      },
      select: { id: true },
    });

    // 2. ProAssur, through the existing link and push.
    const crm = await sendToProAssur({ callId: call.id, lead, startedAt, teamName: team.nom, lineLabel: line.label, adviser });
    meta.crm = crm.label;
    await prisma.call.update({ where: { id: call.id }, data: { rawMeta: JSON.stringify(meta) } }).catch(() => undefined);
    console.log(`[web-lead] auto-alm ${call.id} ${lead.source} -> ${crm.label}`);
    return reply(req, { ok: true, leadId: call.id, proassur: crm.label, sent: crm.sent }, 201);
  } catch (error) {
    console.error("[web-lead] auto-alm erreur:", error instanceof Error ? error.message : error);
    return reply(req, { ok: false, error: "erreur interne, lead non enregistré" }, 500);
  }
}

async function sendToProAssur(p: {
  callId: string; lead: WebLead;
  startedAt: Date; teamName: string; lineLabel: string; adviser: { id: string; email: string; nom: string; prenom: string } | null;
}): Promise<{ sent: boolean; label: string }> {
  const store = await import("@/lib/azzurRoutesStore");
  const sends = await import("@/lib/azzurSendsStore");
  const { config } = await store.loadEffectiveConfig();
  if (!config.ready) return { sent: false, label: "non envoyé : intégration désactivée (/admin/azzur)" };
  if (!config.autoPush) return { sent: false, label: "non envoyé : « Envois automatiques » désactivés (/admin/azzur)" };
  const { routes } = await store.loadAzzurRoutes();
  const template = routes[ROUTE_KEY];
  if (!template) return { sent: false, label: "non envoyé : lien AUTO_ALM non configuré" };
  if (routeKeyFor(p.teamName, p.lineLabel) !== ROUTE_KEY) return { sent: false, label: "non envoyé : équipe / ligne hors Auto ALM" };

  // One fiche per number, as for calls.
  const already = await sends.alreadySent([{ number: p.lead.telephone, route: ROUTE_KEY }]);
  if (already.size) return { sent: false, label: "déjà envoyé à ProAssur (même numéro)" };

  // For this lead only: the form's nom / prénom in the link's name fields.
  const result: PushResult = await pushCallToAzzur(
    {
      reference: `lead:${p.callId}`,
      externalId: p.callId.slice(-24),
      teamName: p.teamName,
      lineLabel: p.lineLabel,
      callerNumber: p.lead.telephone,
      startedAt: p.startedAt,
      isMissed: false,
      conseiller: p.adviser ? { id: p.adviser.id, email: p.adviser.email, nom: p.adviser.nom, prenom: p.adviser.prenom } : null,
    },
    {
      config: {
        ...config,
        placeholders: { ...config.placeholders, ...(p.lead.nom ? { nom: p.lead.nom } : {}), ...(p.lead.prenom ? { prenom: p.lead.prenom } : {}) },
      },
      routes: { ...routes, [ROUTE_KEY]: linkForWebLead(template, p.lead) },
    },
  );
  await sends.recordAzzurSends([result]);
  return result.outcome === "sent"
    ? { sent: true, label: "envoyé à ProAssur" }
    : { sent: false, label: `non envoyé : ${result.detail}`.slice(0, 300) };
}
