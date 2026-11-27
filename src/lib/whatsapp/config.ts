// src/lib/whatsapp/config.ts
//
// Everything the WhatsApp Cloud API integration needs to know about itself.
//
// Secrets and number identifiers come from the environment ONLY (Vercel →
// Project Settings → Environment Variables), never from the repository or the
// database. The one thing stored in the database is which slot is SENDING
// (main or backup): an administrator's switch, kept as a setting row in
// azzur_routes like the Keyyo settings, so it needs no new column.
import { prisma } from "@/lib/prisma";

export type WaSlot = "PRIMARY" | "BACKUP";
export const WA_SLOTS: WaSlot[] = ["PRIMARY", "BACKUP"];

export type WaNumber = {
  slot: WaSlot;
  label: string;
  /** Human number shown in the UI, e.g. "+33 7 80 90 71 25". */
  displayNumber: string;
  /** Meta "Phone number ID" used in Graph API calls. */
  phoneNumberId: string;
  wabaId: string;
  configured: boolean;
};

const ACTIVE_SLOT_KEY = "setting:whatsappActiveSlot";

function env(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2").trim();
}

export function graphVersion(): string {
  return env("WHATSAPP_GRAPH_VERSION") || "v21.0";
}

export function accessToken(): string {
  return env("WHATSAPP_ACCESS_TOKEN");
}

export function appSecret(): string {
  return env("WHATSAPP_APP_SECRET");
}

export function verifyToken(): string {
  return env("WHATSAPP_VERIFY_TOKEN");
}

/** Language code the templates were approved in (Meta: "fr", "fr_FR", ...). */
export function templateLanguage(): string {
  return env("WHATSAPP_TEMPLATE_LANGUAGE") || "fr";
}

/** Public origin of the deployment, used to show the webhook URL to paste into Meta. */
export function publicBaseUrl(): string {
  return env("WHATSAPP_PUBLIC_BASE_URL") || env("NEXTAUTH_URL");
}

export function waNumber(slot: WaSlot): WaNumber {
  const prefix = slot === "PRIMARY" ? "WHATSAPP_PRIMARY" : "WHATSAPP_BACKUP";
  const phoneNumberId = env(`${prefix}_PHONE_NUMBER_ID`);
  return {
    slot,
    label: slot === "PRIMARY" ? "Numéro principal" : "Numéro backup",
    displayNumber: env(`${prefix}_DISPLAY_NUMBER`),
    phoneNumberId,
    // The backup may live in another WhatsApp Business Account; default to the main one.
    wabaId: env(`${prefix}_WABA_ID`) || env("WHATSAPP_WABA_ID"),
    configured: phoneNumberId !== "",
  };
}

export function allNumbers(): WaNumber[] {
  return WA_SLOTS.map(waNumber);
}

/** Which slot a business phone_number_id belongs to, if it is one of ours. */
export function slotForPhoneNumberId(phoneNumberId: string): WaSlot | null {
  if (!phoneNumberId) return null;
  return allNumbers().find((n) => n.phoneNumberId === phoneNumberId)?.slot ?? null;
}

/** The slot currently sending. Defaults to the main number. */
export async function loadActiveSlot(): Promise<WaSlot> {
  const row = await prisma.azzurRoute.findUnique({ where: { key: ACTIVE_SLOT_KEY } });
  return row?.url === "BACKUP" ? "BACKUP" : "PRIMARY";
}

export async function saveActiveSlot(slot: WaSlot, by: string | null): Promise<void> {
  await prisma.azzurRoute.upsert({
    where: { key: ACTIVE_SLOT_KEY },
    create: { key: ACTIVE_SLOT_KEY, url: slot, updatedById: by },
    update: { url: slot, updatedById: by },
  });
}

/** The number messages go out from right now. */
export async function activeNumber(): Promise<WaNumber> {
  return waNumber(await loadActiveSlot());
}

/** What is set, as booleans only: never a secret's value. */
export function configStatus() {
  return {
    accessToken: accessToken() !== "",
    appSecret: appSecret() !== "",
    verifyToken: verifyToken() !== "",
    publicBaseUrl: publicBaseUrl() !== "",
    graphVersion: graphVersion(),
    templateLanguage: templateLanguage(),
  };
}
