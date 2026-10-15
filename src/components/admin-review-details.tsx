'use client';
import { useEffect, useRef, useState } from 'react';
import { REVIEW_FLAG_REASONS, type AdminReview, type ReviewFlagReason } from '../lib/admin-review';
import { refreshAuthSession } from '../lib/supabase/browser';
import { formatIstTime } from '../lib/ist-time';

const SEVERITIES = ['None', 'Mild', 'Moderate', 'Severe', 'Very severe', 'Extreme'];
export function reviewCategoryName(category: string) {
  const names: Record<string, string> = { gore_graphic_violence: 'Gore / disturbing visuals', graphic_violence: 'Graphic violence / bloodshed', horror: 'Horror / frightening content', physical_violence: 'Physical violence (legacy)', suicide_self_harm: 'Suicide / self-harm' };
  return names[category] ?? category.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase());
}

export function AdminReviewDetails({ reviewId, accountId, onClose, onChanged }: { reviewId: string; accountId: string; onClose: () => void; onChanged: (message: string) => void }) {
  const [review, setReview] = useState<AdminReview | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0), [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<ReviewFlagReason | ''>(''), [note, setNote] = useState('');
  const alive = useRef(true), mutation = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const path = `/api/v1/admin/reviews/${reviewId}/`;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; mutation.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setReview(null); setEditing(false);
    void fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Unable to load this review.');
      if (!controller.signal.aborted) setReview(result.data);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load this review.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, version]);
  useEffect(() => { if (!loading) heading.current?.focus(); }, [loading]);
  async function moderate(action: 'flag' | 'resolve') {
    if (!review || busy || (action === 'flag' && !reason)) return;
    setBusy(true); setError(''); setMessage('');
    const controller = new AbortController(); mutation.current = controller;
    try {
      const session = await refreshAuthSession();
      if (!alive.current || session.user?.id !== accountId) return;
      const body = action === 'flag' ? { action, expectedRevision: review.revision, reason, note: note.trim() || null } : { action, expectedRevision: review.revision };
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify(body) });
      const result = await response.json();
      if (response.status === 409) throw new Error('This review changed. Reload its ratings before flagging or resolving it.');
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Unable to update this flag.');
      if (!alive.current) return;
      setReview(result.data); setEditing(false);
      const notice = action === 'flag' ? 'Review added to Flagged reviews. Its ratings remain unchanged.' : 'Flag resolved. The review and its ratings remain unchanged.';
      setMessage(notice); onChanged(notice);
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to update this flag.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="adm-review-detail" aria-labelledby={`review-heading-${reviewId}`}>
    <div className="adm-review-heading"><h3 ref={heading} tabIndex={-1} id={`review-heading-${reviewId}`}>Review details</h3><button type="button" className="mvp-secondary" disabled={busy} onClick={onClose}>Close review</button></div>
    {loading ? <p role="status">Loading review…</p> : null}
    {error ? <p role="alert" className="adm-review-error">{error} <button type="button" className="mvp-secondary" disabled={busy} onClick={() => setVersion(value => value + 1)}>Reload review</button></p> : null}
    {message ? <p role="status">{message}</p> : null}
    {review && !loading ? <>
      <p><a href={`/movies/${review.movieId}/`}>{review.filmTitle} — open film guide</a></p>
      <p className="fine">Nickname: {review.nickname} · {review.watched ? 'Marked watched' : 'Not marked watched'} · {review.visibility}</p>
      <p className="fine">Submitted {formatIstTime(review.submittedAt)} · Last updated {formatIstTime(review.updatedAt)}</p>
      <p className="fine">All submitted category ratings are shown below. Missing categories were not assessed.</p>
      <div className="adm-review-table-wrap"><table className="adm-review-table"><caption>Full category ratings</caption><thead><tr><th scope="col">Category</th><th scope="col">Rating</th></tr></thead><tbody>
        {review.categories.map(rating => <tr key={rating.category}><th scope="row">{reviewCategoryName(rating.category)}</th><td>{SEVERITIES[rating.severity] ?? 'Unknown'} ({rating.severity}/5){rating.spoilerLevel > 0 ? <span className="fine"> · Spoiler-protected in public views</span> : null}</td></tr>)}
      </tbody></table></div>
      {!review.categories.length ? <p>No category ratings in this review.</p> : null}
      {review.flag ? <div className="adm-review-flag"><strong>{review.flag.status === 'open' ? 'Flagged for review' : 'Flag resolved'}</strong><p>{REVIEW_FLAG_REASONS[review.flag.reason]}</p>{review.flag.note ? <p>{review.flag.note}</p> : null}{review.flag.reviewRevision !== review.revision ? <p>Edited since flagging — check the current ratings above.</p> : null}</div> : null}
      <p className="fine">A different perspective is not evidence of abuse. Flags are private to admins and do not hide reviews or change ratings.</p>
      {editing ? <form className="adm-flag-form" onSubmit={event => { event.preventDefault(); void moderate('flag'); }}>
        <label>Reason for flagging<select required value={reason} disabled={busy} onChange={event => setReason(event.target.value as ReviewFlagReason)}><option value="">Choose a reason</option>{Object.entries(REVIEW_FLAG_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Evidence or context (optional)<textarea value={note} maxLength={280} disabled={busy} rows={3} onChange={event => setNote(event.target.value)} /></label>
        <p className="fine">Describe observable evidence. Do not include personal or contact details.</p>
        <div className="adm-review-actions"><button type="submit" className="mvp-secondary" disabled={busy || !reason}>{busy ? 'Saving flag…' : 'Save flag'}</button><button type="button" className="mvp-secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
      </form> : <div className="adm-review-actions"><button type="button" className="mvp-secondary" disabled={busy} onClick={() => { setReason(review.flag?.reason ?? ''); setNote(review.flag?.note ?? ''); setEditing(true); }}>{review.flag?.status === 'open' ? 'Update flag' : 'Flag suspected abuse'}</button>{review.flag?.status === 'open' ? <button type="button" className="mvp-secondary" disabled={busy} onClick={() => void moderate('resolve')}>{busy ? 'Resolving…' : 'Resolve flag'}</button> : null}</div>}
    </> : null}
  </section>;
}
