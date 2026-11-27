// src/app/(dashboard)/conseiller/whatsapp/page.tsx — the WhatsApp chat panel (conseiller view; scoped by the API).
import WhatsAppInbox from "@/components/ui/WhatsAppInbox";

export default function Page() {
  return <WhatsAppInbox mode="conseiller" />;
}
