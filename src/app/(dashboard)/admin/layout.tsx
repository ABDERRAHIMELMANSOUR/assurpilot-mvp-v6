// src/app/(dashboard)/admin/layout.tsx
//
// Everything under /admin is the administrator's workspace. The parent layout
// only checks that SOMEONE is signed in, so without this a coach or a conseiller
// could load these pages by typing the URL — the API would still refuse their
// data, but the screens and their controls would render. Checked on the server,
// so there is no flash of the page before a client-side redirect. The same guard
// protects /superviseur for coaches.
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // "/" sends each role to its own home, so nobody is bounced to a page that
  // would bounce them again.
  if (session.user.role !== "ADMINISTRATEUR") redirect("/");

  return <>{children}</>;
}
