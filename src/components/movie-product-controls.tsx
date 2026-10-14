'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CATEGORY_SLUGS, WARNING_DESCRIPTOR_IDS, type CategoryRating, type CategorySlug, type OwnContributionResult, type OwnFamilyVoteResult } from '../lib/contracts';
import { refreshAuthSession, useAuthSession } from '../lib/supabase/browser';
import { FAMILY_AWKWARDNESS_LEVELS } from '../lib/signature-questions';
import { getFamilyAwkwardnessVerdict } from '../lib/signature-questions';
import {MovieStory} from './movie-story';
import type { MovieWarning } from './movie-warnings';

export const categoryName = (slug: string) => slug.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());

export type CategoryDraft = { severity: string; spoilerLevel: number; descriptors: string[] };
export const emptyDraft: CategoryDraft = { severity: '', spoilerLevel: 0, descriptors: [] };

export function storeCategoryDraft(drafts: Partial<Record<CategorySlug, CategoryDraft>>, category: CategorySlug, draft: CategoryDraft): Partial<Record<CategorySlug, CategoryDraft>> {
  return { ...drafts, [category]: draft };
}

export function clearCategoryDraft(drafts: Partial<Record<CategorySlug, CategoryDraft>>, category: CategorySlug): Partial<Record<CategorySlug, CategoryDraft>> {
  const rest = { ...drafts }; delete rest[category]; return rest;
}

export function applyCategoryDraft(draft: CategoryDraft | undefined, saved: Pick<CategoryRating, 'severity' | 'spoilerLevel' | 'descriptors'> | undefined): CategoryDraft {
  if (draft) return draft;
  if (!saved || typeof saved.severity !== 'number') return emptyDraft;
  return { severity: String(saved.severity), spoilerLevel: saved.spoilerLevel ?? 0, descriptors: saved.descriptors ?? [] };
}

async function request<T>(url: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const session = method === 'GET' ? null : await refreshAuthSession();
  const response = await fetch(url, { method, cache: 'no-store', headers: method === 'GET' ? undefined : {
    'Content-Type': 'application/json', 'X-CSRF-Token': session!.csrfToken, ...(key ? { 'Idempotency-Key': key } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message ?? 'Request failed. Please retry.');
  return result.data as T;
}

export function SelectiveReveal({ movieId, onReveal, onHide }: { movieId: string; onReveal: (warning: MovieWarning) => void; onHide: () => void }) {
  const [category,setCategory]=useState<CategorySlug>('nudity');
  const [level,setLevel]=useState(2),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [checked,setChecked]=useState<MovieWarning|null>(null);
  const sequence=useRef(0);
  useEffect(()=>()=>{sequence.current++;},[]);
  function hide(){sequence.current++;setChecked(null);setMessage('');setBusy(false);onHide();}
  async function reveal(event:FormEvent){
    event.preventDefault();if(busy)return;
    const current=++sequence.current;setBusy(true);setMessage('');
    try{
      const result=await request<{warnings:MovieWarning[]}>(`/api/v1/movies/${movieId}/reveal`,'POST',{categories:[category],level});
      if(current!==sequence.current)return;
      const warning=result.warnings.find(item=>item.category===category);
      if(warning){onReveal(warning);setChecked(warning);}
    }catch(e){if(current===sequence.current)setMessage(e instanceof Error?e.message:'Could not check this topic.');}
    finally{if(current===sequence.current)setBusy(false);}
  }
  return <details className="mvp-product-details" onToggle={event=>{if(!event.currentTarget.open)hide();}}><summary>Other topics &amp; spoiler settings</summary>
    <p className="fine">Choose a topic to check. </p>
    <form className="mvp-compact-form" onSubmit={reveal}>
      <label>Topic<select disabled={busy} value={category} onChange={e=>{hide();setCategory(e.target.value as CategorySlug);}}>{CATEGORY_SLUGS.map(slug=><option key={slug} value={slug}>{categoryName(slug)}</option>)}</select></label>
      <label>Include<select disabled={busy} value={level} onChange={e=>{hide();setLevel(Number(e.target.value));}}><option value={1}>Descriptions (keep category spoilers hidden)</option><option value={2}>All reports for this topic</option></select></label>
      <button className="mvp-secondary" disabled={busy}>{busy?'Checking…':'Reveal selected category'}</button>
    </form>
    {checked?<div className="topic-result"><p>{categoryName(checked.category)} · {checked.severity===null?'Unknown at this reveal level':['None','Mild','Moderate','Severe'][checked.severity]}{checked.descriptors?.length?` · ${checked.descriptors.map(categoryName).join(' · ')}`:''}</p><button className="topic-check" type="button" onClick={hide}>Hide revealed reports</button></div>:null}
    {message?<p role="status">{message}</p>:null}
  </details>;
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
  return <section className="mvp-product-details"><button type="button" className="mvp-secondary" disabled={busy} onClick={() => synopsis ? setSynopsis(null) : void reveal()}>{busy ? 'Loading…' : synopsis ? 'Hide synopsis' : 'Show synopsis'}</button>{synopsis ? <p>{synopsis}</p> : null}{message ? <p role="status">{message}</p> : null}</section>;
}

export function QuickContribution({ movieId, title, posterPath, onChanged, watched = false }: { movieId: string; title?: string; posterPath?:string|null; onChanged: () => void; watched?: boolean }) {
  const { session, loading, error } = useAuthSession();
  return <section id="contribute" className="mvp-quick-contribution"><h2>Your experience</h2><p className="fine">Choose a topic, then tell other viewers what to expect.</p>{loading ? <p role="status">Checking sign-in…</p> : error ? <p role="alert">{error}</p> : session?.user && watched ? <QuickForm key={session.user.id + movieId} title={title??'Film'} posterPath={posterPath} movieId={movieId} watched={watched} onChanged={onChanged} /> : <Link className="button" href={`/login/?next=${encodeURIComponent(`/movies/${movieId}/#contribute`)}`}>Sign in to contribute</Link>}</section>;
}

/** One-tap family-awkwardness vote, shown beside the flagship question. */
export function FamilyVote({ movieId, watched = false, onChanged }: { movieId: string; watched?: boolean; onChanged?: () => void }) {
  const { session, loading, error } = useAuthSession();
  const [own, setOwn] = useState<OwnFamilyVoteResult['familyVote']>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let ignore = false;
    if (!session?.user || !watched) { setReady(false); return; }
    request<OwnFamilyVoteResult>(`/api/v1/movies/${movieId}/family-vote`)
      .then(result => { if (!ignore) { setOwn(result.familyVote); setReady(true); } })
      .catch((reason: unknown) => { if (!ignore) { setReady(false); setMessage(reason instanceof Error ? reason.message : 'Could not load your vote.'); } });
    return () => { ignore = true; };
  }, [movieId, session?.user, watched]);
  async function vote(value: number) {
    if (busy || !ready) return;
    setBusy(true); setMessage('');
    try {
      const result = await request<OwnFamilyVoteResult>(`/api/v1/movies/${movieId}/family-vote`, 'PUT', { expectedRevision: own?.revision ?? 0, watched: true, value });
      setOwn(result.familyVote); setMessage('Your vote is saved. It is your opinion, not community consensus.'); onChanged?.();
    } catch (reason) {
      setMessage((reason instanceof Error ? reason.message : 'Could not save your vote.') + ' Reload saved data before voting again if it changed in another tab.');
    } finally { setBusy(false); }
  }
  if (loading || error) return null;
  if (!session?.user) return <Link className="btn-inline" href={`/login/?next=${encodeURIComponent(`/movies/${movieId}/`)}`}>Sign in to vote</Link>;
  if (!watched) return null;
  return <div className="family-vote"><span className="family-vote-label" id={`family-vote-${movieId}`}>Your awkwardness vote</span>
    <div className="family-vote-buttons" role="group" aria-labelledby={`family-vote-${movieId}`}>{FAMILY_AWKWARDNESS_LEVELS.map(level => <button key={level} type="button" className="family-vote-option" data-level={level} aria-label={`Vote ${level} of 5: ${getFamilyAwkwardnessVerdict(level,0)}`} aria-pressed={own?.value === level} disabled={busy || !ready} onClick={() => void vote(level)}><span className="family-score" aria-hidden="true">{level}</span><span className="family-vote-copy">{getFamilyAwkwardnessVerdict(level,0)}</span></button>)}</div>
    {message ? <p role="status" className="fine">{message}</p> : null}</div>;
}

function QuickForm({ movieId, title, posterPath, onChanged, watched }: { movieId: string; title:string; posterPath?:string|null; onChanged: () => void; watched: boolean }) {
  const [category, setCategory] = useState<CategorySlug>('nudity');
  const [severity, setSeverity] = useState('');
  const [spoilerLevel, setSpoilerLevel] = useState(0);
  const [descriptors, setDescriptors] = useState<string[]>([]);
  const [savedRatings, setSavedRatings] = useState<NonNullable<OwnContributionResult['contribution']>['ratings']>([]);
  const [needsRetry, setNeedsRetry] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<CategorySlug, CategoryDraft>>>({});
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
      if (ignore) return; setRevision(own.contribution?.revision ?? 0); setSavedRatings(own.contribution?.ratings ?? []); setFamily(vote.familyVote); setFamilyValue(vote.familyVote ? String(vote.familyVote.value) : ''); setFamilyReady(true);
    }).catch(error => { if (!ignore) { setMessage(error.message); setNeedsRetry(true); } });
    return () => { ignore = true; };
  }, [movieId]);
  useEffect(() => {
    const next = applyCategoryDraft(drafts[category], savedRatings.find(item => item.category === category));
    setSeverity(next.severity); setDescriptors(next.descriptors); setSpoilerLevel(next.spoilerLevel);
  }, [category, savedRatings, drafts]);
  async function save(event: FormEvent, isFamily = false) {
    event.preventDefault(); if (busy || !watched || (isFamily ? !familyReady || !familyValue : revision === null || severity === '')) return;
    setBusy(true); setMessage('');
    const body = isFamily ? { expectedRevision: family?.revision ?? 0, watched: true, value: Number(familyValue) } : { expectedRevision: revision, watched: true, category, severity: Number(severity), spoilerLevel, descriptors };
    const encoded = JSON.stringify({ isFamily, body });
    if (!attempt.current || attempt.current.body !== encoded) attempt.current = { body: encoded, key: crypto.randomUUID() };
    try {
      if (isFamily) { const result = await request<OwnFamilyVoteResult>(`/api/v1/movies/${movieId}/family-vote`, 'PUT', body, attempt.current.key); setFamily(result.familyVote); onChanged(); }
      else {
        const result = await request<OwnContributionResult>(`/api/v1/movies/${movieId}/warnings`, 'PATCH', body, attempt.current.key);
        setRevision(result.contribution?.revision ?? null); setSavedRatings(result.contribution?.ratings ?? []);
        setDrafts(current => clearCategoryDraft(current, category)); onChanged();
      }
      attempt.current = null; setMessage(isFamily ? 'Your family vote was saved. It is your opinion, not community consensus.' : 'Warning saved. Your other categories are unchanged.');
    } catch (error) {
      if (!isFamily) setDrafts(current => storeCategoryDraft(current, category, { severity, spoilerLevel, descriptors }));
      setMessage(error instanceof Error ? error.message : 'Could not save.'); setNeedsRetry(true);
    } finally { setBusy(false); }
  }
  function chooseCategory(next: CategorySlug) {
    setDrafts(current => storeCategoryDraft(current, category, { severity, spoilerLevel, descriptors }));
    setCategory(next);
  }
  return <><form className="mvp-compact-form" onSubmit={save}><label>Category<select value={category} onChange={e => chooseCategory(e.target.value as CategorySlug)} disabled={busy}>{CATEGORY_SLUGS.map(slug => <option key={slug} value={slug}>{categoryName(slug)}</option>)}</select></label><label>Intensity<select value={severity} onChange={e => { setSeverity(e.target.value); if (e.target.value === '0') setDescriptors([]); }} disabled={busy}><option value="">Choose intensity</option>{['None', 'Mild', 'Moderate', 'Severe'].map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label><label>Spoiler protection<select value={spoilerLevel} onChange={e => setSpoilerLevel(Number(e.target.value))} disabled={busy}><option value={0}>No spoiler</option><option value={1}>Hide descriptions</option><option value={2}>Hide category and descriptions</option></select></label>{WARNING_DESCRIPTOR_IDS[category].length ? <details className="contribution-options"><summary>Optional details</summary><fieldset className="mvp-descriptor-options" disabled={busy || severity === '0' || severity === ''}><legend>Optional details · select only what you observed</legend>{WARNING_DESCRIPTOR_IDS[category].map(id => <label key={id}><input type="checkbox" checked={descriptors.includes(id)} onChange={e => setDescriptors(current => e.target.checked ? [...current, id] : current.filter(item => item !== id))} />{categoryName(id)}</label>)}</fieldset></details> : null}<button className="button" disabled={busy || !watched || revision === null || severity === ''}>{busy ? 'Saving…' : savedRatings.some(item=>item.category===category) ? 'Update warning' : 'Save warning'}</button></form>{savedRatings.find(r=>r.category===category) ? <MovieStory key={`${category}-${revision}`} movieId={movieId} title={title} posterPath={posterPath} warning={savedRatings.find(r=>r.category===category)} ownFamilyValue={family?.value}/> : null}<details className="mvp-product-details"><summary>👀 Family movie night opinion</summary><form className="mvp-family-form" onSubmit={e => void save(e, true)}><label>Your family awkwardness vote<select value={familyValue} onChange={e => setFamilyValue(e.target.value)} disabled={busy}><option value="">Choose your opinion</option><option value={1}>1 · Comfortable</option><option value={2}>2 · A little awkward</option><option value={3}>3 · Some awkward silences</option><option value={4}>4 · Very awkward</option><option value={5}>5 · Extremely awkward</option></select></label><button className="mvp-secondary" disabled={busy || !watched || !familyReady || !familyValue}>Save my family vote</button><p className="fine">How awkward would watching with family feel? Your opinion is separate from content warnings.</p></form></details>{message ? <p role="status">{message}</p> : null}{needsRetry ? <button type="button" className="mvp-secondary" disabled={busy} onClick={() => { setRevision(null); setFamilyReady(false); void Promise.all([request<OwnContributionResult>(`/api/v1/movies/${movieId}/contribution`), request<OwnFamilyVoteResult>(`/api/v1/movies/${movieId}/family-vote`)]).then(([own, vote]) => { setRevision(own.contribution?.revision ?? 0); setSavedRatings(own.contribution?.ratings ?? []); setFamily(vote.familyVote); setFamilyReady(true); setNeedsRetry(false); setMessage('Ready to edit.'); }).catch(error => setMessage(error.message)); }}>Try loading again</button> : null}</>;
}
