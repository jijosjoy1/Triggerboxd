/**
 * Owner-dashboard query bounds. Kept dependency-free so it can be unit tested
 * directly, and validated before any session or database work happens.
 */
export type AdminPaging = { ok: true; limit: number; offset: number } | { ok: false };

export const ADMIN_PAGE_LIMIT = 10;
export const ADMIN_MAX_LIMIT = 25;
export const ADMIN_MAX_OFFSET = 5000;

function parseBound(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null) return fallback;
  if (!/^[0-9]{1,4}$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

export function parseAdminPaging(limit: string | null, offset: string | null): AdminPaging {
  const parsedLimit = parseBound(limit, ADMIN_PAGE_LIMIT, 1, ADMIN_MAX_LIMIT);
  const parsedOffset = parseBound(offset, 0, 0, ADMIN_MAX_OFFSET);
  if (parsedLimit === null || parsedOffset === null) return { ok: false };
  return { ok: true, limit: parsedLimit, offset: parsedOffset };
}

export function adminHasMore(totals: { accounts: { total: number }; films: { total: number }; assessments: { total: number } }, offset: number, limit: number): boolean {
  const nextOffset = offset + limit;
  return nextOffset <= ADMIN_MAX_OFFSET && [totals.accounts.total, totals.films.total, totals.assessments.total].some(total => total > nextOffset);
}
