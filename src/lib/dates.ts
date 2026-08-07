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
export function buildDateRange(searchParams: URLSearchParams): DateRange | undefined {
  const period = searchParams.get("period");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

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
