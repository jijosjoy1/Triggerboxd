import { ApiError, validateMovieId } from './api-http';

export const SUBTITLE_FACTOR_KEYS = ['mildProfanityCues','strongProfanityCues','slurCues','sexualContentCues','sexualViolenceReferenceCues'] as const;
export type SubtitleResult = { rating: number | null; verdict: string | null; factors: Record<typeof SUBTITLE_FACTOR_KEYS[number], number>; rulesVersion: string; scorerVersion: string; subtitleLanguage: 'EN'; subtitleHash: string; cueCount: number };
export type SubtitleJob = { id: string; movieId: string; tmdbId: number; title: string; year: number | null; state: 'queued'|'processing'|'needs_review'|'approved'|'rejected'|'failed'; revision: number; attempts: number; result: SubtitleResult | null; approvedRating: number | null; reviewer: string | null; reviewedAt: string | null; note: string | null; failureReason: string | null; updatedAt: string };
export const ESTIMATE_VERDICTS = ['','Even grandma can join.','A few awkward silences.','Suddenly, WhatsApp looks interesting.','The ceiling fan deserves an Oscar.',"The remote won't save you."];
const invalid = (): never => { throw new ApiError('INVALID_REQUEST'); };
function object(value: unknown): Record<string,unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Record<string,unknown>; }
function keys(value: Record<string,unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function integer(value: unknown, min: number, max: number): number { if (!Number.isSafeInteger(value) || (value as number)<min || (value as number)>max) return invalid(); return value as number; }
function note(value: unknown): string | null { if (value == null) return null; if (typeof value !== 'string' || value.length>280 || /[\p{Cc}\p{Cf}]/u.test(value)) return invalid(); return value.trim() || null; }
export function parseSubtitleResult(value: unknown): SubtitleResult {
  const body=object(value); keys(body,['rating','verdict','factors','rulesVersion','scorerVersion','subtitleLanguage','subtitleHash','cueCount']);
  const cueCount=integer(body.cueCount,1,10000); const factors=object(body.factors); keys(factors,[...SUBTITLE_FACTOR_KEYS]);
  const parsed=Object.fromEntries(SUBTITLE_FACTOR_KEYS.map(key=>[key,integer(factors[key],0,cueCount)])) as SubtitleResult['factors'];
  for (const field of ['rulesVersion','scorerVersion']) if (typeof body[field] !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(body[field] as string)) invalid();
  if (body.subtitleLanguage !== 'EN' || typeof body.subtitleHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.subtitleHash)) invalid();
  const rating=body.rating === null ? null : integer(body.rating,1,5);
  if (body.verdict !== null && (typeof body.verdict !== 'string' || body.verdict.length>160)) invalid();
  // Never publish model/provider prose as the verdict; derive it from the approved scale.
  return {rating,verdict:rating===null?null:ESTIMATE_VERDICTS[rating],factors:parsed,rulesVersion:body.rulesVersion as string,scorerVersion:body.scorerVersion as string,subtitleLanguage:'EN',subtitleHash:body.subtitleHash as string,cueCount};
}
export function parseSubtitleAction(value: unknown) {
  const body=object(value);
  if (body.action==='enqueue') { keys(body,['action','tmdbId']); return {action:'enqueue' as const,tmdbId:integer(body.tmdbId,1,2147483647)}; }
  keys(body,['action','id','expectedRevision','rating','watched','note']);
  if (!['approve','reject','reopen'].includes(String(body.action)) || typeof body.id!=='string') return invalid();
  const id=validateMovieId(body.id); const expectedRevision=integer(body.expectedRevision,1,2147483647); const reason=note(body.note);
  if (body.action==='approve') {
    if (body.watched!==true) invalid();
    return {action:'approve' as const,id,expectedRevision,rating:integer(body.rating,1,5),watched:true,note:reason};
  }
  if (!reason || body.rating!==undefined || body.watched!==undefined) return invalid();
  return {action:body.action as 'reject'|'reopen',id,expectedRevision,note:reason};
}
