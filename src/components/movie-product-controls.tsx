'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CATEGORY_SLUGS, WARNING_DESCRIPTOR_IDS, type CategorySlug, type OwnContributionResult, type OwnFamilyVoteResult } from '../lib/contracts';
import { refreshAuthSession, useAuthSession } from '../lib/supabase/browser';
import type { MovieWarning } from './movie-warnings';

export const categoryName = (slug: string) => slug.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());

async function request<T>(url: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const session = method === 'GET' ? null : await refreshAuthSession();
  const response = await fetch(url, { method, cache: 'no-store', headers: method === 'GET' ? undefined : {
    'Content-Type': 'application/json', 'X-CSRF-Token': session!.csrfToken, ...(key ? { 'Idempotency-Key': key } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message ?? 'Request failed. Please retry.');
  return result.data as T;
}

export function SelectiveReveal({ movieId, onReveal }: { movieId: string; onReveal: (warning: MovieWarning) => void }) {
  const [category, setCategory] = useState<CategorySlug>('nudity');
  const [level, setLevel] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [checked, setChecked] = useState<MovieWarning | null>(null);
  async function reveal(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage('');
    try {
      const result = await request<{ warnings: MovieWarning[] }>(`/api/v1/movies/${movieId}/reveal`, 'POST', { categories: [category], level });
      const warning = result.warnings.find(item => item.category === category);
      if (warning) { onReveal(warning); setChecked(warning); }
      setMessage('Selected category checked. Unassessed information remains Unknown.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not reveal information.'); }
    finally { setBusy(false); }
  }
  return <details className="mvp-product-details"><summary>Check a category / reveal selected details</summary><p className="fine">Available for every category. Revealing may disclose plot information. Nothing else is revealed.</p><form className="mvp-compact-form" onSubmit={reveal}><label>Category<select value={category} onChange={e => { setCategory(e.target.value as CategorySlug); setChecked(null); setMessage(""); }}>{CATEGORY_SLUGS.map(slug => <option key={slug} value={slug}>{categoryName(slug)}</option>)}</select></label><label>Reveal level<select value={level} onChange={e => setLevel(Number(e.target.value))}><option value={1}>Descriptions only</option><option value={2}>Category and descriptions</option></select></label><button className="mvp-secondary" disabled={busy}>{busy ? 'Checking…' : 'Reveal selected category'}</button></form>{checked ? <p className="fine">{categoryName(checked.category)} · {checked.severity === null ? "Not shown · Check" : ["None", "Mild", "Moderate", "Severe"][checked.severity]}{checked.descriptors?.length ? ` · ${checked.descriptors.map(categoryName).join(" · ")}` : ""}</p> : null}{message ? <p role="status" className="fine">{message}</p> : null}</details>;
}

export function SynopsisReveal({ movieId }: { movieId: string }) {
  const [synopsis, setSynopsis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function reveal() {
    setBusy(true); setMessage('');
    try { const result = await request<{ synopsis: string | null }>(`/api/v1/movies/${movieId}/synopsis`, 'POST', { reveal: true }); setSynopsis(result.synopsis); if (!result.synopsis) setMessage('Synopsis unavailable.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load synopsis.'); }
    finally { setBusy(false); }
  }
  return <section className="mvp-product-details"><button type="button" className="mvp-secondary" disabled={busy} onClick={() => synopsis ? setSynopsis(null) : void reveal()}>{busy ? 'Loading…' : synopsis ? 'Hide synopsis' : 'Show synopsis · may reveal plot'}</button>{synopsis ? <p>{synopsis}</p> : null}{message ? <p role="status">{message}</p> : null}</section>;
}

export function QuickContribution({ movieId, onChanged }: { movieId: string; onChanged: () => void }) {
  const { session, loading, error } = useAuthSession();
  return <section id="contribute" className="mvp-quick-contribution"><h2>Add a warning</h2><p className="fine">One category at a time. Existing assessments are kept.</p>{loading ? <p role="status">Checking sign-in…</p> : error ? <p role="alert">{error}</p> : session?.user ? <QuickForm key={session.user.id + movieId} movieId={movieId} onChanged={onChanged} /> : <Link className="button" href={`/login/?next=${encodeURIComponent(`/movies/${movieId}/#contribute`)}`}>Sign in to contribute</Link>}</section>;
}

function QuickForm({ movieId, onChanged }: { movieId: string; onChanged: () => void }) {
  const [category, setCategory] = useState<CategorySlug>('nudity');
  const [severity, setSeverity] = useState('');
  const [spoilerLevel, setSpoilerLevel] = useState(0);
  const [descriptors, setDescriptors] = useState<string[]>([]);
  const [watched, setWatched] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [family, setFamily] = useState<OwnFamilyVoteResult['familyVote']>(null);
  const [familyReady, setFamilyReady] = useState(false);
  const [familyValue, setFamilyValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const attempt = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    let ignore = false;
    Promise.all([request<OwnContributionResult>(`/api/v1/movies/${movieId}/contribution`), request<OwnFamilyVoteResult>(`/api/v1/movies/${movieId}/family-vote`)]).then(([own, vote]) => {
      if (ignore) return; setRevision(own.contribution?.revision ?? 0); setFamily(vote.familyVote); setFamilyValue(vote.familyVote ? String(vote.familyVote.value) : ''); setFamilyReady(true);
    }).catch(error => { if (!ignore) setMessage(error.message); });
    return () => { ignore = true; };
  }, [movieId]);
  async function save(event: FormEvent, isFamily = false) {
    event.preventDefault(); if (busy || !watched || (isFamily ? !familyReady || !familyValue : revision === null || severity === '')) return;
    setBusy(true); setMessage('');
    const body = isFamily ? { expectedRevision: family?.revision ?? 0, watched: true, value: Number(familyValue) } : { expectedRevision: revision, watched: true, category, severity: Number(severity), spoilerLevel, descriptors };
    const encoded = JSON.stringify({ isFamily, body });
    if (!attempt.current || attempt.current.body !== encoded) attempt.current = { body: encoded, key: crypto.randomUUID() };
    try {
      if (isFamily) { const result = await request<OwnFamilyVoteResult>(`/api/v1/movies/${movieId}/family-vote`, 'PUT', body, attempt.current.key); setFamily(result.familyVote); onChanged(); }
      else { const result = await request<OwnContributionResult>(`/api/v1/movies/${movieId}/warnings`, 'PATCH', body, attempt.current.key); setRevision(result.contribution?.revision ?? null); onChanged(); }
      attempt.current = null; setMessage(isFamily ? 'Your family vote was saved. It is your opinion, not community consensus.' : 'Warning saved. Your other categories are unchanged.');
    } catch (error) {
      setMessage((error instanceof Error ? error.message : 'Could not save.') + ' Reload saved data before editing if it changed in another tab.');
    } finally { setBusy(false); }
  }
  return <><label className="mvp-confirm"><input type="checkbox" checked={watched} onChange={e => setWatched(e.target.checked)} />I have watched this film.</label><form className="mvp-compact-form" onSubmit={save}><label>Category<select value={category} onChange={e => { setCategory(e.target.value as CategorySlug); setDescriptors([]); setSeverity(''); setSpoilerLevel(0); }} disabled={busy}>{CATEGORY_SLUGS.map(slug => <option key={slug} value={slug}>{categoryName(slug)}</option>)}</select></label><label>Intensity<select value={severity} onChange={e => { setSeverity(e.target.value); if (e.target.value === '0') setDescriptors([]); }} disabled={busy}><option value="">Choose intensity</option>{['None', 'Mild', 'Moderate', 'Severe'].map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label><label>Spoiler protection<select value={spoilerLevel} onChange={e => setSpoilerLevel(Number(e.target.value))} disabled={busy}><option value={0}>No spoiler</option><option value={1}>Hide descriptions</option><option value={2}>Hide category and descriptions</option></select></label>{WARNING_DESCRIPTOR_IDS[category].length ? <fieldset className="mvp-descriptor-options" disabled={busy || severity === '0' || severity === ''}><legend>Optional details · select only what you observed</legend>{WARNING_DESCRIPTOR_IDS[category].map(id => <label key={id}><input type="checkbox" checked={descriptors.includes(id)} onChange={e => setDescriptors(current => e.target.checked ? [...current, id] : current.filter(item => item !== id))} />{categoryName(id)}</label>)}</fieldset> : null}<button className="button" disabled={busy || !watched || revision === null || severity === ''}>{busy ? 'Saving…' : 'Save this warning'}</button></form><form className="mvp-family-form" onSubmit={e => void save(e, true)}><label>Your family awkwardness vote<select value={familyValue} onChange={e => setFamilyValue(e.target.value)} disabled={busy}><option value="">Choose your opinion</option><option value={1}>1 · Comfortable</option><option value={2}>2 · A little awkward</option><option value={3}>3 · Some awkward silences</option><option value={4}>4 · Very awkward</option><option value={5}>5 · Extremely awkward</option></select></label><button className="mvp-secondary" disabled={busy || !watched || !familyReady || !familyValue}>Save my family vote</button><p className="fine">Separate subjective opinion. Check community family opinions in the first question above.</p></form>{message ? <p role="status">{message}</p> : null}<button type="button" className="mvp-secondary" disabled={busy} onClick={() => { setRevision(null); setFamilyReady(false); void Promise.all([request<OwnContributionResult>(`/api/v1/movies/${movieId}/contribution`), request<OwnFamilyVoteResult>(`/api/v1/movies/${movieId}/family-vote`)]).then(([own, vote]) => { setRevision(own.contribution?.revision ?? 0); setFamily(vote.familyVote); setFamilyReady(true); setMessage('Latest saved revisions loaded.'); }).catch(error => setMessage(error.message)); }}>Reload saved data</button></>;
}
