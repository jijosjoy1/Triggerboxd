/** A deliberately small, server-side boundary around the TMDb v3 API. */

const API_ORIGIN = "https://api.themoviedb.org";
const IMAGE_ORIGIN = "https://image.tmdb.org/t/p";
const DEFAULT_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 100;

export type TmdbErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "RATE_LIMITED"
  | "MOVIE_NOT_SUPPORTED";

/** Safe to map to the public API error envelope; never contains upstream bodies. */
export class TmdbError extends Error {
  readonly code: TmdbErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: TmdbErrorCode, retryAfterSeconds?: number) {
    super(code);
    this.name = "TmdbError";
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface TmdbSearchResult {
  tmdbId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  language: string | null;
  posterPath: string | null;
}

export interface TmdbSearchPage {
  results: TmdbSearchResult[];
  page: number;
  hasMore: boolean;
}

/** Metadata returned by TMDb details; this is not a warning assessment. */
export interface TmdbMovieDetails extends TmdbSearchResult {
  adult: boolean;
  releaseDate: string | null;
  overview: string | null;
  productionCountries: string[];
}

export interface TmdbGatewayOptions {
  /** TMDb v3 API Read Access Token. Supply it from server configuration only. */
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  /**
   * Search-result cache is disabled unless explicitly enabled after terms review.
   * Limits are clamped to the documented gateway bounds.
   */
  searchCache?: { enabled: boolean; maxEntries?: number; ttlMs?: number };
}

export interface TmdbGateway {
  getRecentMovies(): Promise<TmdbSearchResult[]>;
  getMoviePresentation(tmdbId: number): Promise<{ runtime: number | null; genres: string[]; certifications: string[]; backdropPath: string|null }>;
  getIndianCertifications(tmdbId: number): Promise<string[]>;
  searchMovies(input: { query: string; page?: number }): Promise<TmdbSearchPage>;
  getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails>;
}

type CacheEntry = { expiresAt: number; value: TmdbSearchPage };

export function createTmdbGateway(options: TmdbGatewayOptions): TmdbGateway {
  const accessToken = options.accessToken.trim();
  if (!accessToken) throw new TmdbError("UPSTREAM_ERROR");

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = positiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const now = options.now ?? Date.now;
  const cacheEnabled = options.searchCache?.enabled === true;
  const cacheLimit = Math.min(CACHE_LIMIT, positiveInt(options.searchCache?.maxEntries, CACHE_LIMIT));
  const cacheTtlMs = Math.min(CACHE_TTL_MS, positiveInt(options.searchCache?.ttlMs, CACHE_TTL_MS));
  const cache = new Map<string, CacheEntry>();

  return {
    async getRecentMovies() {
      const end = new Date(now());
      const start = new Date(end.getTime() - 120 * 24 * 60 * 60 * 1000);
      const from = start.toISOString().slice(0,10), to = end.toISOString().slice(0,10);
      const url = new URL('/3/discover/movie', API_ORIGIN);
      url.searchParams.set('with_origin_country','IN');
      url.searchParams.set('primary_release_date.gte',from);
      url.searchParams.set('primary_release_date.lte',to);
      url.searchParams.set('sort_by','popularity.desc');
      url.searchParams.set('include_adult','false');
      url.searchParams.set('include_video','false');
      url.searchParams.set('page','1');
      const payload = await requestJson(url,accessToken,fetchImpl,timeoutMs);
      if(!isRecord(payload) || !Array.isArray(payload.results))throw new TmdbError('UPSTREAM_ERROR');
      const seen = new Set<number>();
      return payload.results.flatMap(value=>{
        if(!isRecord(value) || value.adult!==false || typeof value.release_date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.release_date) || value.release_date<from || value.release_date>to)return [];
        const movie=parseSearchResult(value);
        if(!movie || !movie.posterPath || seen.has(movie.tmdbId))return [];
        seen.add(movie.tmdbId); return [movie];
      }).slice(0,8);
    },
    async getMoviePresentation(tmdbId) {
      validateTmdbId(tmdbId);
      const url = new URL(`/3/movie/${tmdbId}`, API_ORIGIN);
      url.searchParams.set('append_to_response', 'release_dates');
      const payload = await requestJson(url, accessToken, fetchImpl, timeoutMs);
      if (!isRecord(payload) || payload.id !== tmdbId || payload.adult !== false) throw new TmdbError('UPSTREAM_ERROR');
      const runtime = typeof payload.runtime === 'number' && Number.isInteger(payload.runtime) && payload.runtime > 0 && payload.runtime <= 10000 ? payload.runtime : null;
      const genres = Array.isArray(payload.genres) ? payload.genres.filter(isRecord).map(g => g.name).filter((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= 80).slice(0, 10) : [];
      const certifications = new Set<string>();
      const releases = isRecord(payload.release_dates) && Array.isArray(payload.release_dates.results) ? payload.release_dates.results : [];
      for (const country of releases) {
        if (!isRecord(country) || country.iso_3166_1 !== 'IN' || !Array.isArray(country.release_dates)) continue;
        for (const release of country.release_dates) {
          if (!isRecord(release) || typeof release.certification !== 'string') continue;
          const label = release.certification.trim();
          if (label && label.length <= 32 && /^[A-Za-z0-9 /+()-]+$/.test(label)) certifications.add(label);
        }
      }
      return { runtime, genres, certifications: [...certifications].sort(), backdropPath: typeof payload.backdrop_path==='string'?validatePosterPath(payload.backdrop_path):null };
    },
    async getIndianCertifications(tmdbId): Promise<string[]> {
      validateTmdbId(tmdbId);
      const payload = await requestJson(new URL(`/3/movie/${tmdbId}/release_dates`, API_ORIGIN), accessToken, fetchImpl, timeoutMs);
      if (!isRecord(payload) || !Array.isArray(payload.results)) throw new TmdbError('UPSTREAM_ERROR');
      const labels = new Set<string>();
      for (const country of payload.results) {
        if (!isRecord(country) || country.iso_3166_1 !== 'IN' || !Array.isArray(country.release_dates)) continue;
        for (const release of country.release_dates) {
          if (!isRecord(release) || typeof release.certification !== 'string') continue;
          const label = release.certification.trim();
          if (label && label.length <= 32 && /^[A-Za-z0-9 /+()-]+$/.test(label)) labels.add(label);
        }
      }
      return [...labels].sort();
    },
    async searchMovies({ query, page = 1 }): Promise<TmdbSearchPage> {
      const normalizedQuery = validateQuery(query);
      validatePage(page);
      const cacheKey = JSON.stringify([normalizedQuery, page]);

      if (cacheEnabled) {
        const found = cache.get(cacheKey);
        if (found && found.expiresAt > now()) {
          cache.delete(cacheKey);
          cache.set(cacheKey, found);
          return cloneSearchPage(found.value);
        }
        if (found) cache.delete(cacheKey);
      }

      const url = new URL("/3/search/movie", API_ORIGIN);
      url.searchParams.set("query", normalizedQuery);
      url.searchParams.set("page", String(page));
      url.searchParams.set("include_adult", "false");

      const payload = await requestJson(url, accessToken, fetchImpl, timeoutMs);
      if (!isRecord(payload) || !Array.isArray(payload.results) || payload.page !== page) {
        throw new TmdbError("UPSTREAM_ERROR");
      }

      const results = payload.results
        .filter(value=>!(isRecord(value)&&value.adult===true))
        .map(parseSearchResult).filter((item): item is TmdbSearchResult => item !== null);
      const totalPages = payload.total_pages;
      if (typeof totalPages !== "number" || !Number.isFinite(totalPages) || totalPages < 0) {
        throw new TmdbError("UPSTREAM_ERROR");
      }
      const result: TmdbSearchPage = { results, page, hasMore: page < totalPages };

      if (cacheEnabled) {
        cache.set(cacheKey, { expiresAt: now() + cacheTtlMs, value: cloneSearchPage(result) });
        while (cache.size > cacheLimit) cache.delete(cache.keys().next().value as string);
      }
      return result;
    },

    async getMovieDetails(tmdbId): Promise<TmdbMovieDetails> {
      validateTmdbId(tmdbId);
      const payload = await requestJson(new URL(`/3/movie/${tmdbId}`, API_ORIGIN), accessToken, fetchImpl, timeoutMs);
      const details = parseMovieDetails(payload);
      if (!details || details.tmdbId!==tmdbId) throw new TmdbError("UPSTREAM_ERROR");
      if (details.adult) throw new TmdbError("MOVIE_NOT_SUPPORTED");
      return details;
    },
  };
}

/** Build a poster URL only from a validated TMDb-relative path and fixed CDN. */
export function tmdbPosterUrl(posterPath: string | null, size: "w185" | "w342" | "w500" = "w342"): string | null {
  if (posterPath === null) return null;
  const safePath = validatePosterPath(posterPath);
  if (!safePath || !["w185", "w342", "w500"].includes(size)) return null;
  return `${IMAGE_ORIGIN}/${size}${safePath}`;
}

async function requestJson(url: URL, token: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let didTimeout = false;
  const onAbort = () => { didTimeout = true; };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    // One shared deadline keeps both attempts within the five-second request budget.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: controller.signal,
        });
      } catch {
        if (didTimeout || controller.signal.aborted) throw new TmdbError("UPSTREAM_TIMEOUT");
        if (attempt === 0) continue;
        throw new TmdbError("UPSTREAM_ERROR");
      }

      if (response.status === 429) {
        throw new TmdbError("RATE_LIMITED", parseRetryAfter(response.headers.get("retry-after")));
      }
      if (response.status === 404) throw new TmdbError("NOT_FOUND");
      if (response.status >= 500) {
        if (attempt === 0 && !controller.signal.aborted) continue;
        if (didTimeout || controller.signal.aborted) throw new TmdbError("UPSTREAM_TIMEOUT");
        throw new TmdbError("UPSTREAM_ERROR");
      }
      if (!response.ok) throw new TmdbError("UPSTREAM_ERROR");

      try {
        return await response.json();
      } catch {
        if (didTimeout || controller.signal.aborted) throw new TmdbError("UPSTREAM_TIMEOUT");
        throw new TmdbError("UPSTREAM_ERROR");
      }
    }
    throw new TmdbError("UPSTREAM_ERROR");
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

function validateQuery(query: unknown): string {
  if (typeof query !== "string") throw new TmdbError("INVALID_REQUEST");
  const normalized = query.trim();
  const count = [...normalized].length;
  if (count < 2 || count > 100 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TmdbError("INVALID_REQUEST");
  }
  return normalized;
}

function validatePage(page: unknown): asserts page is number {
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 20) {
    throw new TmdbError("INVALID_REQUEST");
  }
}

function validateTmdbId(id: unknown): asserts id is number {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
    throw new TmdbError("INVALID_REQUEST");
  }
}

function parseSearchResult(value: unknown): TmdbSearchResult | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || (value.id as number) < 1) return null;
  if (typeof value.title !== "string" || typeof value.original_title !== "string") return null;
  const posterPath = typeof value.poster_path === "string" ? validatePosterPath(value.poster_path) : null;
  return {
    tmdbId: value.id as number,
    title: value.title,
    originalTitle: value.original_title,
    year: parseYear(value.release_date),
    language: typeof value.original_language === "string" ? value.original_language : null,
    posterPath,
  };
}

function parseMovieDetails(value: unknown): TmdbMovieDetails | null {
  if (!isRecord(value)) return null;
  const base = parseSearchResult(value);
  if (!base || typeof value.adult !== "boolean") return null;
  const productionCountries = Array.isArray(value.production_countries)
    ? value.production_countries
      .filter((country): country is Record<string, unknown> => isRecord(country) && typeof country.iso_3166_1 === "string")
      .map((country) => country.iso_3166_1 as string)
    : [];
  return {
    ...base,
    adult: value.adult,
    releaseDate: typeof value.release_date === "string" && value.release_date ? value.release_date : null,
    overview: typeof value.overview === "string" ? value.overview : null,
    productionCountries,
  };
}

function validatePosterPath(path: string): string | null {
  if (!/^\/[A-Za-z0-9_./-]+$/u.test(path) || path.includes("..") || path.startsWith("//")) return null;
  return path;
}

function parseYear(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})/u.exec(value);
  return match ? Number(match[1]) : null;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSearchPage(value: TmdbSearchPage): TmdbSearchPage {
  return { ...value, results: value.results.map((result) => ({ ...result })) };
}
