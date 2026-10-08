// src/app/api/calls/import/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { badRequest, handleApiError, requireRole } from "@/lib/api";
import { normalizePhone, routeForNumber } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Parsing + inserting a full export can take a while; the Vercel default of 10s
// is not enough for a large workbook.
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = ["xlsx", "xls", "csv"];

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
  if (extension === "csv") {
    // CSV has no type metadata, so SheetJS guesses — and it guesses US order,
    // silently turning the French "10/03/2026" (10 March) into serial 46298
    // (3 October). Day and month swap for every day <= 12, which scatters
    // imported calls across the wrong months.
    //
    // `raw: true` hands back the untouched cell text, so parseDate() can apply
    // the DD/MM/YYYY rule these exports actually use.
    const options: XLSX.ParsingOptions = { type: "buffer", raw: true };
    if (isUtf8(buffer)) options.codepage = 65001;
    return options;
  }

  // Real spreadsheets carry typed date cells, which are unambiguous — let
  // SheetJS materialise them as Date objects.
  return { type: "buffer", cellDates: true, raw: false };
}

/** Anyone a call can land on: a conseiller, or a coach with their own line. */
type CallOwner = {
  id: string;
  nom: string;
  prenom: string;
  phoneNumber: string;
  role: string;
  teamId: string | null;
  team: { nom: string } | null;
};

type ParsedRow = {
  rowIndex: number;
  // COLUMN MAPPING (as per specification):
  //   "Numéro présenté"  → callerNumber (customer phone, the call record's main number)
  //   "Numéro appelé"    → numeroAppele (conseiller phone, which identifies the
  //                         conseiller AND, through them, the call's Équipe)
  //   "Numéro appelant"  → identifies the business line the call arrived on,
  //                         and is kept verbatim in rawMeta
  callerNumber: string;
  numeroAppele: string;
  numeroAppelant: string;
  /** Business line resolved from the routing number, if any. */
  lineId: string | null;
  /** Team INHERITED FROM THE CONSEILLER, not from the line. */
  teamId: string | null;
  teamName: string | null;
  startedAt: Date | null;
  durationSeconds: number;
  isMissed: boolean;
  statut: string;
  destination: string;
  dureeValorisee: number;
  site: string;
  conseiller: CallOwner | null;
  isDuplicate: boolean;
  /** "" = valid, "duplicate" = already imported, anything else = skip reason. */
  error: string;
};

/**
 * Identity of a call for duplicate detection: caller number, exact start time
 * and exact duration must ALL match before a row is skipped.
 *
 * There used to be a 60-second tolerance on the timestamp, which made the
 * number and the duration do all the work: a prospect who rang twice inside a
 * minute, or twice for the same number of seconds — and every missed call is
 * 0 seconds — had the second row silently dropped as a duplicate. Requiring
 * the timestamp to match exactly means a repeat call is a repeat call.
 *
 * Seconds, not milliseconds: `parseDate` builds whole-second timestamps from
 * every format it reads, so a sub-second difference can only come from
 * round-tripping, never from two genuinely different calls.
 *
 * The conseiller is part of the key as a fourth field. Their exports do carry
 * several rows for one number at one timestamp, one per desk the switchboard
 * rang; keying without the adviser would merge those into one and drop the
 * others. It can only ever make the rule skip FEWER rows.
 *
 * The number is normalised so a re-export in another format ("+33687814485"
 * vs "0687814485") still recognises its own rows. With the timestamp and the
 * duration both exact, that cannot collide two different calls.
 */
function duplicateKey(
  conseillerId: string,
  callerNumber: string,
  startedAt: Date,
  duration: number
): string {
  const second = Math.floor(startedAt.getTime() / 1000);
  return `${conseillerId}|${normalizePhone(callerNumber)}|${second}|${duration}`;
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
      // Coaches have their own lines too: a call whose "Numéro appelé" matches
      // a coach must land in that coach's workspace, not be rejected.
      prisma.user.findMany({
        where: { role: { in: ["CONSEILLER", "SUPERVISEUR"] }, isActive: true },
        select: {
          id: true,
          nom: true,
          prenom: true,
          phoneNumber: true,
          role: true,
          // The adviser's team IS the call's Équipe — this is the whole
          // mapping: adviser phone number -> adviser -> team -> entity.
          teamId: true,
          team: { select: { nom: true } },
        },
      }),
      prisma.phoneLine.findMany({ where: { isActive: true } }),
    ]);

    const conseillerByPhone = new Map<string, CallOwner>();
    for (const conseiller of conseillers) {
      const normalized = normalizePhone(conseiller.phoneNumber);
      if (normalized) conseillerByPhone.set(normalized, conseiller);
    }

    // Business lines indexed by normalised number. This identifies WHICH TRUNK
    // a row arrived on — for the "Ligne" column — and nothing more. The call's
    // Équipe comes from the conseiller who took it (see below), because CPA and
    // ALM share the standard numbers and the trunk therefore says nothing about
    // which entity owns the call.
    const lineByPhone = new Map<string, { id: string; teamId: string | null; label: string }>();
    for (const line of phoneLines) {
      const normalized = normalizePhone(line.numeroMasque);
      if (normalized && !lineByPhone.has(normalized)) {
        lineByPhone.set(normalized, { id: line.id, teamId: line.teamId, label: line.label });
      }
    }
    const defaultLineId = phoneLines[0]?.id ?? "";

    /**
     * Resolve the business line a row came in on. "Numéro appelant" is the
     * operator's routing column; "Numéro appelé" is the historical fallback so
     * files produced before that rule still identify their line.
     *
     * This no longer decides the Équipe. A present-but-unknown routing number
     * still refuses to fall back to the conseiller line, so the "Ligne" column
     * stays honest about which trunk was used.
     */
    function resolveLine(appelant: string, appele: string) {
      const primary = normalizePhone(appelant);
      const candidates = primary ? [primary] : [normalizePhone(appele)];

      for (const normalized of candidates) {
        if (!normalized) continue;

        const line = lineByPhone.get(normalized);
        const staticRoute = routeForNumber(normalized);

        if (line || staticRoute) {
          return {
            lineId: line?.id ?? null,
            lineLabel: line?.label ?? staticRoute?.label ?? null,
            matchedOn: primary ? "Numéro appelant" : "Numéro appelé",
          };
        }
      }
      return { lineId: null, lineLabel: null, matchedOn: null };
    }

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

      // The line says which trunk the call came in on. The Équipe comes from
      // the conseiller it reached, so an adviser's calls stay in their own
      // entity whichever standard number the customer dialled.
      const line = resolveLine(numeroAppelant, numeroAppele);

      let error = "";
      if (!callerNumber) error = "Numéro présenté manquant";
      else if (!startedAt) error = "Date invalide ou manquante";
      else if (!numeroAppele) error = "Numéro appelé manquant";
      else if (!conseiller) error = `Aucun utilisateur avec le numéro ${numeroAppele}`;

      return {
        rowIndex: index + 2, // +2 = 1-based row numbering plus the header row
        callerNumber,
        numeroAppele,
        numeroAppelant,
        lineId: line.lineId,
        teamId: conseiller?.teamId ?? null,
        teamName: conseiller?.team?.nom ?? null,
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
    // A row is skipped only when caller number, exact timestamp and exact
    // duration all match a call already in the database (see `duplicateKey`).
    // Two calls from the same number at different times, or at the same time
    // with different durations, are different calls and both import.
    //
    // Fetch every candidate in ONE query instead of one per row: a per-row
    // findFirst is what makes large imports time out on a serverless function.
    const candidates = parsed.filter((row) => !row.error && row.conseiller && row.startedAt);

    if (candidates.length) {
      const timestamps = candidates.map((row) => row.startedAt!.getTime());
      const conseillerIds = [...new Set(candidates.map((row) => row.conseiller!.id))];

      const existing = await prisma.call.findMany({
        where: {
          assignedUserId: { in: conseillerIds },
          // Exactly the span the file covers. The window used to be padded by a
          // minute on each side to feed the old fuzzy match; with exact
          // timestamps nothing outside the span can possibly match.
          startedAt: {
            gte: new Date(Math.min(...timestamps)),
            lte: new Date(Math.max(...timestamps)),
          },
        },
        select: {
          assignedUserId: true,
          callerNumber: true,
          durationSeconds: true,
          startedAt: true,
        },
      });

      const seen = new Set<string>();

      for (const call of existing) {
        if (!call.assignedUserId) continue;
        seen.add(
          duplicateKey(
            call.assignedUserId,
            call.callerNumber,
            call.startedAt,
            call.durationSeconds
          )
        );
      }

      for (const row of candidates) {
        const key = duplicateKey(
          row.conseiller!.id,
          row.callerNumber,
          row.startedAt!,
          row.durationSeconds
        );

        if (seen.has(key)) {
          row.isDuplicate = true;
          row.error = "duplicate";
        } else {
          // Also catches rows duplicated inside the uploaded file itself.
          seen.add(key);
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
          destinataireRole: row.conseiller?.role ?? null,
          numeroAppelant: row.numeroAppelant,
          equipe: row.teamName,
          isDuplicate: row.isDuplicate,
          // "duplicate" is a status, not an error message to show the user.
          error: row.error === "duplicate" ? "" : row.error,
        })),
        unmatchedNumbers: [
          ...new Set(
            invalidRows
              .filter((row) => row.error.includes("utilisateur"))
              .map((row) => row.numeroAppele)
          ),
        ],
        // Rows that will import but land without an Équipe — now always
        // because the adviser they matched has no team on their profile, which
        // is what keeps their calls out of every entity workspace.
        advisersWithoutTeam: [
          ...new Set(
            parsed
              .filter((row) => !row.error && row.conseiller && !row.teamId)
              .map((row) => `${row.conseiller!.prenom} ${row.conseiller!.nom}`)
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
      const startedAt = row.startedAt!;
      return {
        // The line records which trunk the call arrived on; the team comes
        // from the conseiller, so the entity follows the adviser.
        phoneLineId: row.lineId ?? defaultLineId,
        teamId: row.teamId,
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
