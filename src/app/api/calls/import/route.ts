// src/app/api/calls/import/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, requireRole } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Parsing + inserting a full export can take a while; the Vercel default of 10s
// is not enough for a large workbook.
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = ["xlsx", "xls", "csv"];
/** Two calls are the same event if they match on key fields within this window. */
const DUPLICATE_WINDOW_MS = 60_000;

/** Normalize phone: digits only, strip French country prefix → 0XXXXXXXXX */
function normalizePhone(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("0033") && digits.length === 13) return "0" + digits.slice(4);
  if (digits.startsWith("33") && digits.length === 11) return "0" + digits.slice(2);
  // Spreadsheets store phone columns as numbers and silently drop the leading
  // zero, so "0988288362" arrives as 988288362. Restore it.
  if (digits.length === 9 && digits[0] !== "0") return "0" + digits;
  return digits;
}

/** Parse date: DD/MM/YYYY HH:MM:SS, ISO, or Excel serial. */
function parseDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  if (typeof raw === "number") {
    const parts = XLSX.SSF.parse_date_code(raw);
    if (parts) return new Date(parts.y, parts.m - 1, parts.d, parts.H, parts.M, parts.S);
  }

  const text = String(raw).trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return new Date(+match[3], +match[2] - 1, +match[1], +match[4], +match[5], +(match[6] || 0));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type SheetRow = Record<string, unknown>;
/** A row indexed by normalised header name. */
type IndexedRow = Map<string, unknown>;

/**
 * Collapses a header to a comparison key: accents stripped, lower-cased, and
 * every separator removed. "Numéro appelé", "numero_appele" and "NumeroAppele"
 * all become "numeroappele", so a column matches whatever casing, accents or
 * separators the export happens to use.
 */
function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function indexRow(row: SheetRow): IndexedRow {
  const indexed: IndexedRow = new Map();
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeKey(key);
    if (normalized && !indexed.has(normalized)) indexed.set(normalized, value);
  }
  return indexed;
}

/** Read the raw cell value of the first matching column alias. */
function cell(row: IndexedRow, ...names: string[]): unknown {
  for (const name of names) {
    const value = row.get(normalizeKey(name));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** Read a column by any of several alias names, as a trimmed string. */
function col(row: IndexedRow, ...names: string[]): string {
  const value = cell(row, ...names);
  return value === undefined ? "" : String(value).trim();
}

/**
 * SheetJS decodes CSV as Windows-1252 unless told otherwise, which turns
 * "Numéro présenté" into "NumÃ©ro prÃ©sentÃ©" and makes every accented column
 * unmatchable. Detect real UTF-8 and decode it as such, while still letting
 * genuinely Latin-1 exports (what older French tooling produces) work.
 */
function isUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function parsingOptions(buffer: Buffer, extension: string): XLSX.ParsingOptions {
  const options: XLSX.ParsingOptions = {
    type: "buffer",
    cellDates: extension !== "csv",
    raw: false,
  };
  if (extension === "csv" && isUtf8(buffer)) options.codepage = 65001;
  return options;
}

type Conseiller = { id: string; nom: string; prenom: string; phoneNumber: string };

type ParsedRow = {
  rowIndex: number;
  // COLUMN MAPPING (as per specification):
  //   "Numéro présenté"  → callerNumber (customer phone, the call record's main number)
  //   "Numéro appelé"    → numeroAppele (conseiller phone, used to identify the conseiller)
  //   "Numéro appelant"  → stored in rawMeta only (raw originating number)
  callerNumber: string;
  numeroAppele: string;
  numeroAppelant: string;
  startedAt: Date | null;
  durationSeconds: number;
  isMissed: boolean;
  statut: string;
  destination: string;
  dureeValorisee: number;
  site: string;
  conseiller: Conseiller | null;
  isDuplicate: boolean;
  /** "" = valid, "duplicate" = already imported, anything else = skip reason. */
  error: string;
};

/** Key used to bucket calls that could be duplicates of one another. */
function duplicateKey(conseillerId: string, callerNumber: string, duration: number): string {
  return `${conseillerId}|${callerNumber}|${duration}`;
}

export async function POST(req: NextRequest) {
  try {
    const sessionUser = await requireRole("ADMINISTRATEUR");

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw badRequest("Requête invalide : un envoi multipart/form-data est attendu");
    }

    const file = formData.get("file");
    const preview = formData.get("preview") === "true";

    if (!file || typeof file === "string") throw badRequest("Aucun fichier fourni");
    if (file.size === 0) throw badRequest("Le fichier est vide.");
    if (file.size > MAX_FILE_BYTES) {
      throw badRequest(`Fichier trop volumineux (maximum ${MAX_FILE_BYTES / 1024 / 1024} Mo)`);
    }

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      throw badRequest(`Format non supporté. Formats acceptés : ${ALLOWED_EXTENSIONS.join(", ")}`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, parsingOptions(buffer, extension));
    } catch {
      throw badRequest(
        "Impossible de lire le fichier. Vérifiez qu'il s'agit d'un fichier Excel ou CSV valide."
      );
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) throw badRequest("Le fichier ne contient aucune feuille de calcul.");

    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: "" });
    if (!rows.length) throw badRequest("Le fichier est vide.");

    // ── Reference data ────────────────────────────────────────────────────────
    const [conseillers, phoneLines] = await Promise.all([
      prisma.user.findMany({
        where: { role: "CONSEILLER", isActive: true },
        select: { id: true, nom: true, prenom: true, phoneNumber: true },
      }),
      prisma.phoneLine.findMany({ where: { isActive: true } }),
    ]);

    const conseillerByPhone = new Map<string, Conseiller>();
    for (const conseiller of conseillers) {
      const normalized = normalizePhone(conseiller.phoneNumber);
      if (normalized) conseillerByPhone.set(normalized, conseiller);
    }

    const lineIdByPhone = new Map<string, string>();
    for (const line of phoneLines) {
      const normalized = normalizePhone(line.numeroMasque);
      if (normalized && !lineIdByPhone.has(normalized)) lineIdByPhone.set(normalized, line.id);
    }
    const defaultLineId = phoneLines[0]?.id ?? "";

    // ── Parse ─────────────────────────────────────────────────────────────────
    const parsed: ParsedRow[] = rows.map((sheetRow, index) => {
      // Header matching is accent/case/separator insensitive (see normalizeKey),
      // so each alias below only needs to cover a genuinely different wording.
      const row = indexRow(sheetRow);

      // Customer phone: "Numéro présenté".
      const callerNumber = col(row, "Numéro présenté", "numero_presente");
      // Conseiller phone: "Numéro appelé" (the internal line that received the call).
      const numeroAppele = col(row, "Numéro appelé", "numero_appele");
      // Raw originating number (stored in metadata only).
      const numeroAppelant = col(row, "Numéro appelant", "numero_appelant");

      const dureeReelle = col(row, "Durée réelle (s)", "Durée réelle", "Duration");
      const dureeValorisee = col(row, "Durée valorisée (s)", "Durée valorisée");
      const destination = col(row, "Destination");
      const site = col(row, "Site");

      // Read the raw cell for the date: Excel serials must not be stringified.
      const rawDate = cell(row, "Début d'appel", "Date", "Début");
      const startedAt = parseDate(rawDate);
      const durationSeconds = parseInt(dureeReelle, 10) || 0;
      const isMissed = durationSeconds === 0;

      const normalizedAppele = normalizePhone(numeroAppele);
      const conseiller = normalizedAppele ? conseillerByPhone.get(normalizedAppele) ?? null : null;

      let error = "";
      if (!callerNumber) error = "Numéro présenté manquant";
      else if (!startedAt) error = "Date invalide ou manquante";
      else if (!numeroAppele) error = "Numéro appelé manquant";
      else if (!conseiller) error = `Aucun conseiller avec le numéro ${numeroAppele}`;

      return {
        rowIndex: index + 2, // +2 = 1-based row numbering plus the header row
        callerNumber,
        numeroAppele,
        numeroAppelant,
        startedAt,
        durationSeconds,
        isMissed,
        statut: isMissed ? "MANQUE" : "REPONDU",
        destination,
        dureeValorisee: parseInt(dureeValorisee, 10) || 0,
        site,
        conseiller,
        isDuplicate: false,
        error,
      };
    });

    // ── Duplicate detection ───────────────────────────────────────────────────
    // Fetch every candidate in ONE query instead of one per row: a per-row
    // findFirst is what makes large imports time out on a serverless function.
    const candidates = parsed.filter((row) => !row.error && row.conseiller && row.startedAt);

    if (candidates.length) {
      const timestamps = candidates.map((row) => row.startedAt!.getTime());
      const conseillerIds = [...new Set(candidates.map((row) => row.conseiller!.id))];

      const existing = await prisma.call.findMany({
        where: {
          assignedUserId: { in: conseillerIds },
          startedAt: {
            gte: new Date(Math.min(...timestamps) - DUPLICATE_WINDOW_MS),
            lte: new Date(Math.max(...timestamps) + DUPLICATE_WINDOW_MS),
          },
        },
        select: {
          assignedUserId: true,
          callerNumber: true,
          durationSeconds: true,
          startedAt: true,
        },
      });

      const seen = new Map<string, number[]>();
      const remember = (key: string, time: number) => {
        const times = seen.get(key);
        if (times) times.push(time);
        else seen.set(key, [time]);
      };

      for (const call of existing) {
        if (!call.assignedUserId) continue;
        remember(
          duplicateKey(call.assignedUserId, call.callerNumber, call.durationSeconds),
          call.startedAt.getTime()
        );
      }

      for (const row of candidates) {
        const key = duplicateKey(row.conseiller!.id, row.callerNumber, row.durationSeconds);
        const time = row.startedAt!.getTime();
        const near = seen
          .get(key)
          ?.some((known) => Math.abs(known - time) <= DUPLICATE_WINDOW_MS);

        if (near) {
          row.isDuplicate = true;
          row.error = "duplicate";
        } else {
          // Also catches rows duplicated inside the uploaded file itself.
          remember(key, time);
        }
      }
    }

    const validRows = parsed.filter((row) => !row.error);
    const invalidRows = parsed.filter((row) => row.error && row.error !== "duplicate");
    const duplicateRows = parsed.filter((row) => row.error === "duplicate");

    // ── Preview mode ──────────────────────────────────────────────────────────
    if (preview) {
      return NextResponse.json({
        totalRows: parsed.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        duplicateRows: duplicateRows.length,
        preview: parsed.slice(0, 100).map((row) => ({
          rowIndex: row.rowIndex,
          callerNumber: row.callerNumber,
          numeroAppele: row.numeroAppele,
          startedAt: row.startedAt?.toISOString() ?? null,
          durationSeconds: row.durationSeconds,
          statut: row.statut,
          conseiller: row.conseiller ? `${row.conseiller.prenom} ${row.conseiller.nom}` : null,
          isDuplicate: row.isDuplicate,
          // "duplicate" is a status, not an error message to show the user.
          error: row.error === "duplicate" ? "" : row.error,
        })),
        unmatchedNumbers: [
          ...new Set(
            invalidRows
              .filter((row) => row.error.includes("conseiller"))
              .map((row) => row.numeroAppele)
          ),
        ],
      });
    }

    // ── Import mode ───────────────────────────────────────────────────────────
    if (!validRows.length) throw badRequest("Aucune ligne valide à importer.");
    if (!defaultLineId) throw badRequest("Aucune ligne téléphonique active n'est configurée.");

    const batch = await prisma.importBatch.create({
      data: {
        fileName: file.name,
        totalRows: parsed.length,
        importedRows: 0,
        skippedRows: invalidRows.length + duplicateRows.length,
        createdBy: sessionUser.userId,
      },
    });

    const callsToCreate: Prisma.CallCreateManyInput[] = validRows.map((row) => {
      const normalizedAppele = normalizePhone(row.numeroAppele);
      const startedAt = row.startedAt!;
      return {
        phoneLineId: lineIdByPhone.get(normalizedAppele) ?? defaultLineId,
        assignedUserId: row.conseiller!.id,
        callerNumber: row.callerNumber,
        isManual: true,
        isMissed: row.isMissed,
        durationSeconds: row.durationSeconds,
        startedAt,
        endedAt: row.isMissed
          ? null
          : new Date(startedAt.getTime() + row.durationSeconds * 1000),
        statut: row.statut,
        importBatchId: batch.id,
        rawMeta: JSON.stringify({
          numeroAppelant: row.numeroAppelant,
          destination: row.destination,
          dureeValorisee: row.dureeValorisee,
          site: row.site,
        }),
      };
    });

    // One bulk insert instead of N round-trips.
    const { count: importedRows } = await prisma.call.createMany({ data: callsToCreate });

    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { importedRows },
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      totalRows: parsed.length,
      importedRows,
      duplicateRows: duplicateRows.length,
      skippedRows: invalidRows.length,
      errors: invalidRows.map((row) => ({
        row: row.rowIndex,
        numero: row.numeroAppele,
        error: row.error,
      })),
    });
  } catch (error) {
    return handleApiError(error, "POST /api/calls/import");
  }
}
