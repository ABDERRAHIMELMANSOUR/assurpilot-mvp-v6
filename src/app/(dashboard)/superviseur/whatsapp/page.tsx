// src/app/(dashboard)/superviseur/whatsapp/page.tsx — the WhatsApp chat panel (coach view; scoped by the API).
import WhatsAppInbox from "@/components/ui/WhatsAppInbox";

export default function Page() {
  return <WhatsAppInbox mode="coach" />;
}
