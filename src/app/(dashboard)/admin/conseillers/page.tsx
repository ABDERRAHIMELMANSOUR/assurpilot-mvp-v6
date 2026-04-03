"use client";
import { useEffect, useState, useCallback } from "react";
import UsersTable, { UserRow } from "@/components/ui/UsersTable";

export default function AdminConseillersPage() {
  const [users, setUsers]     = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<"all" | "active" | "inactive">("all");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res  = await fetch("/api/users?role=CONSEILLER");
    const data = await res.json();
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filtered =
    filter === "active"   ? users.filter((u) => u.isActive) :
    filter === "inactive" ? users.filter((u) => !u.isActive) :
    users;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Conseillers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Gérez tous les conseillers de la plateforme
          </p>
        </div>
        {/* Filter tabs */}
        <div className="flex gap-1.5 bg-gray-100 rounded-lg p-1">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-white shadow-sm text-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f === "all" ? "Tous" : f === "active" ? "Actifs" : "Inactifs"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-10 bg-gray-100 rounded-lg" />
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      ) : (
        <UsersTable
          users={filtered}
          targetRole="CONSEILLER"
          currentUserRole="ADMINISTRATEUR"
          onRefresh={fetchUsers}
        />
      )}
    </div>
  );
}
