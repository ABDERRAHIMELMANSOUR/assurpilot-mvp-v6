"use client";
import { useSession } from "next-auth/react";
import UserCallHistory from "@/components/ui/UserCallHistory";

/** Admin drill-down: the full call history of any coach or conseiller. */
export default function AdminUserCallsPage({ params }: { params: { id: string } }) {
  const { data: session } = useSession();
  const currentUserId = (session?.user as { userId?: string } | undefined)?.userId;

  return (
    <UserCallHistory
      userId={params.id}
      backHref="/admin/utilisateurs"
      backLabel="Utilisateurs"
      currentUserId={currentUserId}
      allowTransfer
      isAdmin
    />
  );
}
