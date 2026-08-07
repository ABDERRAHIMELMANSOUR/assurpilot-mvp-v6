"use client";
import { useSession } from "next-auth/react";
import UserCallHistory from "@/components/ui/UserCallHistory";

/** Coach drill-down: every call belonging to one of their conseillers. */
export default function CoachConseillerCallsPage({ params }: { params: { id: string } }) {
  const { data: session } = useSession();
  const currentUserId = (session?.user as { userId?: string } | undefined)?.userId;

  return (
    <UserCallHistory
      userId={params.id}
      backHref="/superviseur/equipe"
      backLabel="Mon équipe"
      currentUserId={currentUserId}
      allowTransfer
    />
  );
}
