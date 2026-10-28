"use client";

// ProAssur: the CRM of the AUTO teams (ALM and CPA). AZZUR is only for Santé (/admin/azzur).
// Here the administrator enters each adviser's identifiers AS THEY ARE IN PROASSUR — ID_US
// (the adviser) and ID_EQ (their ProAssur team) — plus a default ID_EQ per Auto team. They go
// out through $id_us / $id_eq in the ProAssur links (AUTO_ALM, AUTO_CPA). API: /api/admin/proassur/ids.
import { useCallback, useEffect, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { useToast } from "@/components/ui/Toast";

type Team = { id: string; nom: string; idEq: string };
type Adviser = {
  id: string; name: string; role: string; line: string; teamId: string | null; team: string | null;
  idUs: string; idEq: string; idEqSent: string;
};
type Info = { teams: Team[]; advisers: Adviser[] };
type RouteRow = { key: string; label: string; configured: boolean; kind: "mer" | "template" | null; target: string | null };

const VALID = /^[A-Za-z0-9 _.\-]{0,40}$/;

export default function ProAssurPage() {
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [links, setLinks] = useState<RouteRow[]>([]);
  const [all, setAll] = useState(false);
  const [teamEq, setTeamEq] = useState<Record<string, string>>({});
  const [us, setUs] = useState<Record<string, string>>({});
  const [eq, setEq] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ids, routes] = await Promise.all([
        fetchJson<Info>(`/api/admin/proassur/ids${all ? "?all=1" : ""}`),
        fetchJson<{ routes: RouteRow[] }>("/api/admin/azzur/routes").catch(() => ({ routes: [] as RouteRow[] })),
      ]);
      setInfo(ids);
      setLinks(routes.routes.filter((r) => r.key.startsWith("AUTO_")));
    } catch (e) { toast.error(errorMessage(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);
  useEffect(() => { load(); }, [load]);

  const items: Array<Record<string, string>> = [];
  for (const [teamId, v] of Object.entries(teamEq)) {
    if (info?.teams.find((t) => t.id === teamId)?.idEq !== v.trim()) items.push({ teamId, idEq: v.trim() });
  }
  for (const a of info?.advisers ?? []) {
    const item: Record<string, string> = { userId: a.id };
    if (us[a.id] !== undefined && us[a.id].trim() !== a.idUs) item.idUs = us[a.id].trim();
    if (eq[a.id] !== undefined && eq[a.id].trim() !== a.idEq) item.idEq = eq[a.id].trim();
    if (Object.keys(item).length > 1) items.push(item);
  }
  const invalid = [...Object.values(teamEq), ...Object.values(us), ...Object.values(eq)].some((v) => !VALID.test(v.trim()));

  async function saveAll() {
    if (!items.length || invalid) return;
    setSaving(true);
    try {
      await fetchJson("/api/admin/proassur/ids", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      setTeamEq({}); setUs({}); setEq({});
      await load();
      toast.success(`${items.length} modification(s) enregistrée(s).`);
    } catch (e) { toast.error(errorMessage(e, "Enregistrement impossible.")); }
    finally { setSaving(false); }
  }

  const needle = filter.trim().toLowerCase();
  const advisers = (info?.advisers ?? []).filter((a) => !needle || `${a.name} ${a.team ?? ""} ${a.line} ${a.idUs} ${a.idEq}`.toLowerCase().includes(needle));
  const missingUs = (info?.advisers ?? []).filter((a) => !a.idUs).length;
  const missingEq = (info?.advisers ?? []).filter((a) => !a.idEqSent).length;
  const linkUses = (l: RouteRow, v: string) => !!l.target?.includes(`$${v}`);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Intégration ProAssur</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            CRM des équipes <b>Auto</b> (ALM et CPA). Les fiches Santé partent vers AZZUR (page Intégration AZZUR).
          </p>
        </div>
        <button className="btn btn-primary text-sm" disabled={!items.length || saving || invalid} onClick={saveAll}>
          {saving ? "Enregistrement…" : `Enregistrer (${items.length})`}
        </button>
      </div>

      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-2">Liens ProAssur</h2>
        <ul className="space-y-1.5 text-xs">
          {links.length === 0 && <li className="text-slate-400">Chargement…</li>}
          {links.map((l) => (
            <li key={l.key} className="flex flex-wrap items-center gap-2">
              <span className="font-medium w-20">{l.label}</span>
              {l.configured ? <span className="font-mono break-all text-slate-600">{l.target}</span> : <span className="text-amber-700">non configuré</span>}
              {l.configured && (!linkUses(l, "id_us") || !linkUses(l, "id_eq")) && (
                <span className="text-amber-700">— n&apos;envoie pas encore {[!linkUses(l, "id_us") && "$id_us", !linkUses(l, "id_eq") && "$id_eq"].filter(Boolean).join(" ni ")}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-500 mt-2">
          Pour envoyer ces identifiants, ajoutez-les au lien ProAssur sur la page Intégration AZZUR (carte des liens), avec le nom de
          paramètre attendu par ProAssur, par ex. <span className="font-mono">…/A15.php?TelGsmTxt=$telephone&amp;NomTxt=$conseiller&amp;ID_US=$id_us&amp;ID_EQ=$id_eq</span>.
        </p>
      </div>

      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">ID_EQ par défaut des équipes Auto</h2>
        <p className="text-xs text-slate-500 mb-3">Utilisé pour un conseiller qui n&apos;a pas son propre ID_EQ.</p>
        {!info ? <p className="text-sm text-slate-400">Chargement…</p> : (
          <div className="flex flex-wrap gap-5">
            {info.teams.length === 0 && <p className="text-xs text-slate-400">Aucune équipe Auto.</p>}
            {info.teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-xs">
                <span className="font-medium whitespace-nowrap">{t.nom}</span>
                <input value={teamEq[t.id] ?? t.idEq} onChange={(e) => setTeamEq((x) => ({ ...x, [t.id]: e.target.value }))}
                  aria-label={`ID_EQ par défaut ${t.nom}`} placeholder="ID_EQ"
                  className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono" />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-slate-800 mr-auto">Conseillers : ID_US et ID_EQ (identiques à ProAssur)</h2>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Rechercher…"
            aria-label="Rechercher un conseiller" className="input text-xs w-56" />
          <label className="text-xs text-slate-600 flex items-center gap-1">
            <input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setUs({}); setEq({}); setTeamEq({}); }} /> Toutes les équipes
          </label>
        </div>
        {info && (
          <p className="text-xs text-slate-500 mb-2">
            {info.advisers.length} conseiller(s){missingUs ? ` · ${missingUs} sans ID_US` : ""}{missingEq ? ` · ${missingEq} sans ID_EQ (ni par défaut)` : ""}.
            Modifiez puis cliquez « Enregistrer » en haut de la page. Les deux identifiants se saisissent aussi dans la fiche du conseiller.
          </p>
        )}
        {!info ? <p className="text-sm text-slate-400">Chargement…</p> : (
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full" style={{ minWidth: "720px" }}>
              <thead className="bg-slate-50/70 border-b border-slate-100 sticky top-0">
                <tr>
                  <th className="table-th">Conseiller</th><th className="table-th">Ligne</th><th className="table-th">Équipe</th>
                  <th className="table-th">ID_US</th><th className="table-th">ID_EQ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advisers.map((a) => {
                  const vUs = us[a.id] ?? a.idUs;
                  const vEq = eq[a.id] ?? a.idEq;
                  const dirty = vUs.trim() !== a.idUs || vEq.trim() !== a.idEq;
                  const teamDefault = info.teams.find((t) => t.id === a.teamId)?.idEq ?? "";
                  return (
                    <tr key={a.id} className={dirty ? "bg-amber-50/60" : ""}>
                      <td className="table-td text-sm whitespace-nowrap">{a.name}{a.role === "SUPERVISEUR" && <span className="ml-1 text-[10px] text-slate-400">(coach)</span>}</td>
                      <td className="table-td font-mono text-xs">{a.line || "—"}</td>
                      <td className="table-td text-xs">{a.team ?? <span className="text-amber-700">aucune</span>}</td>
                      <td className="table-td">
                        <input value={vUs} onChange={(e) => setUs((x) => ({ ...x, [a.id]: e.target.value }))}
                          aria-label={`ID_US de ${a.name}`} placeholder="ID_US"
                          className={`w-28 px-2 py-1 border rounded-lg text-xs font-mono ${VALID.test(vUs.trim()) ? "border-slate-200" : "border-rose-400"}`} />
                      </td>
                      <td className="table-td">
                        <input value={vEq} onChange={(e) => setEq((x) => ({ ...x, [a.id]: e.target.value }))}
                          aria-label={`ID_EQ de ${a.name}`} placeholder={teamDefault ? `${teamDefault} (équipe)` : "ID_EQ"}
                          className={`w-28 px-2 py-1 border rounded-lg text-xs font-mono ${VALID.test(vEq.trim()) ? "border-slate-200" : "border-rose-400"}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {invalid && <p className="mt-2 text-xs text-rose-700">Identifiant invalide : lettres, chiffres, espace, « _ », « . » ou « - », 40 caractères au plus.</p>}
      </div>
    </div>
  );
}
