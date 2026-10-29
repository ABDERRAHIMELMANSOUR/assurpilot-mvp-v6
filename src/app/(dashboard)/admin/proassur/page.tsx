"use client";

// ProAssur: the CRM of the AUTO service (ALM and CPA). Santé / AZZUR is not concerned here.
// The administrator enters the identifiers the advisers already have in ProAssur: the couple
// ID_US + ID_EQ per adviser (ID_EQ = their ProAssur team, finer than the Assurpilot team), and
// optionally an ID_EQ per Auto team for an adviser without their own. Sent through $id_us /
// $id_eq of the ProAssur links. API: /api/admin/proassur/ids.
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { useToast } from "@/components/ui/Toast";
import UserFormModal from "@/components/ui/UserFormModal";

type Team = { id: string; nom: string; entity: "ALM" | "CPA" | null; idEq: string; advisers: number };
type Adviser = { id: string; name: string; role: string; line: string; teamId: string; team: string; idUs: string; idEq: string; idEqSent: string };
type Info = { teams: Team[]; advisers: Adviser[]; eqNames: Record<string, string> };
type RouteRow = { key: string; label: string; configured: boolean; target: string | null };

const VALID = /^[A-Za-z0-9 _.\-]{0,40}$/;

export default function ProAssurPage() {
  const toast = useToast();
  const { data: session } = useSession();
  const [info, setInfo] = useState<Info | null>(null);
  const [links, setLinks] = useState<RouteRow[]>([]);
  const [teamEq, setTeamEq] = useState<Record<string, string>>({});
  const [us, setUs] = useState<Record<string, string>>({});
  const [eq, setEq] = useState<Record<string, string>>({});
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [newTeam, setNewTeam] = useState({ entity: "ALM", nom: "", idEq: "" });
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ids, routes] = await Promise.all([
        fetchJson<Info>("/api/admin/proassur/ids"),
        fetchJson<{ routes: RouteRow[] }>("/api/admin/azzur/routes").catch(() => ({ routes: [] as RouteRow[] })),
      ]);
      setInfo(ids);
      setLinks(routes.routes.filter((r) => r.key.startsWith("AUTO_")));
    } catch (e) { toast.error(errorMessage(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const items: Array<Record<string, string>> = [];
  for (const t of info?.teams ?? []) {
    if (teamEq[t.id] !== undefined && teamEq[t.id].trim() !== t.idEq) items.push({ teamId: t.id, idEq: teamEq[t.id].trim() });
  }
  for (const a of info?.advisers ?? []) {
    const item: Record<string, string> = { userId: a.id };
    if (us[a.id] !== undefined && us[a.id].trim() !== a.idUs) item.idUs = us[a.id].trim();
    if (eq[a.id] !== undefined && eq[a.id].trim() !== a.idEq) item.idEq = eq[a.id].trim();
    if (moveTo[a.id] && moveTo[a.id] !== a.teamId) item.teamId = moveTo[a.id];
    if (Object.keys(item).length > 1) items.push(item);
  }
  const invalid = [...Object.values(teamEq), ...Object.values(us), ...Object.values(eq)].some((v) => !VALID.test(v.trim()));

  async function saveAll() {
    if (!items.length || invalid) return;
    setSaving(true);
    try {
      await fetchJson("/api/admin/proassur/ids", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      setTeamEq({}); setUs({}); setEq({}); setMoveTo({});
      await load();
      toast.success(`${items.length} modification(s) enregistrée(s).`);
    } catch (e) { toast.error(errorMessage(e, "Enregistrement impossible.")); }
    finally { setSaving(false); }
  }

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetchJson<{ team: { nom: string } }>("/api/admin/proassur/ids", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newTeam),
      });
      setNewTeam({ entity: newTeam.entity, nom: "", idEq: "" });
      await load();
      toast.success(`Équipe « ${res.team.nom} » créée.`);
    } catch (err) { toast.error(errorMessage(err, "Création impossible.")); }
    finally { setCreating(false); }
  }

  const needle = filter.trim().toLowerCase();
  const advisers = (info?.advisers ?? []).filter((a) => !needle || `${a.name} ${a.team} ${a.line} ${a.idUs}`.toLowerCase().includes(needle));
  const teamOf = (id: string) => info?.teams.find((t) => t.id === id);
  const missingUs = (info?.advisers ?? []).filter((a) => !a.idUs).length;
  const missingEq = (info?.advisers ?? []).filter((a) => !a.idEqSent).length;
  const eqLabel = (id: string) => (id && info?.eqNames[id] ? info.eqNames[id] : "");
  const linkUses = (l: RouteRow, v: string) => !!l.target?.includes(`$${v}`);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Intégration ProAssur (Auto)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Équipes et conseillers <b>Auto</b> (ALM, CPA) avec leurs identifiants ProAssur : <b>ID_EQ</b> pour l&apos;équipe,{" "}
            <b>ID_US</b> pour le conseiller. La Santé (AZZUR) n&apos;est pas concernée.
          </p>
        </div>
        <button className="btn btn-primary text-sm" disabled={!items.length || saving || invalid} onClick={saveAll}>
          {saving ? "Enregistrement…" : `Enregistrer (${items.length})`}
        </button>
      </div>

      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Équipes Auto</h2>
        <p className="text-xs text-slate-500 mb-3">
          L&apos;ID_EQ d&apos;un conseiller est celui de <b>son équipe ProAssur</b>, saisi sur sa ligne ci-dessous (une équipe Assurpilot comme
          « Équipe auto ALM » regroupe plusieurs équipes ProAssur : 64, 70, 72…). L&apos;ID_EQ d&apos;équipe ci-dessous ne sert qu&apos;aux
          conseillers qui n&apos;ont pas le leur.
        </p>
        {!info ? <p className="text-sm text-slate-400">Chargement…</p> : (
          <table className="w-full mb-4">
            <thead className="bg-slate-50/70 border-b border-slate-100">
              <tr><th className="table-th">Équipe</th><th className="table-th">Entité</th><th className="table-th">Conseillers</th><th className="table-th">ID_EQ</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {info.teams.map((t) => {
                const v = teamEq[t.id] ?? t.idEq;
                return (
                  <tr key={t.id} className={v.trim() !== t.idEq ? "bg-amber-50/60" : ""}>
                    <td className="table-td text-sm">{t.nom}</td>
                    <td className="table-td text-xs">{t.entity ?? "—"}</td>
                    <td className="table-td text-xs">{t.advisers}</td>
                    <td className="table-td">
                      <input value={v} onChange={(e) => setTeamEq((x) => ({ ...x, [t.id]: e.target.value }))}
                        aria-label={`ID_EQ ${t.nom}`} placeholder="ID_EQ"
                        className={`w-28 px-2 py-1 border rounded-lg text-xs font-mono ${VALID.test(v.trim()) ? "border-slate-200" : "border-rose-400"}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form onSubmit={createTeam} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <p className="w-full text-xs font-semibold text-slate-700">Ajouter une équipe Auto</p>
          <label className="text-xs">Entité
            <select value={newTeam.entity} onChange={(e) => setNewTeam((x) => ({ ...x, entity: e.target.value }))}
              className="block mt-0.5 px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white">
              <option value="ALM">ALM</option><option value="CPA">CPA</option>
            </select>
          </label>
          <label className="text-xs">Nom
            <span className="flex items-center gap-1 mt-0.5">
              <span className="text-slate-500 whitespace-nowrap">Équipe auto {newTeam.entity}</span>
              <input value={newTeam.nom} onChange={(e) => setNewTeam((x) => ({ ...x, nom: e.target.value }))} placeholder="ex. 2"
                className="w-32 px-2 py-1 border border-slate-200 rounded-lg text-xs" />
            </span>
          </label>
          <label className="text-xs">ID_EQ *
            <input value={newTeam.idEq} onChange={(e) => setNewTeam((x) => ({ ...x, idEq: e.target.value }))} placeholder="ID ProAssur" required
              className="block mt-0.5 w-28 px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono" />
          </label>
          <button className="btn btn-secondary text-xs" disabled={creating || !newTeam.idEq.trim() || !VALID.test(newTeam.idEq.trim())}>
            {creating ? "…" : "Créer l'équipe"}
          </button>
        </form>
      </div>

      <div className="card p-4 mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-slate-800 mr-auto">Conseillers Auto — ID_US et ID_EQ (ProAssur)</h2>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Rechercher…"
            aria-label="Rechercher un conseiller" className="input text-xs w-56" />
          <button className="btn btn-secondary text-xs" onClick={() => setAdding(true)}>+ Nouveau conseiller Auto</button>
        </div>
        {info && (
          <p className="text-xs text-slate-500 mb-2">
            {info.advisers.length} conseiller(s){missingUs ? ` · ${missingUs} sans ID_US` : ""}{missingEq ? ` · ${missingEq} sans ID_EQ` : ""}.
            Modifiez l&apos;ID_US, l&apos;ID_EQ ou l&apos;équipe puis cliquez « Enregistrer » en haut de la page.
          </p>
        )}
        {!info ? <p className="text-sm text-slate-400">Chargement…</p> : (
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full" style={{ minWidth: "760px" }}>
              <thead className="bg-slate-50/70 border-b border-slate-100 sticky top-0">
                <tr>
                  <th className="table-th">Conseiller</th><th className="table-th">Ligne</th><th className="table-th">Équipe</th>
                  <th className="table-th">ID_US</th><th className="table-th">ID_EQ (équipe ProAssur)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advisers.map((a) => {
                  const vUs = us[a.id] ?? a.idUs;
                  const vEq = eq[a.id] ?? a.idEq;
                  const team = moveTo[a.id] ?? a.teamId;
                  const dirty = vUs.trim() !== a.idUs || vEq.trim() !== a.idEq || team !== a.teamId;
                  return (
                    <tr key={a.id} className={dirty ? "bg-amber-50/60" : ""}>
                      <td className="table-td text-sm whitespace-nowrap">{a.name}{a.role === "SUPERVISEUR" && <span className="ml-1 text-[10px] text-slate-400">(coach)</span>}</td>
                      <td className="table-td font-mono text-xs">{a.line || "—"}</td>
                      <td className="table-td">
                        <select value={team} onChange={(e) => setMoveTo((x) => ({ ...x, [a.id]: e.target.value }))}
                          aria-label={`Équipe de ${a.name}`} className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white">
                          {info.teams.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
                        </select>
                      </td>
                      <td className="table-td">
                        <input value={vUs} onChange={(e) => setUs((x) => ({ ...x, [a.id]: e.target.value }))}
                          aria-label={`ID_US de ${a.name}`} placeholder="ID_US"
                          className={`w-24 px-2 py-1 border rounded-lg text-xs font-mono ${VALID.test(vUs.trim()) ? "border-slate-200" : "border-rose-400"}`} />
                      </td>
                      <td className="table-td">
                        <input value={vEq} onChange={(e) => setEq((x) => ({ ...x, [a.id]: e.target.value }))}
                          aria-label={`ID_EQ de ${a.name}`} placeholder={teamOf(team)?.idEq ? `${teamOf(team)!.idEq} (équipe)` : "ID_EQ"}
                          className={`w-20 px-2 py-1 border rounded-lg text-xs font-mono ${VALID.test(vEq.trim()) ? "border-slate-200" : "border-rose-400"}`} />
                        {eqLabel(vEq.trim() || teamOf(team)?.idEq || "") && (
                          <span className="block text-[10px] text-slate-400">{eqLabel(vEq.trim() || teamOf(team)?.idEq || "")}</span>
                        )}
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

      <div className="card p-4">
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
          Les identifiants partent par les variables <span className="font-mono">$id_us</span> et <span className="font-mono">$id_eq</span> du lien
          ProAssur, avec le nom de paramètre attendu par ProAssur, par ex.{" "}
          <span className="font-mono">…/A15.php?TelGsmTxt=$telephone&amp;NomTxt=$conseiller&amp;ID_US=$id_us&amp;ID_EQ=$id_eq</span>.
        </p>
      </div>

      {adding && (
        <UserFormModal
          mode="create"
          targetRole="CONSEILLER"
          currentUserRole={session?.user?.role ?? "ADMINISTRATEUR"}
          onClose={() => setAdding(false)}
          onSaved={() => { void load(); }}
        />
      )}
    </div>
  );
}
