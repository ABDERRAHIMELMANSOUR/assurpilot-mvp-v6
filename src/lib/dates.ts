// src/lib/dates.ts
import { badRequest } from "@/lib/api";

export type DateRange = { gte?: Date; lte?: Date };

function parseIsoDate(raw: string, label: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw badRequest(`Date ${label} invalide`);
  return date;
}

/**
 * Builds a Prisma date filter from `?period=today|week|month` or an explicit
 * `?dateFrom=&dateTo=` pair. Returns `undefined` when no filter was requested.
 */
export function buildDateRange(
  searchParams: URLSearchParams,
  options: { defaultPeriod?: "today" | "week" | "month" } = {}
): DateRange | undefined {
  let period = searchParams.get("period");
  // `startDate`/`endDate` are accepted as aliases: the export links and the
  // dashboards were built against both spellings, and a silently ignored
  // parameter would hand back an unfiltered workbook.
  const dateFrom = searchParams.get("dateFrom") ?? searchParams.get("startDate");
  const dateTo = searchParams.get("dateTo") ?? searchParams.get("endDate");

  // No range asked for at all: fall back to the caller's default period, if any.
  // An explicit period or either date always wins.
  if (!period && !dateFrom && !dateTo && options.defaultPeriod) period = options.defaultPeriod;

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (period) {
    const now = new Date();
    startDate = new Date(now);
    endDate = new Date(now);

    // The end of a period is the end of its last DAY, never "right now".
    // Clamping to `now` silently hid every call timestamped later in the day —
    // so "Aujourd'hui" could report zero while calls for today existed, and
    // imported rows whose times run ahead of the server clock disappeared.
    switch (period) {
      case "today":
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case "week":
        startDate.setDate(startDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case "month":
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        // Last instant of the current month: day 0 of next month.
        endDate.setMonth(endDate.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      default:
        throw badRequest(`Période inconnue : ${period}`);
    }
  } else {
    if (dateFrom) startDate = parseIsoDate(dateFrom, "de début");
    if (dateTo) {
      endDate = parseIsoDate(dateTo, "de fin");
      endDate.setHours(23, 59, 59, 999);
    }
  }

  if (!startDate && !endDate) return undefined;

  const range: DateRange = {};
  if (startDate) range.gte = startDate;
  if (endDate) range.lte = endDate;
  return range;
}

/**
 * The period a role's views start on when the request names none. Coaches
 * review their team over the whole current month; everyone else keeps the
 * unbounded default (still capped by the role's history floor).
 */
export function defaultPeriodFor(role: string | null | undefined): "month" | undefined {
  return role === "SUPERVISEUR" ? "month" : undefined;
}
