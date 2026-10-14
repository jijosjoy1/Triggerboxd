/** Launch API v1. Missing assessments remain Unknown; no note fields are accepted. */
export const CATEGORY_SLUGS = [
  'nudity', 'sexual_content', 'sexual_violence', 'gore_graphic_violence',
  'disturbing_content', 'suicide_self_harm',
  'animal_harm', 'drugs', 'alcohol', 'language', 'physical_violence',
  'graphic_violence', 'horror',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];
export type Severity = 0 | 1 | 2 | 3 | 4 | 5;
export type WarningSpoilerLevel = 0 | 1 | 2;
export const WARNING_DESCRIPTOR_IDS: Readonly<Record<CategorySlug, readonly string[]>> = {
  nudity: ['male_nudity','female_nudity','partial_nudity','full_frontal_nudity','brief_nudity','prolonged_nudity','sexual_nudity','non_sexual_nudity'],
  sexual_content: ['kissing','intimacy','sexual_activity'],
  sexual_violence: ['rape','attempted_rape','sexual_assault','sexual_harassment','sexual_coercion','implied_sexual_violence','offscreen_sexual_violence','graphic_sexual_violence'],
  gore_graphic_violence: ['blood','graphic_injury','body_horror','vomiting','decomposition','disturbing_medical','exposed_organs'],
  disturbing_content: [], suicide_self_harm: [],
  animal_harm: ['animal_distress','animal_injury','animal_cruelty','animal_death'],
  drugs: ['recreational_drug_use','drug_addiction','overdose'],
  alcohol: ['alcohol_consumption','intoxication','alcohol_abuse'],
  language: ['profanity','slurs'],
  physical_violence: ['physical_assault','torture','domestic_violence'],
  graphic_violence: ['bloody_killing','dismemberment','decapitation','brutal_attack','visible_bloodshed'],
  horror: ['jump_scare','psychological_fear','paranormal_activity','frightening_creature','creepy_atmosphere'],
};
export type SeverityDistribution = [number, number, number, number, number, number];

export interface CategoryRating {
  category: CategorySlug;
  severity: Severity;
  spoilerLevel?: WarningSpoilerLevel;
  descriptors?: string[];
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
export interface PatchWarningInput extends CategoryRating { expectedRevision: number; watched: true; spoilerLevel: WarningSpoilerLevel; descriptors: string[] }
export interface RevealWarningsInput { categories: CategorySlug[]; level: 1 | 2 }
export interface FamilyVoteInput { expectedRevision: number; watched: true; value: 1 | 2 | 3 | 4 | 5 }
export interface OwnFamilyVoteResult { familyVote: { revision: number; value: 1 | 2 | 3 | 4 | 5 } | null }
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
