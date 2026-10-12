import { CATEGORY_SLUGS, type ApiErrorCode, type CategoryRating, type CategorySlug,
  type DeleteContributionInput, type ImportMovieInput, type PutContributionInput, type Severity } from './contracts';

export const MAX_JSON_BODY_BYTES = 8 * 1024;

export class ValidationError extends Error {
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string>;
  constructor(field: string, message: string, code: ApiErrorCode = 'INVALID_REQUEST') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.fields = { [field]: message };
  }
}

function object(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('body', 'Expected a JSON object.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(record, key))) {
    throw new ValidationError('body', 'Only the documented fields are accepted.');
  }
  return record;
}

function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ValidationError(field, 'Expected an integer within the allowed range.');
  }
  return value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

export function parseMovieId(value: unknown): string {
  if (!isUuid(value)) throw new ValidationError('movieId', 'Expected a movie UUID.');
  return value;
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || /[^A-Za-z0-9_-]/u.test(value)) {
    throw new ValidationError('Idempotency-Key', 'Provide an 8–128 character request key.');
  }
  return value;
}

export function parseContributionInput(value: unknown): PutContributionInput {
  const record = object(value, ['expectedRevision', 'watched', 'ratings']);
  const expectedRevision = integer(record.expectedRevision, 'expectedRevision', 0);
  if (record.watched !== true) {
    throw new ValidationError('watched', 'Confirm you watched this movie.', 'WATCH_CONFIRMATION_REQUIRED');
  }
  if (!Array.isArray(record.ratings) || record.ratings.length < 1 || record.ratings.length > CATEGORY_SLUGS.length) {
    throw new ValidationError('ratings', 'Assess 1–6 categories; use delete to remove every assessment.');
  }
  const seen = new Set<CategorySlug>();
  const ratings: CategoryRating[] = record.ratings.map(value => {
    const rating = object(value, ['category', 'severity']);
    if (typeof rating.category !== 'string' || !CATEGORY_SLUGS.includes(rating.category as CategorySlug)) {
      throw new ValidationError('ratings', 'Choose a supported category.');
    }
    const category = rating.category as CategorySlug;
    if (seen.has(category)) throw new ValidationError('ratings', 'Assess each category once.');
    seen.add(category);
    return { category, severity: integer(rating.severity, 'severity', 0, 3) as Severity };
  });
  return { expectedRevision, watched: true, ratings };
}

export function parseDeleteContributionInput(value: unknown): DeleteContributionInput {
  const record = object(value, ['expectedRevision']);
  return { expectedRevision: integer(record.expectedRevision, 'expectedRevision', 1) };
}

export function parseImportMovieInput(value: unknown): ImportMovieInput {
  const record = object(value, ['tmdbId']);
  return { tmdbId: integer(record.tmdbId, 'tmdbId', 1) };
}

export function parseSearchInput(q: unknown, page: unknown = '1'): { query: string; page: number } {
  if (typeof q !== 'string') throw new ValidationError('q', 'Enter a movie title.');
  const query = q.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (Array.from(query).length < 2 || Array.from(query).length > 100) {
    throw new ValidationError('q', 'Search text must contain 2–100 characters.');
  }
  if (typeof page !== 'string' || page.trim() !== page || !/^(?:[1-9]|1[0-9]|20)$/u.test(page)) {
    throw new ValidationError('page', 'Search pages must be between 1 and 20.');
  }
  return { query, page: Number(page) };
}
