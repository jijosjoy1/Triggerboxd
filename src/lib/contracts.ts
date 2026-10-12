/** Launch API v1. Missing assessments remain Unknown; no note fields are accepted. */
export const CATEGORY_SLUGS = [
  'nudity', 'sexual_content', 'sexual_violence', 'gore_graphic_violence',
  'disturbing_content', 'suicide_self_harm',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];
export type Severity = 0 | 1 | 2 | 3;
export type SeverityDistribution = [number, number, number, number];

export interface CategoryRating {
  category: CategorySlug;
  severity: Severity;
}

export interface WarningSummary {
  category: CategorySlug;
  severity: Severity | null;
  count: number;
  distribution: SeverityDistribution;
  provisional: boolean;
  disputed: boolean;
}

export interface MovieSummary {
  id: string;
  tmdbId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  language: string | null;
  posterPath: string | null;
  synopsis: string | null;
  metadataFetchedAt: string;
  warnings: WarningSummary[];
  contributorCount: number;
}

export interface OwnContribution {
  /** Use the returned revision; revisions are globally increasing, not necessarily +1. */
  revision: number;
  watched: true;
  ratings: CategoryRating[];
}

export interface OwnContributionResult { contribution: OwnContribution | null }
export interface PutContributionInput { expectedRevision: number; watched: true; ratings: CategoryRating[] }
export interface DeleteContributionInput { expectedRevision: number }
export interface ImportMovieInput { tmdbId: number }
export interface ImportMovieResult { id: string; tmdbId: number; created: boolean }
export interface AccountStatus { status: 'active' | 'suspended'; emailVerified: boolean; displayName: string }
export interface IndexableMovie { id: string; updatedAt: string }

/** Only the server TMDb gateway may construct this metadata, never a request body. */
export interface AuthoritativeMovieMetadata {
  title: string;
  originalTitle: string;
  releaseDate: string | null;
  language: string | null;
  productionCountries: string[];
  posterPath: string | null;
  synopsis: string | null;
}

export interface MovieSearchResult {
  tmdbId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  language: string | null;
  posterPath: string | null;
}
export interface MovieSearchPage { results: MovieSearchResult[]; page: number; hasMore: boolean }
export interface ApiSuccess<T> { data: T; meta?: Record<string, unknown> }
export type ApiErrorCode =
  | 'INVALID_REQUEST' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'ACCOUNT_SUSPENDED' | 'EMAIL_NOT_VERIFIED'
  | 'NOT_FOUND' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'PAYLOAD_TOO_LARGE'
  | 'MOVIE_NOT_SUPPORTED' | 'WATCH_CONFIRMATION_REQUIRED' | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR' | 'SERVICE_UNAVAILABLE' | 'UPSTREAM_TIMEOUT';
export interface ApiError {
  error: { code: ApiErrorCode; message: string; requestId: string; fields?: Record<string, string> };
}

/** Exact database RPC argument names used by PostgREST. */
export interface PutContributionRpcArgs {
  p_movie_id: string; p_expected_revision: number; p_watched: true;
  p_ratings: CategoryRating[]; p_idempotency_key: string;
}
export interface DeleteContributionRpcArgs {
  p_movie_id: string; p_expected_revision: number; p_idempotency_key: string;
}
export interface ImportMovieRpcArgs {
  p_actor_id: string; p_tmdb_id: number; p_metadata: AuthoritativeMovieMetadata; p_idempotency_key: string;
}
