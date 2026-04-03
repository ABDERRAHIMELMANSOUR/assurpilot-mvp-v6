"use client";
import { useState, useRef } from "react";
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

type PreviewResult = {
  totalRows:     number;
  validRows:     number;
  invalidRows:   number;
  duplicateRows: number;
  preview:       PreviewRow[];
  unmatchedNumbers: string[];
};

type ImportResult = {
  success:       boolean;
  batchId:       string;
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
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
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
          <h1 className="text-xl font-semibold text-gray-900">Import d'appels</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Importez un fichier Excel ou CSV exporté depuis Keyyo ou votre opérateur VoIP
          </p>
        </div>
      </div>

      {/* Success */}
      {result && (
        <div className="mb-6 card p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Import terminé</h2>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold text-gray-900">{result.totalRows}</p>
                  <p className="text-xs text-gray-500">Lignes totales</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold text-green-700">{result.importedRows}</p>
                  <p className="text-xs text-green-600">Importées</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold text-amber-700">{result.duplicateRows}</p>
                  <p className="text-xs text-amber-600">Doublons ignorés</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-semibold text-red-700">{result.skippedRows}</p>
                  <p className="text-xs text-red-600">Invalides ignorées</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Lignes invalides ({result.errors.length})
                  </p>
                  <div className="bg-red-50 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-xs text-red-700">
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
              dragging         ? "border-blue-400 bg-blue-50 border-2" :
              file && validExt ? "border-green-300 bg-green-50 border-2" :
              "border-dashed border-gray-300 hover:border-blue-300 hover:bg-blue-50/30"
            }`}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} Ko · cliquez pour changer</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Glissez votre fichier ici</p>
                  <p className="text-xs text-gray-400 mt-0.5">ou cliquez pour parcourir</p>
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
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
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
                  <span className={`font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${r.highlight ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-700"}`}>
                    {r.col}
                  </span>
                  <span className="text-gray-500">{r.role}</span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
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
                  <p className="text-2xl font-semibold text-gray-900">{preview.totalRows}</p>
                  <p className="text-xs text-gray-500 mt-1">Lignes totales</p>
                </div>
                <div className="stat-card text-center">
                  <p className="text-2xl font-semibold text-green-600">{preview.validRows}</p>
                  <p className="text-xs text-green-600 mt-1">Lignes valides</p>
                </div>
                <div className="stat-card text-center">
                  <p className="text-2xl font-semibold text-amber-600">{preview.duplicateRows}</p>
                  <p className="text-xs text-amber-600 mt-1">Doublons</p>
                </div>
                <div className="stat-card text-center">
                  <p className="text-2xl font-semibold text-red-500">{preview.invalidRows}</p>
                  <p className="text-xs text-red-500 mt-1">Invalides</p>
                </div>
              </div>

              {/* Unmatched numbers warning */}
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

              {/* Preview table */}
              <div className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">
                    Aperçu ({Math.min(preview.preview.length, 100)} lignes)
                  </p>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Valide</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Doublon</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Invalide</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
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
                    <tbody className="divide-y divide-gray-50">
                      {preview.preview.map((row) => {
                        const rowClass =
                          row.isDuplicate ? "bg-amber-50/60" :
                          row.error       ? "bg-red-50/50"   :
                          "hover:bg-gray-50";
                        return (
                          <tr key={row.rowIndex} className={`transition-colors ${rowClass}`}>
                            <td className="table-td text-xs text-gray-400">{row.rowIndex}</td>
                            <td className="table-td font-mono text-sm text-gray-800">
                              {row.callerNumber || "—"}
                            </td>
                            <td className="table-td font-mono text-xs text-gray-500">
                              {row.numeroAppele || "—"}
                            </td>
                            <td className="table-td text-sm">
                              {row.conseiller
                                ? <span className="text-gray-900">{row.conseiller}</span>
                                : <span className="text-red-500 text-xs font-medium">Non trouvé</span>}
                            </td>
                            <td className="table-td text-xs text-gray-500 whitespace-nowrap">
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
                                <span className="text-xs text-red-600">{row.error}</span>
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
