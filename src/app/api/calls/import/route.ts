// src/app/api/calls/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

// Normalize phone: digits only, strip French country prefix → 0XXXXXXXXX
function normalizePhone(raw: string | number): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("0033") && digits.length === 13) return "0" + digits.slice(4);
  if (digits.startsWith("33")   && digits.length === 11) return "0" + digits.slice(2);
  return digits;
}

// Parse date: DD/MM/YYYY HH:MM:SS, ISO, or Excel serial
function parseDate(raw: any): Date | null {
  if (!raw) return null;
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return new Date(d.y, d.m - 1, d.d, d.H, d.M, d.S);
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +(m[6]||0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Read a column by any of several alias names
function col(row: any, ...names: string[]): string {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== "") return String(row[n]).trim();
  }
  return "";
}

// Check if a call with same conseiller + date + duration + caller already exists
async function isDuplicate(
  conseillerId: string,
  startedAt: Date,
  durationSeconds: number,
  callerNumber: string
): Promise<boolean> {
  // Allow ±60 seconds window to handle rounding/export differences
  const from = new Date(startedAt.getTime() - 60_000);
  const to   = new Date(startedAt.getTime() + 60_000);

  const existing = await prisma.call.findFirst({
    where: {
      assignedUserId:  conseillerId,
      callerNumber,
      durationSeconds,
      startedAt: { gte: from, lte: to },
    },
  });
  return existing !== null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const sessionUser = session.user as any;
  if (sessionUser.role !== "ADMINISTRATEUR") {
    return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });
  }

  const formData = await req.formData();
  const file     = formData.get("file") as File | null;
  const preview  = formData.get("preview") === "true";

  if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext    = file.name.split(".").pop()?.toLowerCase();

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: ext !== "csv",
      raw: false,
    });
  } catch {
    return NextResponse.json({
      error: "Impossible de lire le fichier. Vérifiez qu'il s'agit d'un fichier Excel ou CSV valide.",
    }, { status: 400 });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (!rows.length) return NextResponse.json({ error: "Le fichier est vide." }, { status: 400 });

  // Load conseillers keyed by normalized phone number
  const conseillers = await prisma.user.findMany({
    where: { role: "CONSEILLER", isActive: true },
    select: { id: true, nom: true, prenom: true, phoneNumber: true },
  });
  const conseillerByPhone = new Map<string, typeof conseillers[0]>();
  for (const c of conseillers) {
    const norm = normalizePhone(c.phoneNumber);
    if (norm) conseillerByPhone.set(norm, c);
  }

  // Load phone lines — match by full number stored in numeroMasque
  const phoneLines = await prisma.phoneLine.findMany({ where: { isActive: true } });
  const defaultLine = phoneLines[0];

  type ParsedRow = {
    rowIndex:        number;
    // COLUMN MAPPING (as per specification):
    //   "Numéro présenté"  → callerNumber (customer phone, the call record's main number)
    //   "Numéro appelé"    → numeroAppele (conseiller phone, used to identify the conseiller)
    //   "Numéro appelant"  → stored in rawMeta only (raw originating number)
    callerNumber:    string; // from "Numéro présenté"
    numeroAppele:    string; // from "Numéro appelé" → conseiller identification
    numeroAppelant:  string; // from "Numéro appelant" → rawMeta only
    startedAt:       Date | null;
    durationSeconds: number;
    isMissed:        boolean;
    statut:          string;
    destination:     string;
    dureeValorisee:  number;
    site:            string;
    conseiller:      typeof conseillers[0] | null;
    isDuplicate:     boolean;
    error:           string; // "" = valid, non-empty = skip reason
  };

  const parsed: ParsedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // ── COLUMN READS ───────────────────────────────────────────────────────────
    // Customer phone: "Numéro présenté" (the number shown to the customer / the business line number that called them back)
    const callerNumber   = col(row, "Numéro présenté", "Numéro Présenté", "numero_presente", "NumeroPresente");
    // Conseiller phone: "Numéro appelé" (the internal line that received/made the call)
    const numeroAppele   = col(row, "Numéro appelé", "Numéro Appelé", "numero_appele", "NumeroAppele");
    // Raw originating number (stored in metadata only)
    const numeroAppelant = col(row, "Numéro appelant", "Numéro Appelant", "numero_appelant", "NumeroAppelant");

    const dureeReelle    = col(row, "Durée réelle (s)", "Durée réelle", "duree_reelle", "DureeReelle", "Duration");
    const dureeValorisee = col(row, "Durée valorisée (s)", "Durée valorisée", "duree_valorisee");
    const destination    = col(row, "Destination", "destination");
    const site           = col(row, "Site", "site");

    // Parse date from raw cell value (not via col() — need the actual cell for Excel serial handling)
    const rawDate  = row["Début d'appel"] ?? row["Debut d'appel"] ?? row["Date"] ?? row["Début"] ?? "";
    const startedAt = parseDate(rawDate);
    const dur       = parseInt(dureeReelle, 10) || 0;
    const isMissed  = dur === 0;
    const statut    = isMissed ? "MANQUE" : "REPONDU";

    // Identify conseiller by "Numéro appelé"
    const normAppele  = normalizePhone(numeroAppele);
    const conseiller  = normAppele ? (conseillerByPhone.get(normAppele) ?? null) : null;

    // Validate
    let error = "";
    if (!callerNumber)   error = "Numéro présenté manquant";
    else if (!startedAt) error = "Date invalide ou manquante";
    else if (!numeroAppele) error = "Numéro appelé manquant";
    else if (!conseiller)   error = `Aucun conseiller avec le numéro ${numeroAppele}`;

    parsed.push({
      rowIndex:       i + 2,
      callerNumber,
      numeroAppele,
      numeroAppelant,
      startedAt,
      durationSeconds: dur,
      isMissed, statut,
      destination,
      dureeValorisee: parseInt(dureeValorisee, 10) || 0,
      site,
      conseiller,
      isDuplicate: false, // filled in below
      error,
    });
  }

  // ── DUPLICATE DETECTION ───────────────────────────────────────────────────────
  // Check DB for existing calls with same key fields (only for rows that are otherwise valid)
  for (const r of parsed) {
    if (r.error || !r.conseiller || !r.startedAt) continue;
    r.isDuplicate = await isDuplicate(
      r.conseiller.id,
      r.startedAt,
      r.durationSeconds,
      r.callerNumber
    );
    if (r.isDuplicate) r.error = "duplicate";
  }

  const validRows     = parsed.filter((r) => !r.error);
  const invalidRows   = parsed.filter((r) => r.error && r.error !== "duplicate");
  const duplicateRows = parsed.filter((r) => r.error === "duplicate");

  // ── PREVIEW MODE ──────────────────────────────────────────────────────────────
  if (preview) {
    return NextResponse.json({
      totalRows:     parsed.length,
      validRows:     validRows.length,
      invalidRows:   invalidRows.length,
      duplicateRows: duplicateRows.length,
      preview: parsed.slice(0, 100).map((r) => ({
        rowIndex:        r.rowIndex,
        callerNumber:    r.callerNumber,      // "Numéro présenté" → customer phone
        numeroAppele:    r.numeroAppele,      // conseiller phone
        startedAt:       r.startedAt?.toISOString() ?? null,
        durationSeconds: r.durationSeconds,
        statut:          r.statut,
        conseiller:      r.conseiller ? `${r.conseiller.prenom} ${r.conseiller.nom}` : null,
        isDuplicate:     r.isDuplicate,
        error:           r.error === "duplicate" ? "" : r.error, // don't show "duplicate" as error text
      })),
      unmatchedNumbers: [
        ...new Set(
          invalidRows
            .filter((r) => r.error.includes("conseiller"))
            .map((r) => r.numeroAppele)
        ),
      ],
    });
  }

  // ── IMPORT MODE ───────────────────────────────────────────────────────────────
  if (!validRows.length) {
    return NextResponse.json({ error: "Aucune ligne valide à importer." }, { status: 400 });
  }

  const batch = await prisma.importBatch.create({
    data: {
      fileName:     file.name,
      totalRows:    parsed.length,
      importedRows: validRows.length,
      skippedRows:  invalidRows.length + duplicateRows.length,
      createdBy:    sessionUser.userId ?? "",
    },
  });

  let importedCount = 0;
  for (const r of validRows) {
    if (!r.startedAt || !r.conseiller) continue;

    // Find phone line: match by "Numéro appelé" (the conseiller's line) against phoneLines
    let lineId = defaultLine?.id ?? "";
    const normAppele = normalizePhone(r.numeroAppele);
    for (const l of phoneLines) {
      if (normalizePhone(l.numeroMasque) === normAppele) { lineId = l.id; break; }
    }
    if (!lineId) continue;

    const rawMeta = JSON.stringify({
      numeroAppelant:  r.numeroAppelant,  // raw originating number
      destination:     r.destination,
      dureeValorisee:  r.dureeValorisee,
      site:            r.site,
    });

    await prisma.call.create({
      data: {
        phoneLineId:     lineId,
        assignedUserId:  r.conseiller.id,
        callerNumber:    r.callerNumber,   // "Numéro présenté" as the customer phone
        isManual:        true,
        isMissed:        r.isMissed,
        durationSeconds: r.durationSeconds,
        startedAt:       r.startedAt,
        endedAt:         r.isMissed ? null : new Date(r.startedAt.getTime() + r.durationSeconds * 1000),
        statut:          r.statut,
        importBatchId:   batch.id,
        rawMeta,
      },
    });
    importedCount++;
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { importedRows: importedCount },
  });

  return NextResponse.json({
    success:       true,
    batchId:       batch.id,
    totalRows:     parsed.length,
    importedRows:  importedCount,
    duplicateRows: duplicateRows.length,
    skippedRows:   invalidRows.length,
    errors: invalidRows.map((r) => ({ row: r.rowIndex, numero: r.numeroAppele, error: r.error })),
  });
}
