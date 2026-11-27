// src/lib/whatsapp/send.ts
//
// Sending a message from the app: enforce the 24-hour rule, record the message
// as "pending", hand it to Meta from the ACTIVE number, then keep Meta's id so
// the status webhooks (sent / delivered / read / failed) find it.
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest } from "@/lib/api";
import { accessToken, activeNumber, templateLanguage } from "@/lib/whatsapp/config";
import { sendMessage, type OutgoingMessage } from "@/lib/whatsapp/graph";
import { isTemplateName, preview, serviceWindow, templateParamCounts } from "@/lib/whatsapp/rules";

export type SendRequest =
  | { type: "text"; body: string }
  | { type: "template"; templateName: string; params?: string[] };

const MAX_TEXT = 4096; // Meta's limit for a text body

export function parseSendRequest(raw: Record<string, unknown>): SendRequest {
  if (raw.type === "text") {
    const body = typeof raw.body === "string" ? raw.body.trim() : "";
    if (!body) throw badRequest("Message vide");
    if (body.length > MAX_TEXT) throw badRequest(`Message trop long (${MAX_TEXT} caractères au plus)`);
    return { type: "text", body };
  }
  if (raw.type === "template") {
    const templateName = typeof raw.templateName === "string" ? raw.templateName : "";
    if (!isTemplateName(templateName)) throw badRequest("Modèle inconnu");
    const params = Array.isArray(raw.params) ? raw.params.map((p) => String(p ?? "").trim()) : [];
    if (params.some((p) => !p)) throw badRequest("Toutes les variables du modèle doivent être remplies");
    const expected = templateParamCounts()[templateName];
    if (expected !== undefined && params.length !== expected) {
      throw badRequest(`Le modèle ${templateName} attend ${expected} variable(s)`);
    }
    return { type: "template", templateName, params };
  }
  throw badRequest("type doit valoir \"text\" ou \"template\"");
}

export async function sendInConversation(
  conv: { id: string; waId: string; lastInboundAt: Date | null; lastInboundPhoneNumberId: string | null },
  req: SendRequest,
  senderId: string
) {
  const number = await activeNumber();
  if (!number.configured) throw new ApiError(503, `${number.label} : Phone Number ID non configuré`);
  // A missing token is a configuration problem, not a message that failed: nothing is recorded.
  if (!accessToken()) throw new ApiError(503, "WhatsApp n'est pas encore configuré (WHATSAPP_ACCESS_TOKEN manquant)");

  // The rule Meta enforces anyway, checked first so the user gets a clear reason.
  if (req.type === "text" && !serviceWindow(conv, number.phoneNumberId).open) {
    throw new ApiError(
      409,
      "Fenêtre de 24 h fermée sur le numéro actif : seul un modèle (template) peut être envoyé."
    );
  }

  const language = templateLanguage();
  const body = req.type === "text" ? req.body : `[Modèle ${req.templateName}]${req.params?.length ? " " + req.params.join(" · ") : ""}`;

  const saved = await prisma.waMessage.create({
    data: {
      conversationId: conv.id,
      direction: "OUT",
      type: req.type,
      body,
      templateName: req.type === "template" ? req.templateName : null,
      templateLanguage: req.type === "template" ? language : null,
      templateParams: req.type === "template" ? req.params ?? [] : undefined,
      phoneNumberId: number.phoneNumberId,
      status: "pending",
      sentById: senderId,
    },
  });

  const out: OutgoingMessage =
    req.type === "text"
      ? { kind: "text", body: req.body }
      : { kind: "template", name: req.templateName, language, params: req.params ?? [] };
  const result = await sendMessage(number.phoneNumberId, conv.waId, out);

  const now = new Date();
  const message = await prisma.waMessage.update({
    where: { id: saved.id },
    data: result.ok
      ? { waMessageId: result.waMessageId, status: "sent", statusAt: now }
      : { status: "failed", statusAt: now, errorCode: result.code, errorTitle: result.title },
  });
  await prisma.waConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: now, lastMessagePreview: preview(body) },
  });

  if (!result.ok) throw new ApiError(result.status, `Envoi refusé : ${result.title}`);
  return message;
}
