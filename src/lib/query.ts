// src/lib/query.ts
//
// Small helpers for composing the query strings the dashboards send to
// /api/calls. Kept out of the page files: Next.js only accepts a fixed set of
// exports from a page module, so a stray helper there breaks `next build`.

/** Sets one parameter on a query string that may be empty or start with "?". */
export function withParam(query: string, key: string, value: string): string {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  if (value) params.set(key, value);
  else params.delete(key);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Adds `group=1` to a query string that may be empty or start with "?". */
export function withGroup(query: string, grouped: boolean): string {
  return grouped ? withParam(query, "group", "1") : query;
}
