'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { refreshAuthSession } from '../lib/supabase/browser';

export const CATEGORIES = [
  { slug: 'nudity', label: 'Nudity', guidance: 'Exposed bodies. Assess presentation and duration.' },
  { slug: 'sexual_content', label: 'Sexual content', guidance: 'Sexual activity or references. Assess intensity and detail.' },
  { slug: 'sexual_violence', label: 'Sexual violence', guidance: 'Threats, coercion or assault. Mild: references; Moderate: non-graphic depiction; Severe: explicit or prolonged depiction.' },
  { slug: 'gore_graphic_violence', label: 'Gore / disturbing visuals', guidance: 'Stomach-turning visuals and graphic injuries. Earlier reports also included blood and graphic violence.' },
  { slug: 'disturbing_content', label: 'Disturbing content', guidance: 'Intense distress outside the other categories.' },
  { slug: 'suicide_self_harm', label: 'Suicide / self-harm', guidance: 'Mild: indirect references; Moderate: non-graphic depiction; Severe: explicit or prolonged depiction.' },
] as const;
export type CategorySlug = typeof CATEGORIES[number]['slug'];
export type Severity = 0 | 1 | 2 | 3 | 4 | 5;
export const SEVERITY_LABELS = ['None', 'Mild', 'Moderate', 'Severe', 'Very severe', 'Extreme'] as const;
type Selections = Partial<Record<CategorySlug, Severity>>;
type Contribution = { revision: number; ratings: { category: CategorySlug; severity: Severity }[]; watched: true };
type Session = { user: { id: string; nickname: string } | null; csrfToken: string; configured: boolean; passwordEnabled: boolean };
type Draft = { version: 1; movieId: string; owner: string; expiresAt: number; baseRevision: number; selections: Selections };
const DRAFT_PREFIX = 'triggerboxd:contribution:v1:';

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    let message = result?.error?.message || 'This request could not be completed. Please retry.';
    if (response.status === 503) message = 'Real contributions are awaiting service setup. Your draft has not been published.';
    if (response.status === 429) {
      const delay = response.headers.get('Retry-After');
      message = `You’ve made several requests. Please wait${delay && /^\d+$/.test(delay) ? ` ${delay} seconds` : ' a little'} before retrying.`;
    }
    throw new RequestError(response.status, result?.error?.code ?? 'REQUEST_FAILED', message);
  }
  if (!result || !('data' in result)) throw new Error('The service returned an incomplete response. Please retry.');
  return result.data as T;
}

function clearDrafts() {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(key);
  } catch { /* Storage may be disabled; memory-only editing still works. */ }
}

function selectionsFrom(ratings: Contribution['ratings']): Selections {
  const selections: Selections = {};
  for (const rating of ratings) {
    if (CATEGORIES.some(category => category.slug === rating.category) && Number.isInteger(rating.severity) && rating.severity >= 0 && rating.severity <= 5) selections[rating.category] = rating.severity;
  }
  return selections;
}

export function RealContribution({ movieId, onChanged, watched = false }: { movieId: string; onChanged: () => void; watched?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [contribution, setContribution] = useState<Contribution | null>(null);
  const [selections, setSelections] = useState<Selections>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const owner = useRef<string | null | undefined>(undefined);
  const loaded = useRef(false);
  const attempt = useRef<{ method: 'PUT' | 'DELETE'; body: string; key: string } | null>(null);
  const activeMutation = useRef(false);
  const loadSequence = useRef(0);
  const draftKey = DRAFT_PREFIX + movieId;

  const load = useCallback(async (replaceDraft = false) => {
    if (activeMutation.current) return;
    const sequence = ++loadSequence.current;
    setError('');
    try {
      const nextSession = await refreshAuthSession();
      if (sequence !== loadSequence.current) return;
      const nextOwner = nextSession.user?.id ?? null;
      const switched = owner.current !== undefined && owner.current !== nextOwner;
      if (switched) {
        clearDrafts();
        setSelections({}); setDirty(false); setMessage(''); setContribution(null);
        setConflict(false); setConfirmDelete(false); attempt.current = null; loaded.current = false;
      }
      owner.current = nextOwner;
      setSession(nextSession);
      if (!nextOwner || !nextSession.configured) { setReady(true); return; }
      if (loaded.current && !replaceDraft) return;
      setReady(false);
      const data = await fetch(`/api/v1/movies/${encodeURIComponent(movieId)}/contribution`, { cache: 'no-store' }).then(readResponse<{ contribution: Contribution | null }>);
      if (sequence !== loadSequence.current) return;
      const saved = data.contribution;
      setContribution(saved);
      setSelections(saved ? selectionsFrom(saved.ratings) : {});
      
      setDirty(false); setConflict(false); setConfirmDelete(false); attempt.current = null;
      try {
        if (replaceDraft) sessionStorage.removeItem(draftKey);
        else {
          const raw = sessionStorage.getItem(draftKey);
          if (raw) {
            const draft = JSON.parse(raw) as Draft;
            const valid = draft.version === 1 && draft.movieId === movieId && draft.owner === nextOwner && draft.expiresAt > Date.now() && draft.expiresAt <= Date.now() + 30 * 60_000 && typeof draft.selections === 'object' && draft.selections !== null;
            if (valid && draft.baseRevision === (saved?.revision ?? 0)) {
              const ratings = Object.entries(draft.selections).map(([category, severity]) => ({ category: category as CategorySlug, severity }));
              setSelections(selectionsFrom(ratings)); setDirty(true);
              setMessage('Your temporary draft was restored.');
            } else if (valid) {
              setMessage('Your saved contribution changed after this draft was started. The latest saved assessment is loaded; the older draft was discarded.');
              sessionStorage.removeItem(draftKey);
            } else sessionStorage.removeItem(draftKey);
          }
        }
      } catch { setStorageUnavailable(true); }
      loaded.current = true;
      setReady(true);
    } catch (reason) {
      if (sequence !== loadSequence.current) return;
      if (reason instanceof RequestError && reason.status === 401) { clearDrafts(); setSession(null); setContribution(null); setSelections({}); setDirty(false); loaded.current = false; }
      setError(reason instanceof Error ? reason.message : 'We couldn’t check your contribution. Please retry.');
    }
  }, [draftKey, movieId]);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const accountChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ previousUserId?: string | null; userId?: string | null }>).detail;
      if (detail?.previousUserId && detail.previousUserId !== detail.userId) {
        clearDrafts(); loaded.current = false; attempt.current = null;
        setSelections({}); setDirty(false); setContribution(null); setMessage('');
        owner.current = detail.userId ?? null; setReady(false);
        setSession(current => current && !detail.userId ? { ...current, user: null } : null);
      }
      void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('triggerboxd:account-change', accountChanged);
    return () => { loadSequence.current++; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('triggerboxd:account-change', accountChanged); };
  }, [load]);

  useEffect(() => {
    if (!ready || !dirty || !session?.user) return;
    const draft: Draft = { version: 1, movieId, owner: session.user.id, expiresAt: Date.now() + 30 * 60_000, baseRevision: contribution?.revision ?? 0, selections };
    try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch { setStorageUnavailable(true); }
  }, [ready, dirty, session?.user, movieId, draftKey, contribution?.revision, selections]);

  function updateSelection(category: CategorySlug, value: string) {
    setSelections(current => {
      const next = { ...current };
      if (value === 'unknown') delete next[category];
      else next[category] = Number(value) as Severity;
      return next;
    });
    setDirty(true); setMessage(''); setError('');
  }

  function discard() {
    try { sessionStorage.removeItem(draftKey); } catch { /* No saved draft. */ }
    setSelections(contribution ? selectionsFrom(contribution.ratings) : {});
    setDirty(false); setMessage('Draft discarded.'); setError(''); attempt.current = null;
  }

  async function mutate(method: 'PUT' | 'DELETE') {
    if (activeMutation.current || conflict) return;
    const ratings = CATEGORIES.flatMap(({ slug }) => selections[slug] === undefined ? [] : [{ category: slug, severity: selections[slug] }]);
    if (method === 'PUT' && !watched) { setError('Confirm that you watched this film before publishing.'); return; }
    if (method === 'PUT' && ratings.length === 0) { setError(contribution ? 'Choose at least one assessment, or delete your contribution to remove all ratings.' : 'Choose at least one assessment. Unknown categories are left unanswered.'); return; }
    const body = JSON.stringify(method === 'PUT' ? { expectedRevision: contribution?.revision ?? 0, watched: true, ratings } : { expectedRevision: contribution?.revision ?? 0 });
    if (!attempt.current || attempt.current.method !== method || attempt.current.body !== body) attempt.current = { method, body, key: crypto.randomUUID() };
    activeMutation.current = true; setBusy(true); setError(''); setMessage('');
    let saved = false;
    try {
      const freshSession = await refreshAuthSession();
      if (!freshSession.user || freshSession.user.id !== owner.current) {
        clearDrafts(); setSession(freshSession); setSelections({}); setDirty(false); setContribution(null); setReady(false); loaded.current = false; owner.current = freshSession.user?.id ?? null; attempt.current = null;
        throw new Error('Your sign-in changed. Please sign in again and reload your contribution.');
      }
      setSession(freshSession);
      const response = await fetch(`/api/v1/movies/${encodeURIComponent(movieId)}/contribution`, {
        method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': freshSession.csrfToken, 'Idempotency-Key': attempt.current!.key }, body,
      });
      await readResponse<unknown>(response);
      saved = true;
      if (freshSession.user.id !== owner.current) { onChanged(); throw new Error('Your account changed while the request completed.'); }
      try { sessionStorage.removeItem(draftKey); } catch { /* Memory state is cleared below too. */ }
      setDirty(false); attempt.current = null; setConfirmDelete(false);
      setMessage(method === 'DELETE' ? 'Your contribution was deleted.' : 'Your assessment was published. Unanswered categories remain Unknown.');
      onChanged();
      if (method === 'DELETE') { setContribution(null); setSelections({}); }
      else {
        const data = await fetch(`/api/v1/movies/${encodeURIComponent(movieId)}/contribution`, { cache: 'no-store' }).then(readResponse<{ contribution: Contribution | null }>);
        setContribution(data.contribution); setSelections(data.contribution ? selectionsFrom(data.contribution.ratings) : {}); 
      }
    } catch (reason) {
      if (saved) { setReady(false); loaded.current = false; setError('Your change was saved, but we couldn’t reload its latest revision. Reload before editing again.'); }
      else if (reason instanceof RequestError && reason.status === 409) { setConflict(true); attempt.current = null; setError('This contribution changed in another request. Load the latest saved assessment before making another change.'); }
      else if (reason instanceof RequestError && reason.status === 401) { clearDrafts(); setSession(current => current ? { ...current, user: null } : null); setDirty(false); setSelections({}); setContribution(null); loaded.current = false; setError('Your session ended. Sign in again before contributing.'); }
      else setError(reason instanceof Error ? reason.message : 'Could not connect. Your draft is still here. Retry to send the same request safely.');
    } finally { activeMutation.current = false; setBusy(false); if (!loaded.current && owner.current !== session?.user?.id) void load(); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void mutate('PUT'); }
  const loginUrl = `/login/?next=${encodeURIComponent(`/movies/${movieId}/#contribute`)}`;

  return <section id="full-contribution" className="mvp-contribution" aria-labelledby="contribute-title">
    <span className="label">A VIEWER’S PERSPECTIVE</span><h2 id="contribute-title">{contribution ? 'Your contribution' : 'Your assessment'}</h2>
    <p className="muted">Share content intensity without revealing the story. You can edit or delete your own assessment. Different cuts of a film can differ.</p>
    {message ? <p role="status" className="mvp-notice">{message}</p> : null}
    {error ? <div role="alert" className="mvp-notice mvp-error"><p>{error}</p>{!ready || conflict || !session ? <button className="mvp-secondary" disabled={busy} type="button" onClick={() => void load(conflict)}> {conflict ? 'Load latest saved assessment' : 'Retry loading'}</button> : null}{conflict ? <p className="fine">Loading the latest assessment replaces your current draft.</p> : null}</div> : null}
    {session && !session.configured ? <p className="mvp-notice">Real contributions are awaiting sign-in and database setup.</p> : ready && session && !session.user ? <div className="mvp-notice"><p>Sign in to publish a watched-film assessment.</p><Link className="button" href={loginUrl}>Sign in to contribute →</Link></div> : !ready ? <p role="status">{error ? 'Your contribution could not be loaded.' : 'Checking your contribution…'}</p> : session?.user && !watched ? <p className="fine">Mark this film as watched to contribute.</p> : session?.user ? <form onSubmit={submit}>
      <p className="fine">Unknown means you have not assessed a category. None is an explicit report of no content. Labels describe presentation, not the seriousness of real harm or age suitability.</p>
      <details className="mvp-guidance"><summary>What do the intensity labels mean?</summary><dl><div><dt>None</dt><dd>No content in this category.</dd></div><div><dt>Mild</dt><dd>Brief, indirect or non-graphic presence.</dd></div><div><dt>Moderate</dt><dd>Clear, sustained or repeated presence, with limited graphic detail.</dd></div><div><dt>Severe</dt><dd>Explicit, graphic, prolonged or strongly distressing depiction.</dd></div></dl></details>
      <div className="mvp-category-fields">{CATEGORIES.map(category => <fieldset key={category.slug} disabled={busy || conflict || !watched} aria-describedby={`guidance-${category.slug}`}><legend>{category.label}</legend><p className="fine" id={`guidance-${category.slug}`}>{category.guidance}</p><div className="mvp-rating-options">{(['unknown', '0', '1', '2', '3'] as const).map(value => {
        const selectedValue = selections[category.slug] === undefined ? 'unknown' : String(selections[category.slug]);
        return <label key={value} className={selectedValue === value ? 'is-selected' : ''}><input type="radio" name={`rating-${category.slug}`} value={value} checked={selectedValue === value} onChange={() => updateSelection(category.slug, value)} /><span>{value === 'unknown' ? 'Unknown' : SEVERITY_LABELS[Number(value)]}</span></label>;
      })}</div></fieldset>)}</div>
      <p className="fine">Draft selections are kept in this tab for up to 30 minutes, linked to your signed-in account. They clear after publishing, discarding or signing out.{storageUnavailable ? ' Temporary storage is unavailable; your draft may be lost if you leave this page.' : ''}</p>
      <div className="mvp-actions"><button className="button" type="submit" disabled={busy || conflict || !watched}>{busy ? 'Saving…' : contribution ? 'Save changes' : 'Save assessment'}</button><button className="mvp-secondary" type="button" disabled={busy || !dirty} onClick={discard}>Discard draft</button>{contribution ? <button className="mvp-danger" type="button" disabled={busy || conflict || !watched} onClick={() => setConfirmDelete(true)}>Delete my contribution</button> : null}</div>
      {confirmDelete ? <div className="mvp-notice" role="group" aria-label="Confirm contribution deletion"><p>Delete your full assessment, including its representation details, for this film? The public guide will update after deletion.</p><div className="mvp-actions"><button className="mvp-danger" type="button" disabled={busy || conflict || !watched} onClick={() => void mutate('DELETE')}>Confirm deletion</button><button className="mvp-secondary" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep contribution</button></div></div> : null}
    </form> : null}
  </section>;
}
