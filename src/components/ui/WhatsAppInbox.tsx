"use client";
// src/components/ui/WhatsAppInbox.tsx
//
// The WhatsApp chat panel, one component for the three roles. What each role
// sees is decided by the API (src/lib/whatsapp/scope.ts), never here:
//   - conseiller : their own clients' conversations, and they answer them;
//   - coach      : their team's conversations, filterable by adviser, read-only
//                  except for their own clients; may reassign inside the team;
//   - admin      : every conversation, the unassigned queue, assignment.
// The composer follows the 24-hour rule: free text while the client's window is
// open on the active number, otherwise one of the approved templates.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson, errorMessage } from "@/lib/fetchJson";
import { usePolling } from "@/lib/usePolling";
import { STATUS_LABEL } from "@/lib/whatsapp/rules";

type Mode = "conseiller" | "coach" | "admin";
type Person = { id: string; nom: string; prenom: string };

type ConversationRow = {
  id: string;
  waId: string;
  clientPhone: string;
  clientName: string;
  owner: Person | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  windowOpen: boolean;
};

type Message = {
  id: string;
  direction: "IN" | "OUT";
  type: string;
  body: string;
  templateName: string | null;
  status: string;
  errorTitle: string | null;
  createdAt: string;
};

type Detail = {
  conversation: { id: string; waId: string; clientPhone: string; clientName: string; owner: Person | null };
  messages: Message[];
  activeNumber: { slot: string; label: string; displayNumber: string };
  window: { open: boolean; closesAt: string | null };
  canReply: boolean;
  canAssign: boolean;
};

type Meta = {
  templates: { name: string; label: string; params: number | null }[];
  assignees: (Person & { role: string })[];
};

const fullName = (p: Person | null) => (p ? `${p.prenom} ${p.nom}`.trim() : "Non attribué");

function formatPhone(waId: string, national: string): string {
  const n = national && /^0\d{9}$/.test(national) ? national : "";
  return n ? n.replace(/(\d{2})(?=\d)/g, "$1 ") : `+${waId}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " +
        d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function StatusMark({ status }: { status: string }) {
  const cls =
    status === "read" ? "text-cyan-600" :
    status === "failed" ? "text-rose-600" :
    "text-slate-400";
  const mark = status === "pending" ? "…" : status === "sent" ? "✓" : status === "failed" ? "!" : "✓✓";
  return <span className={`ml-1 text-[11px] font-semibold ${cls}`} title={STATUS_LABEL[status] ?? status}>{mark}</span>;
}

export default function WhatsAppInbox({ mode }: { mode: Mode }) {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);

  // Filters
  const [ownerFilter, setOwnerFilter] = useState(""); // "" = all, "__none" = unassigned (admin)
  const [q, setQ] = useState("");

  // Composer
  const [text, setText] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  const listUrl = useMemo(() => {
    const sp = new URLSearchParams();
    if (ownerFilter === "__none") sp.set("unassigned", "1");
    else if (ownerFilter) sp.set("owner", ownerFilter);
    if (q.trim()) sp.set("q", q.trim());
    const s = sp.toString();
    return "/api/whatsapp/conversations" + (s ? `?${s}` : "");
  }, [ownerFilter, q]);

  const loadList = useCallback(async () => {
    try {
      const data = await fetchJson<{ conversations: ConversationRow[] }>(listUrl);
      setRows(data.conversations);
      setListError("");
    } catch (err) {
      setListError(errorMessage(err, "Impossible de charger les conversations."));
    } finally {
      setLoading(false);
    }
  }, [listUrl]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await fetchJson<Detail>(`/api/whatsapp/conversations/${id}`);
      setDetail(data);
      setDetailError("");
    } catch (err) {
      setDetailError(errorMessage(err, "Impossible d'ouvrir la conversation."));
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    void fetchJson<Meta>("/api/whatsapp/meta").then(setMeta).catch(() => setMeta({ templates: [], assignees: [] }));
  }, []);
  useEffect(() => {
    setDetail(null);
    setSendError("");
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // No push channel on serverless: a short poll, paused while the tab is hidden.
  usePolling(() => { void loadList(); if (selectedId) void loadDetail(selectedId); }, 8000);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [detail?.messages.length]);

  const template = meta?.templates.find((t) => t.name === templateName) ?? null;
  useEffect(() => {
    setParams(template?.params ? Array(template.params).fill("") : []);
  }, [template?.name, template?.params]);

  async function send(kind: "text" | "template") {
    if (!selectedId) return;
    setSending(true); setSendError("");
    try {
      await fetchJson(`/api/whatsapp/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "text" ? { type: "text", body: text } : { type: "template", templateName, params }),
      });
      if (kind === "text") setText(""); else setTemplateName("");
    } catch (err) {
      setSendError(errorMessage(err, "Envoi impossible."));
    } finally {
      setSending(false);
      void loadDetail(selectedId);
      void loadList();
    }
  }

  async function assign(ownerUserId: string | null) {
    if (!selectedId) return;
    try {
      await fetchJson(`/api/whatsapp/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUserId }),
      });
      void loadDetail(selectedId);
      void loadList();
    } catch (err) {
      setDetailError(errorMessage(err, "Attribution impossible."));
    }
  }

  const title = mode === "conseiller" ? "Mes conversations WhatsApp" : mode === "coach" ? "WhatsApp de l'équipe" : "Toutes les conversations WhatsApp";

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {rows.length} conversation{rows.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode !== "conseiller" && (
            <select className="input w-56" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
              <option value="">{mode === "coach" ? "Toute l'équipe" : "Tous les conseillers"}</option>
              {mode === "admin" && <option value="__none">Non attribuées</option>}
              {(meta?.assignees ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.prenom} {a.nom}</option>
              ))}
            </select>
          )}
          <input className="input w-56" placeholder="Nom ou numéro" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {listError && <div className="card p-3 mb-3 text-sm text-rose-700 bg-rose-50 border-rose-200">{listError}</div>}

      <div className="card overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr] min-h-[560px]">
        {/* Conversation list */}
        <div className="border-b md:border-b-0 md:border-r border-slate-200 overflow-y-auto max-h-[70vh]">
          {loading && <p className="p-4 text-sm text-slate-500">Chargement…</p>}
          {!loading && rows.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune conversation.</p>}
          {rows.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${selectedId === c.id ? "bg-brand-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm text-slate-900 truncate">
                  {c.clientName || formatPhone(c.waId, c.clientPhone)}
                </span>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">{formatTime(c.lastMessageAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-xs text-slate-500 truncate">{c.lastMessagePreview || "—"}</span>
                {c.unreadCount > 0 && (
                  <span className="text-[11px] font-semibold bg-emerald-500 text-white rounded-full px-1.5 min-w-[18px] text-center">{c.unreadCount}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {mode !== "conseiller" && <span className="text-[11px] text-slate-500">{fullName(c.owner)}</span>}
                <span className={`text-[10px] px-1.5 rounded-full border ${c.windowOpen ? "border-emerald-200 text-emerald-700 bg-emerald-50" : "border-slate-200 text-slate-500"}`}>
                  {c.windowOpen ? "24 h ouverte" : "Modèle requis"}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Conversation */}
        <div className="flex flex-col min-h-[560px]">
          {!selectedId && <div className="m-auto text-sm text-slate-500">Choisissez une conversation.</div>}
          {selectedId && detailError && <div className="p-4 text-sm text-rose-700">{detailError}</div>}
          {selectedId && detail && (
            <>
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="font-semibold text-slate-900">
                    {detail.conversation.clientName || formatPhone(detail.conversation.waId, detail.conversation.clientPhone)}
                  </p>
                  <p className="text-xs text-slate-500">
                    +{detail.conversation.waId} · Conseiller : {fullName(detail.conversation.owner)}
                  </p>
                </div>
                {detail.canAssign && meta && meta.assignees.length > 0 && (
                  <select
                    className="input w-56"
                    value={detail.conversation.owner?.id ?? ""}
                    onChange={(e) => void assign(e.target.value || null)}
                  >
                    {mode === "admin" ? <option value="">Non attribuée</option> : !detail.conversation.owner && <option value="">—</option>}
                    {meta.assignees.map((a) => (
                      <option key={a.id} value={a.id}>{a.prenom} {a.nom}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-slate-50 max-h-[55vh]">
                {detail.messages.length === 0 && <p className="text-sm text-slate-500">Aucun message.</p>}
                {detail.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "OUT" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-soft whitespace-pre-wrap break-words ${
                        m.direction === "OUT" ? "bg-emerald-50 border border-emerald-100" : "bg-white border border-slate-200"
                      }`}
                    >
                      {m.templateName && <p className="text-[11px] font-semibold text-emerald-700 mb-0.5">Modèle {m.templateName}</p>}
                      <p className="text-slate-800">{m.body}</p>
                      <p className="text-[11px] text-slate-400 text-right mt-0.5">
                        {formatTime(m.createdAt)}
                        {m.direction === "OUT" && <StatusMark status={m.status} />}
                      </p>
                      {m.status === "failed" && m.errorTitle && <p className="text-[11px] text-rose-600 mt-0.5">{m.errorTitle}</p>}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-slate-200 p-3 space-y-2">
                <p className="text-xs text-slate-500">
                  Envoi depuis {detail.activeNumber.label}
                  {detail.activeNumber.displayNumber ? ` (${detail.activeNumber.displayNumber})` : ""} ·{" "}
                  {detail.window.open && detail.window.closesAt
                    ? `fenêtre 24 h ouverte jusqu'à ${formatTime(detail.window.closesAt)}`
                    : "fenêtre 24 h fermée sur ce numéro : modèle uniquement"}
                </p>
                {!detail.canReply ? (
                  <p className="text-sm text-slate-500">Lecture seule : seul le conseiller de ce client ou un administrateur peut écrire.</p>
                ) : (
                  <>
                    {detail.window.open && (
                      <div className="flex gap-2">
                        <textarea
                          className="input flex-1 min-h-[44px]"
                          rows={2}
                          placeholder="Votre message…"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                        />
                        <button className="btn btn-primary self-end" disabled={sending || !text.trim()} onClick={() => void send("text")}>
                          Envoyer
                        </button>
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                      <select className="input w-64" value={templateName} onChange={(e) => setTemplateName(e.target.value)}>
                        <option value="">Envoyer un modèle…</option>
                        {(meta?.templates ?? []).map((t) => (
                          <option key={t.name} value={t.name}>{t.label} ({t.name})</option>
                        ))}
                      </select>
                      {templateName && template?.params == null && (
                        <input
                          className="input w-64"
                          placeholder="Variables séparées par ;"
                          value={params.join(";")}
                          onChange={(e) => setParams(e.target.value ? e.target.value.split(";") : [])}
                        />
                      )}
                      {templateName && template?.params != null && params.map((p, i) => (
                        <input
                          key={i}
                          className="input w-40"
                          placeholder={`{{${i + 1}}}`}
                          value={p}
                          onChange={(e) => setParams((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                        />
                      ))}
                      {templateName && (
                        <button className="btn btn-secondary" disabled={sending} onClick={() => void send("template")}>
                          Envoyer le modèle
                        </button>
                      )}
                    </div>
                  </>
                )}
                {sendError && <p className="text-sm text-rose-700">{sendError}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
