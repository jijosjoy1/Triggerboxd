import { ApiError } from './api-http';
export const REVIEW_FLAG_REASONS = {
  spam: 'Spam or promotion',
  coordinated_activity: 'Suspected coordinated manipulation',
  abusive_content: 'Abusive content',
  other: 'Other evidence of abuse',
} as const;
export type ReviewFlagReason = keyof typeof REVIEW_FLAG_REASONS;
export type ReviewFlag = { status: 'open' | 'resolved'; reason: ReviewFlagReason; note: string | null; flaggedAt: string; updatedAt: string; reviewRevision: number };
export type AdminReview = {
  id: string; movieId: string; filmTitle: string; nickname: string; revision: number;
  submittedAt: string; updatedAt: string; watched: boolean; visibility: string;
  categories: { category: string; severity: number; spoilerLevel: number }[];
  flag: ReviewFlag | null;
};
export type FlaggedReview = { id: string; movieId: string; filmTitle: string; reason: ReviewFlagReason; note: string | null; flaggedAt: string; reviewChanged: boolean };
export function parseReviewAction(value: unknown): { action: 'flag' | 'resolve'; expectedRevision: number; reason: ReviewFlagReason | null; note: string | null } {
  const invalid = (): never => { throw new ApiError('INVALID_REQUEST'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const body = value as Record<string, unknown>;
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) return invalid();
  if (body.action === 'resolve') {
    if (Object.keys(body).some(key => !['action', 'expectedRevision'].includes(key))) return invalid();
    return { action: 'resolve', expectedRevision: body.expectedRevision as number, reason: null, note: null };
  }
  if (body.action !== 'flag' || Object.keys(body).some(key => !['action', 'expectedRevision', 'reason', 'note'].includes(key)) || typeof body.reason !== 'string' || !Object.hasOwn(REVIEW_FLAG_REASONS, body.reason)) return invalid();
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > 280 || /[\p{Cc}\p{Cf}]/u.test(body.note))) return invalid();
  return { action: 'flag', expectedRevision: body.expectedRevision as number, reason: body.reason as ReviewFlagReason, note: typeof body.note === 'string' ? body.note.trim() || null : null };
}
