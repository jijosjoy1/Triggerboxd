'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORY_SLUGS, WARNING_DESCRIPTOR_IDS, type CategorySlug, type OwnContribution, type OwnContributionResult, type OwnFamilyVoteResult, type Severity, type WarningSpoilerLevel } from '../lib/contracts';
import { CONTENT_SEVERITIES } from '../lib/signature-questions';
import { draftFrom, editRating, PartialSaveError, RetryKeys, saveChangedCategories, type RatingDraft as Draft, type RatingDrafts as Drafts } from '../lib/unified-contribution-save';
import { refreshAuthSession, useAuthSession } from '../lib/supabase/browser';
import { CategoryOwnNotes } from './movie-scenes';
import { MovieStory } from './movie-story';

type Family = OwnFamilyVoteResult['familyVote'];

const META: Record<CategorySlug, { title: string; description: string }> = {
  nudity: { title: 'Nudity', description: 'Exposed bodies and how prominently they appear.' },
  sexual_content: { title: 'Sexual content', description: 'Sexual activity, intimacy, or references.' },
  sexual_violence: { title: 'Sexual violence', description: 'Threats, coercion, assault, or references to them.' },
  gore_graphic_violence: { title: '🍛 Gore / disturbing visuals', description: 'Stomach-turning visuals, body horror or graphic injury. Earlier reports also included blood.' },
  graphic_violence: { title: '🩸 Graphic violence / bloodshed', description: 'Explicit bloody violence, severe injuries, brutal attacks or dismemberment.' },
  horror: { title: '👻 Horror / frightening content', description: 'Jump scares, unsettling imagery, suspense or psychological fear.' },
  animal_harm: { title: 'Animal harm', description: 'Animal distress, injury, cruelty, or death.' },
  drugs: { title: 'Drugs', description: 'Drug use, addiction, or overdose.' },
  alcohol: { title: 'Alcohol', description: 'Drinking, intoxication, or alcohol abuse.' },
  language: { title: 'Language', description: 'Profanity, slurs, or strong language.' },
  physical_violence: { title: 'Physical violence', description: 'Fights, assault, or other physical harm.' },
  disturbing_content: { title: 'Disturbing content', description: 'Distressing material outside the other topics.' },
  suicide_self_harm: { title: 'Suicide / self-harm', description: 'References or depictions of suicide and self-harm.' },
};
const ORDER: CategorySlug[] = ['gore_graphic_violence', 'graphic_violence', 'horror', 'nudity', 'sexual_content', 'sexual_violence', 'animal_harm', 'drugs', 'alcohol', 'language', 'physical_violence', 'disturbing_content', 'suicide_self_harm'];
const LEVELS = CONTENT_SEVERITIES;
const FAMILY_COPY = ['Even grandma can join.', 'A few awkward silences.', 'Suddenly, WhatsApp looks interesting.', 'The ceiling fan deserves an Oscar.', "The remote won't save you."] as const;
const draftKey = (movieId: string, owner: string) => `triggerboxd:unified-contribution:v1:${movieId}:${owner}`;

class RequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function read<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const wait = response.headers.get('Retry-After');
    const message = response.status === 429 ? `Rate limit reached. Wait${wait && /^\d+$/.test(wait) ? ` ${wait} seconds` : ' a little'} before retrying.` : body?.error?.message ?? 'Unable to save. Please retry.';
    throw new RequestError(response.status, message);
  }
  if (!body || !('data' in body)) throw new Error('The service response was incomplete. Retry the same request.');
  return body.data as T;
}

export function UnifiedContribution({ movieId, title, posterPath, backdropPath, year, genres, watched, onChanged, onSaved }: { movieId: string; title: string; posterPath?: string | null; backdropPath?: string | null; year?: number | null; genres?: string[]; watched: boolean; onChanged: () => void; onSaved?: () => void }) {
  const { session, loading: authLoading, error: authError } = useAuthSession();
  const owner = session?.user?.id ?? null;
  const ownerRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const retries = useRef(new RetryKeys(() => crypto.randomUUID()));
  const retryKeepDraft = useRef(false);
  const requestSequence = useRef(0);
  const [saved, setSaved] = useState<OwnContribution | null>(null);
  const [family, setFamily] = useState<Family>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [familyDraft, setFamilyDraft] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [rebaseReady, setRebaseReady] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  const load = useCallback(async (keepDraft = false) => {
    if (!owner || !watched) return;
    retryKeepDraft.current = keepDraft;
    const sequence = ++requestSequence.current;
    setReady(false); setError('');
    try {
      const path = `/api/v1/movies/${encodeURIComponent(movieId)}`;
      const [own, vote] = await Promise.all([
        fetch(`${path}/contribution`, { cache: 'no-store' }).then(read<OwnContributionResult>),
        fetch(`${path}/family-vote`, { cache: 'no-store' }).then(read<OwnFamilyVoteResult>),
      ]);
      if (sequence !== requestSequence.current || ownerRef.current !== owner) return;
      setSaved(own.contribution); setFamily(vote.familyVote);
      if (!keepDraft) {
        let restored: Drafts = {}; let restoredFamily: number | null = null;
        try {
          const raw = sessionStorage.getItem(draftKey(movieId, owner));
          if (raw) {
            const stored = JSON.parse(raw) as { expiresAt: number; drafts: Drafts; familyDraft: number | null; revision: number; familyRevision: number };
            if (stored.expiresAt > Date.now() && stored.expiresAt <= Date.now() + 30 * 60_000 && stored.drafts && typeof stored.drafts === 'object') {
              for (const slug of CATEGORY_SLUGS) {
                const candidate = stored.drafts[slug];
                if (candidate && Number.isInteger(candidate.severity) && candidate.severity >= 0 && candidate.severity <= 5 && [0, 1, 2].includes(candidate.spoilerLevel) && Array.isArray(candidate.descriptors) && candidate.descriptors.length <= 8 && new Set(candidate.descriptors).size === candidate.descriptors.length && candidate.descriptors.every(id => WARNING_DESCRIPTOR_IDS[slug].includes(id))) restored[slug] = candidate.severity === 0 ? { severity: 0, spoilerLevel: 0, descriptors: [] } : candidate;
              }
              restoredFamily = Number.isInteger(stored.familyDraft) && stored.familyDraft! >= 1 && stored.familyDraft! <= 5 ? stored.familyDraft : null;
              if (stored.revision !== (own.contribution?.revision ?? 0) || stored.familyRevision !== (vote.familyVote?.revision ?? 0)) {
                setConflict(true); setRebaseReady(true); setMessage('Saved ratings changed since this draft began. Review the latest values and your draft, then choose Resume editing.');
              } else if (Object.keys(restored).length || restoredFamily !== null) setMessage('Your unsaved draft was restored.');
            } else sessionStorage.removeItem(draftKey(movieId, owner));
          }
        } catch { setStorageUnavailable(true); }
        setDrafts(restored); setFamilyDraft(restoredFamily);
      } else {
        setRebaseReady(true);
        setMessage('Latest saved ratings loaded. Review your pending choices before resuming.');
      }
      setReady(true);
    } catch (reason) {
      if (sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : 'Could not load your ratings.');
    }
  }, [movieId, owner, watched]);

  useEffect(() => {
    requestSequence.current++;
    ownerRef.current = owner;
    setSaved(null); setFamily(null); setDrafts({}); setFamilyDraft(null); setReady(false); setConflict(false); setRebaseReady(false); setMessage(''); setError(''); setConfirmDelete(false); retries.current.clear(); retryKeepDraft.current = false;
    if (owner && watched) void load();
    return () => { requestSequence.current++; };
  }, [owner, movieId, watched, load]);

  useEffect(() => {
    if (!owner || !ready) return;
    try {
      const key = draftKey(movieId, owner);
      if (Object.keys(drafts).length || familyDraft !== null) sessionStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + 30 * 60_000, revision: saved?.revision ?? 0, familyRevision: family?.revision ?? 0, drafts, familyDraft }));
      else sessionStorage.removeItem(key);
    } catch { setStorageUnavailable(true); }
  }, [owner, movieId, ready, drafts, familyDraft, saved?.revision, family?.revision]);

  const savedRating = (slug: CategorySlug) => saved?.ratings.find(rating => rating.category === slug);
  function edit(slug: CategorySlug, next: Draft | null) {
    const existing = savedRating(slug);
    setDrafts(current => editRating(current, slug, next, existing));
    setMessage(''); setError('');
  }
  function changeFamily(value: number) { setFamilyDraft(value === family?.value ? null : value); setMessage(''); setError(''); }
  const dirty = Object.keys(drafts).length > 0 || familyDraft !== null;

  async function mutation<T>(path: string, method: 'PATCH' | 'PUT' | 'DELETE', body: Record<string, unknown>, expectedOwner: string, scope: number): Promise<T> {
    const fresh = await refreshAuthSession();
    if (!fresh.user || fresh.user.id !== expectedOwner || ownerRef.current !== expectedOwner || requestSequence.current !== scope) throw new Error('Your sign-in or movie changed. Reload before contributing.');
    const encoded = JSON.stringify(body);
    const identity = `${path}:${method}:${encoded}`;
    const key = retries.current.get(identity);
    const result = await read<T>(await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': fresh.csrfToken, 'Idempotency-Key': key }, body: encoded }));
    retries.current.confirmed(identity);
    return result;
  }

  async function save() {
    if (inFlight.current || !owner || !watched || !ready || !dirty || conflict) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    const scope = requestSequence.current;
    let vote = family; let completed = 0;
    try {
      const batch = await saveChangedCategories(ORDER, drafts, saved,
        async (slug, draft, expectedRevision) => (await mutation<OwnContributionResult>(`/api/v1/movies/${encodeURIComponent(movieId)}/warnings`, 'PATCH', { expectedRevision, watched: true, category: slug, ...draft }, owner, scope)).contribution,
        (slug, contribution) => { setSaved(contribution); setDrafts(current => editRating(current, slug, null)); },
        () => requestSequence.current === scope && ownerRef.current === owner);
      completed = batch.completed;
      if (batch.interrupted) return;
      if (familyDraft !== null) {
        if (requestSequence.current !== scope || ownerRef.current !== owner) return;
        const result = await mutation<OwnFamilyVoteResult>(`/api/v1/movies/${encodeURIComponent(movieId)}/family-vote`, 'PUT', { expectedRevision: vote?.revision ?? 0, watched: true, value: familyDraft }, owner, scope);
        if (requestSequence.current !== scope || ownerRef.current !== owner) return;
        vote = result.familyVote; setFamily(vote); setFamilyDraft(null); completed++;
      }
      setMessage('Your ratings are saved. Unrated topics remain unassessed.');
      onSaved?.();
    } catch (reason) {
      if (requestSequence.current !== scope || ownerRef.current !== owner) return;
      const failure = reason instanceof PartialSaveError ? reason.cause : reason;
      completed = reason instanceof PartialSaveError ? reason.completed : completed;
      if (failure instanceof RequestError && failure.status === 409) { setConflict(true); setRebaseReady(false); retries.current.clear(); }
      const detail = failure instanceof Error ? failure.message : 'Could not save. Retry your remaining draft.';
      setError(`${completed ? `${completed} ${completed === 1 ? 'change was' : 'changes were'} saved. The remaining choices are still in your draft. ` : ''}${detail}${failure instanceof RequestError && failure.status === 409 ? ' Load the latest ratings to review your draft before trying again.' : ''}`);
    } finally { inFlight.current = false; setBusy(false); if (completed > 0 && requestSequence.current === scope && ownerRef.current === owner) onChanged(); }
  }

  async function removeAll() {
    if (inFlight.current || !owner || !saved || !watched || conflict) return;
    inFlight.current = true; setBusy(true); setError('');
    const scope = requestSequence.current;
    try {
      await mutation<void>(`/api/v1/movies/${encodeURIComponent(movieId)}/contribution`, 'DELETE', { expectedRevision: saved.revision }, owner, scope);
      if (requestSequence.current !== scope || ownerRef.current !== owner) return;
      setSaved(null); setDrafts({}); setConfirmDelete(false); setMessage('Your content assessment was deleted. Your family vote and separate notes remain.'); onChanged();
    } catch (reason) { if (requestSequence.current !== scope || ownerRef.current !== owner) return; if (reason instanceof RequestError && reason.status === 409) { setConflict(true); setRebaseReady(false); } setError(reason instanceof Error ? reason.message : 'Could not delete your assessment.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const login = `/login/?next=${encodeURIComponent(`/movies/${movieId}/#contribute`)}`;
  return <section className="unified-contribution" aria-labelledby="unified-title"><header className="unified-heading"><span className="label">A VIEWER’S PERSPECTIVE</span><h2 id="unified-title">Your movie experience</h2><p>Rate only what you know. Skip the rest.</p></header>
    {authLoading ? <p role="status">Checking sign-in…</p> : authError ? <p role="alert">{authError}</p> : !owner ? <p className="mvp-notice">Sign in to add your experience. <Link href={login}>Sign in to contribute →</Link></p> : !watched ? <p>Mark this film as watched to contribute.</p> : <>
      {error ? <p className="mvp-notice mvp-error" role="alert">{error}</p> : null}{message ? <p className="mvp-notice" role="status">{message}</p> : null}
      {!ready ? <button type="button" className="mvp-secondary" onClick={() => void load(retryKeepDraft.current)} disabled={busy || !error}>{error ? 'Retry loading ratings' : 'Loading your ratings…'}</button> : <div>
        <p className="fine">Not rated means unassessed. None means you observed no content in that topic. Intensity describes presentation, not suitability.</p>
        <div className="unified-family-card"><h3>👨‍👩‍👧 Watch with your parents?</h3><p>How awkward would family movie night be?</p><div className="unified-family-options" role="group" aria-label="Family movie night opinion">{FAMILY_COPY.map((copy, index) => { const value = index + 1; const selected = (familyDraft ?? family?.value) === value; return <button type="button" key={value} aria-pressed={selected} data-level={value} disabled={busy || conflict} onClick={() => changeFamily(value)}><strong>{value}</strong><span>{copy}</span></button>; })}</div><p className="fine">A subjective opinion about watching together. Representation alone does not determine awkwardness. {familyDraft !== null ? 'Unsaved change.' : family ? 'Saved vote.' : 'Not rated.'}</p>{familyDraft !== null ? <button type="button" className="unified-reset" onClick={() => setFamilyDraft(null)} disabled={busy}>{family ? 'Reset to saved vote' : 'Clear new selection'}</button> : null}</div>
        <div className="unified-grid">{ORDER.map(slug => { const original = savedRating(slug); const value = drafts[slug] ?? (original ? draftFrom(original) : null); const changed = !!drafts[slug]; return <article className="unified-card" key={slug} aria-labelledby={`category-${slug}`}><div className="unified-card-top"><h3 id={`category-${slug}`}>{META[slug].title}</h3><span className={changed ? 'unified-state is-draft' : 'unified-state'}>{changed ? 'Unsaved' : original ? 'Saved' : 'Not rated'}</span></div><p className="unified-description">{META[slug].description}</p><div className="unified-chips" role="group" aria-label={`${META[slug].title} intensity`}>{LEVELS.map((level, index) => <button type="button" key={level} aria-pressed={value?.severity === index} disabled={busy || conflict} onClick={() => edit(slug, { severity: index as Severity, spoilerLevel: index === 0 ? 0 : value?.spoilerLevel ?? 0, descriptors: index === 0 ? [] : value?.descriptors ?? [] })}>{level}</button>)}</div>{changed ? <button className="unified-reset" type="button" disabled={busy} onClick={() => edit(slug, null)}>{original ? 'Reset to saved rating' : 'Clear new selection'}</button> : null}<details className="unified-details"><summary>Optional details{original?.descriptors?.length ? ` · ${original.descriptors.length} saved` : ''}</summary>{value ? <><fieldset disabled={busy || conflict || value.severity === 0}><legend>Specific content observed</legend><div className="unified-descriptors">{WARNING_DESCRIPTOR_IDS[slug].length ? WARNING_DESCRIPTOR_IDS[slug].map(id => <label key={id}><input type="checkbox" checked={value.descriptors.includes(id)} onChange={event => edit(slug, { ...value, descriptors: event.target.checked ? [...value.descriptors, id] : value.descriptors.filter(item => item !== id) })}/>{id.replaceAll('_', ' ')}</label>) : <p className="fine">No specific descriptor choices for this topic.</p>}</div></fieldset><label className="unified-spoiler">Spoiler protection<select value={value.spoilerLevel} disabled={busy || conflict} onChange={event => edit(slug, { ...value, spoilerLevel: Number(event.target.value) as WarningSpoilerLevel })}><option value={0}>No spoiler</option><option value={1}>Hide description</option><option value={2}>Hide category and description</option></select></label></> : <p className="fine">Choose an intensity to add details.</p>}{original ? <MovieStory movieId={movieId} title={title} posterPath={posterPath} backdropPath={backdropPath} year={year} genres={genres} warning={original} ownFamilyValue={family?.value}/> : null}<CategoryOwnNotes movieId={movieId} category={slug} watched={watched} onChanged={onChanged}/></details></article>; })}</div>
        {conflict ? <div className="mvp-notice" role="group" aria-label="Review changed ratings"><p>Your draft is preserved. Load current saved ratings, compare them with your choices, then resume editing.</p><button type="button" className="mvp-secondary" disabled={busy} onClick={() => { setRebaseReady(false); void load(true); }}>Load latest saved ratings</button><button type="button" className="mvp-secondary" disabled={busy || !rebaseReady} onClick={() => { setConflict(false); setRebaseReady(false); setMessage('Review complete. Your pending choices are ready to save.'); }}>Resume editing</button></div> : null}
        <div className="unified-actions"><button type="button" className="button" disabled={busy || conflict || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save ratings'}</button>{dirty ? <button type="button" className="mvp-secondary" disabled={busy} onClick={() => { setDrafts({}); setFamilyDraft(null); retries.current.clear(); setMessage('Unsaved choices discarded.'); }}>Discard draft</button> : null}{saved ? <button type="button" className="mvp-danger" disabled={busy || conflict} onClick={() => setConfirmDelete(true)}>Delete my content assessment</button> : null}</div><p className="fine">Notes and scene entries have their own Save note action inside each card. {storageUnavailable ? 'Temporary draft storage is unavailable; keep this tab open while editing.' : 'Unsaved rating choices stay in this tab for up to 30 minutes.'}</p>
        {confirmDelete ? <div className="mvp-notice" role="group" aria-label="Confirm deleting content assessment"><p>Delete your entire content assessment for this film, including representation details? Your separate family vote and scene notes remain.</p><button className="mvp-danger" type="button" disabled={busy} onClick={() => void removeAll()}>Confirm deletion</button><button className="mvp-secondary" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep assessment</button></div> : null}
      </div>}
    </>}
  </section>;
}
