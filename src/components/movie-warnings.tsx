'use client';

import Link from 'next/link';
import { MovieShare } from './movie-share';
import { QuestionHelp } from './question-help';
import { WatchedButton } from './film-list';
import { MovieScenes } from './movie-scenes';
import { MovieRepresentation, FamilySummaryCheck } from './movie-representation';
import { useCallback, useEffect, useState } from 'react';
import { CATEGORIES, RealContribution, SEVERITY_LABELS, type Severity } from './real-contribution';
import { signatureQuestions, getSignatureVerdict } from '../lib/signature-questions';
import { QuickContribution, SelectiveReveal, SynopsisReveal } from './movie-product-controls';
import type { CategorySlug as AllCategorySlug } from '../lib/contracts';

export type MovieWarning = { category: AllCategorySlug; severity: Severity | null; count: number; distribution: [number, number, number, number]; provisional: boolean; disputed: boolean; descriptors?: string[] };
export type Movie = { id: string; tmdbId: number; title: string; originalTitle: string; year: number | null; language: string | null; posterPath: string | null; synopsis?: string | null; warnings: MovieWarning[]; contributorCount: number };

function FactualWarnings({ warnings, contributorCount }: { warnings: MovieWarning[]; contributorCount: number }) {
  return <section className="mvp-warning-guide" aria-labelledby="warnings-title"><div className="mvp-warning-heading"><div><span className="label">CONTENT AT A GLANCE</span><h2 id="warnings-title">Viewer content guide</h2></div><p className="mvp-count"><strong>{contributorCount}</strong> {contributorCount === 1 ? 'contributor' : 'contributors'}</p></div>
    <p className="fine">Community reports describe intensity, not suitability. Not shown can mean unassessed or protected information. Fewer than three assessments are provisional.</p>
    <ul className="mvp-warning-list">{CATEGORIES.map(category => {
      const warning = warnings.find(item => item.category === category.slug);
      const severity = warning?.severity ?? null;
      const label = severity === null ? 'Not shown' : SEVERITY_LABELS[severity];
      const count = warning?.count ?? 0;
      return <li key={category.slug}><div className="mvp-warning-row"><h3>{category.label}</h3><span className={`severity severity-${severity === null ? 'unknown' : label.toLowerCase()}`}><span aria-hidden="true">{severity === null ? '?' : severity === 0 ? '○' : '●'}</span>{label}</span></div>
        <div className="mvp-warning-meta"><span>{count} {count === 1 ? 'assessment' : 'assessments'}</span>{warning?.provisional && count > 0 ? <span className="mvp-tag">Provisional</span> : null}{warning?.disputed ? <strong className="mvp-dispute">Reports differ</strong> : null}</div>
        {warning?.descriptors?.length ? <p className="fine">Reported details: {warning.descriptors.map(value => value.replaceAll('_', ' ')).join(' · ')}</p> : null}
        {count > 0 && warning ? <dl className="mvp-distribution" aria-label={`${category.label}: reported severity counts`}>{SEVERITY_LABELS.map((level, index) => <div key={level}><dt>{level}</dt><dd>{warning.distribution[index]}</dd></div>)}</dl> : <p className="fine mvp-unknown">Not shown · Check. Unassessed and protected information use the same presentation.</p>}
      </li>;
    })}</ul>
    <p className="fine">The label summarizes the submitted reports. The counts show the full range, including severe reports when the summary is None. Different releases or cuts can contain different material.</p>
  </section>;
}

const questionCategories: Record<string, AllCategorySlug> = { biryani: 'gore_graphic_violence', 'animal-harm': 'animal_harm', drugs: 'drugs', 'sexual-violence': 'sexual_violence', alcohol: 'alcohol', language: 'language', 'physical-violence': 'physical_violence' };
export function MovieWarnings({ warnings, contributorCount, movieId, refreshKey = 0 }: { warnings: MovieWarning[]; contributorCount: number; movieId?: string; refreshKey?: number }) {
  const [revealed, setRevealed] = useState<MovieWarning[]>([]);
  useEffect(() => setRevealed([]), [warnings, movieId]);
  const effective = warnings.map(warning => revealed.find(item => item.category === warning.category) ?? warning);
  function rows(visible: boolean) { return signatureQuestions.filter(question => question.initiallyVisible === visible).map(question => {
    const warning = effective.find(item => item.category === questionCategories[question.id]);
    const severity = warning?.severity ?? null;
    return <li key={question.id}><div className="question-content"><QuestionHelp id={question.id} prompt={question.prompt}/>{question.id === 'parents' && movieId ? <FamilySummaryCheck movieId={movieId} refreshKey={refreshKey} /> : <p className="fine">{severity === null ? 'Not shown · Check' : getSignatureVerdict(question.id, severity, 0, true)}</p>}</div>{severity !== null ? <span className={`severity severity-${SEVERITY_LABELS[severity].toLowerCase()}`}>{SEVERITY_LABELS[severity]}</span> : null}</li>;
  }); }
  return <section className="mvp-signature" aria-label="Quick content questions"><div className="mvp-signature-heading"><h2>Before you press play</h2><a className="text-link" href="#contribute">Contribute</a></div><ul className="mvp-question-list">{rows(true)}</ul><details className="mvp-product-details"><summary>Show 3 more questions</summary><ul className="mvp-question-list">{rows(false)}</ul></details><p className="fine guide-caveat">Community reports, not suitability guarantees. Not shown can mean unassessed or protected information. Family votes are separate opinions.</p>{movieId ? <SelectiveReveal key={JSON.stringify(warnings)} movieId={movieId} onReveal={warning => setRevealed(current => [...current.filter(item => item.category !== warning.category), warning])} /> : null}<details className="mvp-product-details"><summary>Detailed warnings</summary><FactualWarnings warnings={effective} contributorCount={contributorCount} /></details></section>;
}

function posterUrl(path: string | null) {
  return path && /^\/[A-Za-z0-9_.\/-]+$/.test(path) && !path.includes('..') && !path.startsWith('//') ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

export function MovieDetail({ movieId, initialMovie = null, certifications = [], runtime = null, genres = [] }: { movieId: string; initialMovie?: Movie | null; certifications?: string[]; runtime?: number | null; genres?: string[] }) {
  const [movie, setMovie] = useState<Movie | null>(initialMovie);
  const [loading, setLoading] = useState(!initialMovie);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [activePanel, setActivePanel] = useState<'guide' | 'contribute'>('guide');
  const [contributionOpened, setContributionOpened] = useState(false);
  const refresh = useCallback(() => setRetry(value => value + 1), []);

  useEffect(() => {
    function followHash() {
      const contribute = window.location.hash === '#contribute';
      setActivePanel(contribute ? 'contribute' : 'guide');
      if (contribute) setContributionOpened(true);
    }
    followHash(); window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, [movieId]);

  function selectPanel(panel:'guide'|'contribute') {
    setActivePanel(panel);
    if (panel==='contribute') setContributionOpened(true);
    window.history.replaceState(window.history.state,'',`${window.location.pathname}${window.location.search}${panel==='contribute'?'#contribute':'#guide'}`);
  }

  useEffect(() => {
    if (initialMovie?.id === movieId && retry === 0) {
      setMovie(initialMovie); setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/v1/movies/${encodeURIComponent(movieId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 503) throw new Error('Real film guides are awaiting service setup. Please try again later.');
          if (response.status === 404) throw new Error('This film guide is unavailable. Search for another film.');
          if (response.status === 429) throw new Error('The guide is temporarily busy. Please wait a little before retrying.');
          throw new Error(result?.error?.message || 'The film guide could not be loaded. Please retry.');
        }
        if (!result?.data || !Array.isArray(result.data.warnings)) throw new Error('The film service returned an incomplete guide. Please retry.');
        return result.data as Movie;
      })
      .then(data => { if (!controller.signal.aborted) setMovie(data); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not connect to the film guide. Please retry.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [movieId, retry, initialMovie]);

  const poster = movie ? posterUrl(movie.posterPath) : null;
  return <><Link href="/search/" className="text-link">← Find another film</Link>
    {loading ? <p role="status" className="mvp-loading">{movie ? 'Refreshing viewer reports…' : 'Loading film guide…'}</p> : null}
    {error ? <div className="mvp-notice mvp-error" role="alert"><h1>{movie ? 'Reports could not refresh.' : 'Film guide unavailable.'}</h1><p>{error}</p>{movie ? <p className="fine">The guide below is the last loaded result and may be out of date.</p> : null}<button className="mvp-secondary" type="button" onClick={refresh} disabled={loading}>Retry film guide</button></div> : null}
    {movie ? <><header className="mvp-movie-header film-detail-header"><div className="mvp-poster">{poster ? <img src={poster} alt={`${movie.title} poster`} width={228} height={342} /> : <div className="mvp-poster-fallback"><span>No poster available</span></div>}</div><div><h1>{movie.title}</h1>{movie.originalTitle !== movie.title ? <p className="mvp-original-title">{movie.originalTitle}</p> : null}<p className="movie-meta">{movie.year ?? 'Year unknown'} · {movie.language?.toUpperCase() ?? 'Language unknown'}{runtime ? ` · ${runtime} min` : ''}</p>{genres.length?<p className="film-genres">{genres.join(' / ')}</p>:null}<div className="film-header-actions"><WatchedButton film={{...movie,movieId:movie.id}}/><MovieShare key={`share-${movie.id}`} movieId={movie.id} title={movie.title} /></div><details className="film-certification"><summary>India certification · {certifications.length ? certifications.join(' / ') : 'Unavailable'}</summary><p className="fine">Source: TMDb release records. Labels may differ by release or cut. Separate from viewer warnings; not verified against a CBFC certificate.</p></details></div></header>
      <div className="film-tabs" role="tablist" aria-label="Movie sections">{(['guide','contribute'] as const).map(panel=><button key={panel} type="button" id={`tab-${panel}`} role="tab" aria-selected={activePanel===panel} aria-controls={`panel-${panel}`} tabIndex={activePanel===panel?0:-1} onClick={()=>selectPanel(panel)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'guide':event.key==='End'?'contribute':panel==='guide'?'contribute':'guide';selectPanel(next);document.getElementById(`tab-${next}`)?.focus();}}}>{panel==='guide'?'Guide':'Contribute'}</button>)}</div>
      <div id="panel-guide" role="tabpanel" aria-labelledby="tab-guide" hidden={activePanel!=='guide'}>
      <MovieWarnings movieId={movie.id} warnings={movie.warnings} contributorCount={movie.contributorCount} refreshKey={retry} />
      <SynopsisReveal key={`synopsis-${movie.id}`} movieId={movie.id} />
      <MovieScenes key={`scenes-${movie.id}-${retry}`} movieId={movie.id} onChanged={refresh} />
      <MovieRepresentation movieId={movie.id} refreshKey={retry} onChanged={refresh} />
      </div>
      <div id="panel-contribute" role="tabpanel" aria-labelledby="tab-contribute" hidden={activePanel!=='contribute'}>{contributionOpened ? <>
      <QuickContribution key={`quick-${movie.id}`} movieId={movie.id} onChanged={refresh} />
      <details className="mvp-product-details"><summary>Edit all original assessments / delete contribution</summary><RealContribution movieId={movie.id} onChanged={refresh} /></details>
      </>:null}</div>
    </> : null}
  </>;
}

