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
    endDate = new Date(now);
    startDate = new Date(now);

    switch (period) {
      case "today":
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "month":
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
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
