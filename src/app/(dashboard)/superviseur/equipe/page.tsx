"use client";
import { useEffect, useState, useCallback } from "react";
import UsersTable, { UserRow } from "@/components/ui/UsersTable";

export default function CoachEquipePage() {
  const [users,   setUsers]   = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const data = await fetch("/api/users").then((r) => r.json());
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Mon équipe</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gérez les conseillers de votre équipe</p>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-10 bg-gray-100 rounded-lg" />
          <div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      ) : (
        <UsersTable
          users={users}
          targetRole="CONSEILLER"
          currentUserRole="SUPERVISEUR"
          onRefresh={fetchUsers}
        />
      )}
    </div>
  );
}
