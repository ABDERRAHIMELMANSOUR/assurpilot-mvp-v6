// src/app/(dashboard)/admin/whatsapp/page.tsx — the WhatsApp chat panel (admin view; scoped by the API).
import WhatsAppInbox from "@/components/ui/WhatsAppInbox";

export default function Page() {
  return <WhatsAppInbox mode="admin" />;
}
