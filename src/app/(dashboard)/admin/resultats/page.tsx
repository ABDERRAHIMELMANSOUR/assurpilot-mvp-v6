"use client";
import { useState, useEffect, useCallback } from "react";

type Option = {
  id: string;
  label: string;
  value: string;
  color: string;
  isActive: boolean;
  order: number;
};

const COLORS = [
  { value: "green",  label: "Vert",   cls: "bg-green-100 text-green-800 border-green-300" },
  { value: "blue",   label: "Bleu",   cls: "bg-blue-100 text-blue-800 border-blue-300" },
  { value: "red",    label: "Rouge",  cls: "bg-red-100 text-red-800 border-red-300" },
  { value: "yellow", label: "Jaune",  cls: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { value: "purple", label: "Violet", cls: "bg-purple-100 text-purple-800 border-purple-300" },
  { value: "gray",   label: "Gris",   cls: "bg-gray-100 text-gray-800 border-gray-300" },
];

const BADGE: Record<string, string> = {
  green:  "badge-green",
  blue:   "badge-blue",
  red:    "badge-red",
  yellow: "badge-yellow",
  purple: "bg-purple-100 text-purple-800",
  gray:   "badge-gray",
};

function slugify(s: string) {
  return s.trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export default function ResultatsPage() {
  const [options,  setOptions]  = useState<Option[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");

  // Create form
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newColor, setNewColor] = useState("gray");
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editId,    setEditId]    = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("gray");
  const [saving,    setSaving]    = useState(false);

  const fetchOptions = useCallback(async () => {
    setLoading(true);
    const res  = await fetch("/api/call-result-options");
    const data = await res.json();
    setOptions(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchOptions(); }, [fetchOptions]);

  // Auto-generate value from label
  useEffect(() => {
    setNewValue(slugify(newLabel));
  }, [newLabel]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/call-result-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel, value: newValue, color: newColor }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur"); return; }
      setNewLabel(""); setNewValue(""); setNewColor("gray");
      await fetchOptions();
    } catch { setError("Erreur réseau."); }
    finally { setCreating(false); }
  }

  async function handleToggle(opt: Option) {
    await fetch(`/api/call-result-options/${opt.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !opt.isActive }),
    });
    await fetchOptions();
  }

  async function handleDelete(opt: Option) {
    if (!confirm(`Supprimer "${opt.label}" ?\nSi cette option est déjà utilisée, elle sera désactivée.`)) return;
    const res  = await fetch(`/api/call-result-options/${opt.id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.warning) alert(data.warning);
    await fetchOptions();
  }

  async function handleMove(opt: Option, direction: "up" | "down") {
    const sorted = [...options].sort((a, b) => a.order - b.order);
    const idx    = sorted.findIndex((o) => o.id === opt.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    await Promise.all([
      fetch(`/api/call-result-options/${opt.id}`,   { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: other.order }) }),
      fetch(`/api/call-result-options/${other.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: opt.order }) }),
    ]);
    await fetchOptions();
  }

  async function handleSaveEdit(opt: Option) {
    setSaving(true);
    await fetch(`/api/call-result-options/${opt.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editLabel, color: editColor }),
    });
    setSaving(false);
    setEditId(null);
    await fetchOptions();
  }

  const sorted = [...options].sort((a, b) => a.order - b.order);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Résultats d'appel</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Configurez les options disponibles dans le formulaire de résultat d'appel
        </p>
      </div>

      {/* Current options */}
      <div className="card overflow-hidden mb-6">
        <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Options configurées</h2>
          <span className="text-xs text-gray-400">{options.filter(o=>o.isActive).length} active{options.filter(o=>o.isActive).length > 1 ? "s" : ""} / {options.length} total</span>
        </div>

        {loading ? (
          <div className="p-6 animate-pulse space-y-2">
            {[...Array(4)].map((_,i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
          </div>
        ) : sorted.length === 0 ? (
          <p className="p-6 text-sm text-gray-400 text-center">Aucune option configurée.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {sorted.map((opt, idx) => (
              <div key={opt.id} className={`px-5 py-3 flex items-center gap-3 ${!opt.isActive ? "opacity-50" : ""}`}>
                {/* Order controls */}
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => handleMove(opt, "up")} disabled={idx === 0}
                    className="w-5 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-xs">▲</button>
                  <button onClick={() => handleMove(opt, "down")} disabled={idx === sorted.length - 1}
                    className="w-5 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-xs">▼</button>
                </div>

                {editId === opt.id ? (
                  /* Inline edit */
                  <div className="flex flex-1 items-center gap-2">
                    <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <select value={editColor} onChange={(e) => setEditColor(e.target.value)}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {COLORS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <button onClick={() => handleSaveEdit(opt)} disabled={saving}
                      className="btn btn-primary text-xs py-1 px-2.5">{saving ? "..." : "OK"}</button>
                    <button onClick={() => setEditId(null)} className="btn btn-secondary text-xs py-1 px-2.5">✕</button>
                  </div>
                ) : (
                  <>
                    <span className={`badge ${BADGE[opt.color] ?? "badge-gray"} mr-1`}>{opt.label}</span>
                    <span className="text-xs text-gray-400 font-mono">{opt.value}</span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => { setEditId(opt.id); setEditLabel(opt.label); setEditColor(opt.color); }}
                        className="btn btn-secondary text-xs py-1 px-2.5">Modifier</button>
                      <button onClick={() => handleToggle(opt)}
                        className={`btn text-xs py-1 px-2.5 ${opt.isActive ? "btn-secondary" : "btn-primary"}`}>
                        {opt.isActive ? "Désactiver" : "Activer"}
                      </button>
                      <button onClick={() => handleDelete(opt)} className="btn btn-danger text-xs py-1 px-2.5">
                        Supprimer
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add new */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">Ajouter une option</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Libellé *</label>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ex : Devis réalisé" required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valeur (auto)</label>
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="DEVIS_REALISE"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Couleur</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button key={c.value} type="button" onClick={() => setNewColor(c.value)}
                  className={`px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all ${c.cls} ${newColor === c.value ? "border-current ring-2 ring-offset-1 ring-current/30" : "border-transparent opacity-60 hover:opacity-100"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="pt-1">
            <button type="submit" disabled={creating || !newLabel} className="btn btn-primary">
              {creating ? "Création..." : "+ Ajouter l'option"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
