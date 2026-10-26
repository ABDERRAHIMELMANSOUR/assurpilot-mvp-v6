"use client";
import { useEffect, useState, useRef } from "react";
import { dispatchAll, type DispatchSummary } from "@/lib/azzurDispatch";
import { errorMessage } from "@/lib/fetchJson";
import Link from "next/link";

type PreviewRow = {
  rowIndex:        number;
  callerNumber:    string;
  numeroAppele:    string;
  startedAt:       string | null;
  durationSeconds: number;
  statut:          string;
  conseiller:      string | null;
  isDuplicate:     boolean;
  error:           string;
};

type Reconciliation = {
  rows: number;
  period: { from: string; to: string } | null;
  alreadyInAssurpilot: number;
  duplicatedInFile: number;
  toImport: number;
  rejected: number;
  rejectedByReason: { label: string; count: number }[];
  unknownLines: { label: string; count: number }[];
  missed: number;
  byTeam: { team: string; total: number; already: number; fresh: number; missed: number; coach: number }[];
  byLine: { label: string; count: number }[];
};

type PreviewResult = {
  reconciliation?: Reconciliation;
  totalRows:     number;
  validRows:     number;
  invalidRows:   number;
  duplicateRows: number;
  preview:       PreviewRow[];
  unmatchedNumbers: string[];
  /** Advisers matched by phone but with no Équipe on their profile. */
  advisersWithoutTeam?: string[];
};

type ImportResult = {
  success:       boolean;
  /** Null when every row was a duplicate: no batch is created for nothing. */
  batchId:       string | null;
  /** "Envois automatiques" is on: the page dispatches the batch to the CRMs itself. */
  azzurAutoDispatch?: boolean;
  totalRows:     number;
  importedRows:  number;
  duplicateRows: number;
  skippedRows:   number;
  errors:        { row: number; numero: string; error: string }[];
};

function formatDur(s: number): string {
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) +
    " " +
    // Seconds included: a row is a duplicate only when the timestamp matches
    // exactly, so two rows thirty seconds apart are two calls. Rounded to the
    // minute they looked identical, and the preview seemed to keep one and
    // drop the other at random.
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );
}

export default function ImportAppelsPage() {
  const fileRef                     = useRef<HTMLInputElement>(null);
  const [file,        setFile]      = useState<File | null>(null);
  const [dragging,    setDragging]  = useState(false);
  const [previewing,  setPreviewing]= useState(false);
  const [importing,   setImporting] = useState(false);
  const [preview,     setPreview]   = useState<PreviewResult | null>(null);
  const [result,      setResult]    = useState<ImportResult | null>(null);
  const [error,       setError]     = useState("");

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setPreview(null); setResult(null); setError(""); }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setPreview(null); setResult(null); setError(""); }
  }

  async function handlePreview() {
    if (!file) return;
    setPreviewing(true); setError(""); setPreview(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("preview", "true");
    try {
      const res  = await fetch("/api/calls/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur lors de l'analyse."); return; }
      setPreview(data);
    } catch { setError("Erreur réseau."); }
    finally { setPreviewing(false); }
  }

  async function handleImport() {
    if (!file || !preview) return;
    setImporting(true); setError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("preview", "false");
    try {
      const res  = await fetch("/api/calls/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur lors de l'import."); return; }
      setResult(data); setPreview(null);
    } catch { setError("Erreur réseau."); }
    finally { setImporting(false); }
  }

  function reset() {
    setFile(null); setPreview(null); setResult(null); setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const ext      = file?.name.split(".").pop()?.toLowerCase();
  const validExt = ext === "xlsx" || ext === "csv" || ext === "xls";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/admin/appels" className="btn btn-secondary text-xs py-1 px-2.5">← Retour</Link>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Import d'appels</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Importez un fichier Excel ou CSV exporté depuis Keyyo ou votre opérateur VoIP
          </p>
        </div>
      </div>

      {/* Success */}
      {result && (
        <div className="mb-6 card p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-slate-900 mb-3">Import terminé</h2>
              {result.batchId && result.importedRows > 0 && result.azzurAutoDispatch && (
                <AutoDispatch batchId={result.batchId} />
              )}
              {result.batchId && result.importedRows > 0 && !result.azzurAutoDispatch && (
                <p className="text-sm text-slate-600 mb-3">
                  Rien n&apos;a été envoyé à AZZUR.{" "}
                  <Link href={`/admin/azzur?source=${encodeURIComponent("batch:" + result.batchId)}`} className="text-brand-600 font-medium hover:underline">
                    Vérifier la répartition et envoyer vers AZZUR →
                  </Link>
                </p>
              )}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold text-slate-900">{result.totalRows}</p>
                  <p className="text-xs text-slate-500">Lignes totales</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold text-emerald-700">{result.importedRows}</p>
                  <p className="text-xs text-emerald-600">Importées</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold text-amber-700">{result.duplicateRows}</p>
                  <p className="text-xs text-amber-600">Doublons ignorés</p>
                </div>
                <div className="bg-rose-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold text-rose-700">{result.skippedRows}</p>
                  <p className="text-xs text-rose-600">Invalides ignorées</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Lignes invalides ({result.errors.length})
                  </p>
                  <div className="bg-rose-50 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-xs text-rose-700">
                        Ligne {e.row} · <span className="font-mono">{e.numero || "—"}</span> — {e.error}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <Link href="/admin/appels" className="btn btn-primary text-xs">Voir les appels importés</Link>
                <button onClick={reset} className="btn btn-secondary text-xs">Nouvel import</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!result && (
        <>
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`card p-8 text-center cursor-pointer transition-all mb-5 ${
              dragging         ? "border-blue-400 bg-brand-50 border-2" :
              file && validExt ? "border-green-300 bg-green-50 border-2" :
              "border-dashed border-slate-300 hover:border-blue-300 hover:bg-brand-50/30"
            }`}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-900">{file.name}</p>
                <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} Ko · cliquez pour changer</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Glissez votre fichier ici</p>
                  <p className="text-xs text-slate-400 mt-0.5">ou cliquez pour parcourir</p>
                </div>
                <div className="flex gap-2">
                  {[".xlsx", ".xls", ".csv"].map((f) => (
                    <span key={f} className="badge badge-gray">{f}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Column mapping reference */}
          <div className="card p-4 mb-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Correspondance des colonnes
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { col: "Numéro présenté",    role: "Numéro du client",    highlight: true  },
                { col: "Numéro appelé",      role: "Numéro du conseiller → identification", highlight: true },
                { col: "Début d'appel",      role: "Date et heure de l'appel" },
                { col: "Durée réelle (s)",   role: "Durée en secondes (0 = appel manqué)" },
                { col: "Numéro appelant",    role: "Stocké en métadonnées uniquement" },
                { col: "Destination / Site", role: "Stockés en métadonnées" },
              ].map((r) => (
                <div key={r.col} className="flex gap-2 text-xs items-start">
                  <span className={`font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${r.highlight ? "bg-brand-50 text-brand-800" : "bg-slate-100 text-slate-700"}`}>
                    {r.col}
                  </span>
                  <span className="text-slate-500">{r.role}</span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-700">{error}</div>
          )}

          {/* Analyse button */}
          {!preview && (
            <div className="flex gap-3">
              <button onClick={handlePreview} disabled={!file || !validExt || previewing}
                className="btn btn-primary disabled:opacity-50">
                {previewing ? "Analyse en cours..." : "Analyser le fichier"}
              </button>
              {file && <button onClick={reset} className="btn btn-secondary">Annuler</button>}
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="space-y-4">
              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-3">
                <div className="stat-card text-center">
                  <p className="text-2xl font-semibold text-slate-900">{preview.totalRows}</p>
                  <p className="text-xs text-slate-500 mt-1">Lignes totales</p>
                </div>
                <div className="stat-card text-center">
                  <p className="text-2xl font-semibold text-emerald-600">{preview.validRows}</p>
                  <p className="text-xs text-emerald-600 mt-1">Lignes valides</p>
                </div>
                <div className="stat-card text-center">
                  <p className="text-2xl font-semibold text-amber-600">{preview.duplicateRows}</p>
                  <p className="text-xs text-amber-600 mt-1">Doublons ignorés</p>
                </div>
                <div className="stat-card text-center">
                  <p className="text-2xl font-semibold text-rose-500">{preview.invalidRows}</p>
                  <p className="text-xs text-rose-500 mt-1">Invalides</p>
                </div>
              </div>

              {/* Unmatched numbers warning */}
              {preview.reconciliation && <ReconciliationPanel r={preview.reconciliation} />}

              {preview.unmatchedNumbers.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-amber-800 mb-1">
                    ⚠ {preview.unmatchedNumbers.length} numéro{preview.unmatchedNumbers.length > 1 ? "s" : ""} appelé{preview.unmatchedNumbers.length > 1 ? "s" : ""} non reconnu{preview.unmatchedNumbers.length > 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-amber-700 mb-2">
                    Ces numéros ne correspondent à aucun conseiller actif.
                    Vérifiez que les conseillers ont leur numéro de téléphone configuré dans leur profil.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {preview.unmatchedNumbers.map((n) => (
                      <span key={n} className="font-mono text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">{n}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* States the rule plainly, before the user commits. Only an
                  exact re-import of the same call is refused; a prospect
                  ringing back is a separate record, folded together when
                  reading via "Regrouper les doublons". */}
              <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
                <svg className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-brand-800">
                  <strong>Tous les appels valides sont importés.</strong>{" "}
                  Un même numéro peut revenir plusieurs fois : chaque rappel est un
                  appel distinct. Seule une ligne <strong>strictement identique</strong>{" "}
                  à un appel déjà en base — même numéro, même horodatage à la seconde
                  et même durée — est marquée <strong>Doublon</strong> et ignorée, pour
                  qu&apos;un fichier re-déposé ne crée pas de doublons. Le regroupement
                  des rappels se fait à la lecture, via{" "}
                  <strong>Regrouper les doublons</strong>.
                  {preview.duplicateRows > 0 && (
                    <>
                      {" "}
                      <span className="text-amber-800">
                        {preview.duplicateRows} ligne{preview.duplicateRows > 1 ? "s" : ""} sur{" "}
                        {preview.totalRows} déjà présente{preview.duplicateRows > 1 ? "s" : ""}{" "}
                        {preview.duplicateRows > 1 ? "seront ignorées" : "sera ignorée"}.
                      </span>
                    </>
                  )}
                </p>
              </div>

              {/* Advisers with no Équipe: their calls import, but the entity
                  workspaces are built from the adviser's team, so those rows
                  would appear in neither CPA nor ALM. */}
              {(preview.advisersWithoutTeam?.length ?? 0) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-amber-800 mb-1">
                    ⚠ {preview.advisersWithoutTeam!.length} conseiller{preview.advisersWithoutTeam!.length > 1 ? "s" : ""} sans équipe
                  </p>
                  <p className="text-xs text-amber-700 mb-2">
                    Leurs appels seront importés, mais n&apos;apparaîtront ni dans
                    l&apos;espace CPA ni dans l&apos;espace ALM : l&apos;entité d&apos;un appel vient
                    de l&apos;équipe du conseiller. Renseignez leur Équipe dans leur profil.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {preview.advisersWithoutTeam!.map((n) => (
                      <span key={n} className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">{n}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">
                    Aperçu ({Math.min(preview.preview.length, 100)} lignes)
                  </p>
                  <div className="flex gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Valide</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Doublon</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Invalide</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="table-th w-12">Ligne</th>
                        <th className="table-th">N° client</th>
                        <th className="table-th">N° conseiller</th>
                        <th className="table-th">Conseiller</th>
                        <th className="table-th">Date</th>
                        <th className="table-th">Durée</th>
                        <th className="table-th">Statut</th>
                        <th className="table-th">État</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.preview.map((row) => {
                        const rowClass =
                          row.isDuplicate ? "bg-amber-50/60" :
                          row.error       ? "bg-rose-50/50"   :
                          "hover:bg-slate-50";
                        return (
                          <tr key={row.rowIndex} className={`transition-colors ${rowClass}`}>
                            <td className="table-td text-xs text-slate-400">{row.rowIndex}</td>
                            <td className="table-td font-mono text-sm text-slate-800">
                              {row.callerNumber || "—"}
                            </td>
                            <td className="table-td font-mono text-xs text-slate-500">
                              {row.numeroAppele || "—"}
                            </td>
                            <td className="table-td text-sm">
                              {row.conseiller
                                ? <span className="text-slate-900">{row.conseiller}</span>
                                : <span className="text-rose-500 text-xs font-medium">Non trouvé</span>}
                            </td>
                            <td className="table-td text-xs text-slate-500 whitespace-nowrap">
                              {formatDate(row.startedAt)}
                            </td>
                            <td className="table-td font-mono text-sm">
                              {formatDur(row.durationSeconds)}
                            </td>
                            <td className="table-td">
                              <span className={`badge ${row.statut === "REPONDU" ? "badge-green" : "badge-red"}`}>
                                {row.statut === "REPONDU" ? "Répondu" : "Manqué"}
                              </span>
                            </td>
                            <td className="table-td">
                              {row.isDuplicate ? (
                                <span className="badge badge-yellow">Doublon</span>
                              ) : row.error ? (
                                <span className="text-xs text-rose-600">{row.error}</span>
                              ) : (
                                <span className="badge badge-green text-xs">OK</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Import actions */}
              <div className="flex gap-3 pt-1">
                <button onClick={handleImport} disabled={importing || preview.validRows === 0}
                  className="btn btn-primary disabled:opacity-50">
                  {importing
                    ? "Import en cours..."
                    : `Importer ${preview.validRows} appel${preview.validRows > 1 ? "s" : ""}`}
                </button>
                <button onClick={reset} className="btn btn-secondary">Annuler</button>
              </div>
              {preview.validRows === 0 && (
                <p className="text-sm text-amber-600">Aucune ligne valide à importer dans ce fichier.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const CATEGORY_NAME: Record<string, string> = {
  AUTO_ALM: "AUTO ALM", SANTE_ALM: "SANTÉ ALM", AUTO_CPA: "AUTO CPA", SANTE_CPA: "SANTÉ CPA",
};

/** Batches already dispatched in this tab: an effect run twice must never send twice. */
const dispatched = new Set<string>();

/**
 * Dispatches a freshly imported batch to the CRMs, by itself, when "Envois automatiques" is on:
 * one lead per number, owned by the first adviser who took it, each to the link of that
 * adviser's team and product; categories without a link stay in the database.
 */
function AutoDispatch({ batchId }: { batchId: string }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<DispatchSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (dispatched.has(batchId)) return;
    dispatched.add(batchId);
    void (async () => {
      try {
        setSummary(await dispatchAll(`batch:${batchId}`, (done, total) => setProgress({ done, total })));
      } catch (e) {
        setError(errorMessage(e, "Envoi interrompu."));
      }
    })();
  }, [batchId]);

  const review = `/admin/azzur?source=${encodeURIComponent("batch:" + batchId)}`;
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm">
      <p className="font-semibold text-slate-800 mb-1">Envoi automatique vers les CRM</p>
      {!summary && !error && (
        <>
          <p className="text-slate-600 text-xs mb-2">
            Envoi en cours ({progress ? `${progress.done} / ${progress.total}` : "préparation…"}) — ne fermez pas cette page.
          </p>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }} />
          </div>
        </>
      )}
      {error && (
        <p className="text-rose-700 text-xs">
          {error} Les fiches non envoyées peuvent l&apos;être depuis{" "}
          <Link href={review} className="underline">la vérification</Link> (les CRM reconnaissent les doublons).
        </p>
      )}
      {summary && (
        <div className="text-xs text-slate-700 space-y-1">
          <p>
            <b>{summary.sent}</b> fiche(s) envoyée(s) · {summary.duplicates} déjà présente(s) ·{" "}
            <b className={summary.failed ? "text-rose-600" : ""}>{summary.failed}</b> échec(s)
            {summary.keptLocal > 0 && <> · <b className="text-amber-700">{summary.keptLocal}</b> gardée(s) en local (lien non configuré ou équipe inconnue)</>}
          </p>
          {Object.entries(summary.byCategory).map(([k, c]) => (
            <p key={k}>{CATEGORY_NAME[k] ?? k} : {c.sent} envoyée(s){c.duplicates ? `, ${c.duplicates} doublon(s)` : ""}{c.failed ? `, ${c.failed} échec(s)` : ""}</p>
          ))}
          {summary.problems.slice(0, 5).map((p) => (
            <p key={p.reference} className="font-mono text-rose-700 break-all">{CATEGORY_NAME[p.category] ?? p.category} — {p.detail}</p>
          ))}
          <p>
            Les numéros répétés ne sont envoyés qu&apos;une fois, au premier conseiller qui les a reçus.{" "}
            <Link href={review} className="text-brand-600 hover:underline">Voir le détail par lien →</Link>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Exactly where every row of the file goes, to reconcile a figure read in Keyyo with AssurPilot:
 * rows = already in AssurPilot + to import + rejected. "Vue globale" counts by the adviser's
 * TEAM; Keyyo's statistics of a number count by STANDARD LINE — both splits are shown.
 */
function ReconciliationPanel({ r }: { r: Reconciliation }) {
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <p className="font-semibold text-slate-800">Rapprochement avec Keyyo</p>
      <p className="text-xs text-slate-500 mb-3">
        {r.rows} ligne(s) dans le fichier{r.period ? `, du ${r.period.from} au ${r.period.to}` : ""} ={" "}
        <b>{r.alreadyInAssurpilot}</b> déjà dans AssurPilot + <b>{r.toImport}</b> à importer + <b>{r.duplicatedInFile}</b> en double dans le fichier + <b className={r.rejected ? "text-rose-600" : ""}>{r.rejected}</b> rejetée(s).
        {" "}Dont {r.missed} non répondu(s).
      </p>

      {r.rejected > 0 && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <p className="font-semibold mb-1">Lignes rejetées (jamais enregistrées) :</p>
          {r.rejectedByReason.map((x) => <p key={x.label}>{x.count} × {x.label}</p>)}
          {r.unknownLines.length > 0 && (
            <p className="mt-1">
              Numéros appelés inconnus : {r.unknownLines.map((x) => `${x.label} (${x.count})`).join(", ")} — ajoutez la ligne au conseiller
              (Utilisateurs) ou réactivez-le, puis relancez l&apos;analyse.
            </p>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Par équipe du conseiller (= « Vue globale »)</p>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400"><th className="text-left font-medium">Équipe</th><th className="text-right font-medium">Appels</th><th className="text-right font-medium">Déjà là</th><th className="text-right font-medium">Nouveaux</th></tr></thead>
            <tbody>{r.byTeam.map((t) => (
              <tr key={t.team}>
                <td>{t.team}{t.coach ? <span className="text-slate-400"> (dont {t.coach} sur une ligne de coach)</span> : null}</td>
                <td className="text-right font-semibold">{t.total}</td><td className="text-right">{t.already}</td><td className="text-right">{t.fresh}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Par ligne standard d&apos;arrivée (= Keyyo)</p>
          <table className="w-full text-xs">
            <tbody>{r.byLine.map((l) => (
              <tr key={l.label}><td>{l.label}</td><td className="text-right font-semibold">{l.count}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
