// src/app/(dashboard)/superviseur/layout.tsx
//
// Everything under /superviseur is the coach's workspace, and only a coach may
// open it. The parent layout only checks that SOMEONE is signed in, so without
// this a conseiller or an administrator could load these pages by typing the
// URL — the API would still scope their data, but the view and its controls
// would be on screen. Checked on the server, so there is no flash of the page
// before a client-side redirect.
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function SuperviseurLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // "/" sends each role to its own home, so nobody is bounced to a page that
  // would bounce them again.
  if (session.user.role !== "SUPERVISEUR") redirect("/");

  return <>{children}</>;
}
