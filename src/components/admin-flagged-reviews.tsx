'use client';
import { useEffect, useState } from 'react';
import { REVIEW_FLAG_REASONS, type FlaggedReview } from '../lib/admin-review';
import { ADMIN_MAX_OFFSET } from '../lib/admin';
import { AdminReviewDetails } from './admin-review-details';
const PAGE_SIZE = 5;
export function AdminFlaggedReviews({ accountId }: { accountId: string }) {
  const [offset, setOffset] = useState(0), [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [message, setMessage] = useState('');
  const [view, setView] = useState<{ key: string; data?: { total: number; reviews: FlaggedReview[] }; error?: string } | null>(null);
  const key = `${accountId}:${offset}:${version}`;
  useEffect(() => {
    const controller = new AbortController(); setSelected(null);
    void fetch(`/api/v1/admin/flagged-reviews/?limit=${PAGE_SIZE}&offset=${offset}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Unable to load flagged reviews.');
      if (!controller.signal.aborted) {
        if (offset > 0 && result.data.reviews.length === 0) { setOffset(Math.max(0, offset - PAGE_SIZE)); return; }
        setView({ key, data: result.data });
      }
    }).catch(reason => { if (!controller.signal.aborted) setView({ key, error: reason instanceof Error ? reason.message : 'Unable to load flagged reviews.' }); });
    return () => controller.abort();
  }, [key, offset]);
  const current = view?.key === key ? view : null;
  if (current?.error) return <p role="alert">{current.error} <button type="button" className="mvp-secondary" onClick={() => setVersion(value => value + 1)}>Retry</button></p>;
  if (!current?.data) return <p role="status">Loading flagged reviews…</p>;
  const { reviews, total } = current.data;
  return <section aria-labelledby="flagged-review-heading">
    <h2 id="flagged-review-heading">Flagged reviews</h2><p className="fine">{total} awaiting review. Flags are suspicions to investigate, not findings that a review is fake.</p>
    {message ? <p role="status">{message}</p> : null}
    {!reviews.length ? <p>No flagged reviews. Admins can flag a review from Recent assessments.</p> : <ul className="adm-list">{reviews.map(review => <li key={review.id}>
      <button type="button" id={`adm-open-flag-${review.id}`} className="adm-review-link" aria-expanded={selected === review.id} onClick={() => setSelected(value => value === review.id ? null : review.id)}>{review.filmTitle} — view review</button>
      <span>{REVIEW_FLAG_REASONS[review.reason]}</span>{review.note ? <p>{review.note}</p> : null}
      <span className="fine">Flagged {new Date(review.flaggedAt).toLocaleString()}{review.reviewChanged ? ' · Edited since flagging' : ''}</span>
      {selected === review.id ? <AdminReviewDetails reviewId={review.id} accountId={accountId} onClose={() => { setSelected(null); document.getElementById(`adm-open-flag-${review.id}`)?.focus(); }} onChanged={notice => { setMessage(notice); setVersion(value => value + 1); }} /> : null}
    </li>)}</ul>}
    <div className="adm-pager"><button type="button" className="mvp-secondary" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>Newer flags</button><button type="button" className="mvp-secondary" disabled={offset + PAGE_SIZE >= total || offset + PAGE_SIZE > ADMIN_MAX_OFFSET} onClick={() => setOffset(value => value + PAGE_SIZE)}>Older flags</button></div>
  </section>;
}
