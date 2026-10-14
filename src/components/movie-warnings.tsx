'use client';

import Link from 'next/link';
import { MovieShare } from './movie-share';
import { QuestionHelp } from './question-help';
import { useFilmList } from './film-list';
import { MovieScenes } from './movie-scenes';
import { MovieRepresentation, FamilySummaryCheck } from './movie-representation';
import { useCallback, useEffect, useState } from 'react';
import { CATEGORIES, SEVERITY_LABELS, type Severity } from './real-contribution';
import { UnifiedContribution } from './unified-contribution';
import { signatureQuestions, getSignatureVerdict, isSeriousHarm, UNRATED_INDICATOR, UNRATED_VERDICT, MORE_QUESTIONS_LABEL } from '../lib/signature-questions';
import { FamilyVote, SelectiveReveal, SynopsisReveal } from './movie-product-controls';
import type { CategorySlug as AllCategorySlug, SeverityDistribution } from '../lib/contracts';

export type MovieWarning = { category: AllCategorySlug; severity: Severity | null; count: number; distribution: SeverityDistribution; provisional: boolean; disputed: boolean; descriptors?: string[] };
export type Movie = { id: string; tmdbId: number; title: string; originalTitle: string; year: number | null; language: string | null; posterPath: string | null; synopsis?: string | null; warnings: MovieWarning[]; contributorCount: number };

const DETAILED_CATEGORIES = [
  ...CATEGORIES.slice(0, 4).map(({ slug, label }) => ({ slug, label: slug === 'gore_graphic_violence' ? 'Gore / disturbing visuals' : label })),
  { slug: 'graphic_violence', label: 'Graphic violence / bloodshed' },
  { slug: 'horror', label: 'Horror / frightening content' },
  ...CATEGORIES.slice(4).map(({ slug, label }) => ({ slug, label })),
  { slug: 'animal_harm', label: 'Animal harm' }, { slug: 'drugs', label: 'Drugs' },
  { slug: 'alcohol', label: 'Alcohol' }, { slug: 'language', label: 'Language' },
  { slug: 'physical_violence', label: 'Physical violence' },
] as const;

function FactualWarnings({ warnings, contributorCount }: { warnings: MovieWarning[]; contributorCount: number }) {
  return <section className="mvp-warning-guide" aria-labelledby="warnings-title"><div className="mvp-warning-heading"><div><span className="label">CONTENT AT A GLANCE</span><h2 id="warnings-title">Viewer content guide</h2></div><p className="mvp-count"><strong>{contributorCount}</strong> {contributorCount === 1 ? 'contributor' : 'contributors'}</p></div>
    <p className="fine">Community reports describe intensity, not suitability. Not shown can mean unassessed or protected information. Fewer than three assessments are provisional.</p>
    <ul className="mvp-warning-list">{DETAILED_CATEGORIES.map(category => {
      const warning = warnings.find(item => item.category === category.slug);
      const severity = warning?.severity ?? null;
      const label = severity === null ? 'Not shown' : SEVERITY_LABELS[severity];
      const count = warning?.count ?? 0;
      return <li key={category.slug}><div className="mvp-warning-row"><h3>{category.label}</h3><span className={`severity severity-${severity === null ? 'unknown' : label.toLowerCase().replaceAll(' ', '-')}`}><span aria-hidden="true">{severity === null ? '?' : severity === 0 ? '○' : '●'}</span>{label}</span></div>
        <div className="mvp-warning-meta"><span>{count} {count === 1 ? 'assessment' : 'assessments'}</span>{warning?.provisional && count > 0 ? <span className="mvp-tag">Provisional</span> : null}{warning?.disputed ? <strong className="mvp-dispute">Reports differ</strong> : null}</div>
        {warning?.descriptors?.length ? <p className="fine">Reported details: {warning.descriptors.map(value => value.replaceAll('_', ' ')).join(' · ')}</p> : null}
        {count > 0 && warning ? <dl className="mvp-distribution" aria-label={`${category.label}: reported severity counts`}>{SEVERITY_LABELS.map((level, index) => <div key={level}><dt>{level}</dt><dd>{warning.distribution[index] ?? 0}</dd></div>)}</dl> : <p className="fine mvp-unknown">No public reports shown for this topic. Some information may be protected.</p>}
      </li>;
    })}</ul>
    <p className="fine">The label summarizes the submitted reports. The counts show the full range, including severe reports when the summary is None. Different releases or cuts can contain different material.</p>
  </section>;
}

const questionCategories: Record<string, AllCategorySlug> = { biryani: 'gore_graphic_violence', 'graphic-violence': 'graphic_violence', horror: 'horror', 'animal-harm': 'animal_harm', drugs: 'drugs', 'sexual-violence': 'sexual_violence', alcohol: 'alcohol', language: 'language' };
const questionLabels: Record<string, string> = {
  biryani: 'Gore & disturbing visuals',
  'graphic-violence': 'Graphic violence & bloodshed',
  horror: 'Horror & frightening content',
};
const noReportsCopy: Record<string, string> = {
  biryani: 'No disturbing visual content reports shown yet.',
  'graphic-violence': 'No graphic violence reports shown yet.',
  horror: 'No frightening content reports shown yet.',
};

/**
 * A missing rating must never read as a safe verdict. Unknown is neutral grey and
 * explicitly unrated; a green pill is reserved for a reported absence.
 */
function SeverityBadge({ severity }: { severity: Severity | null }) {
  if (severity === null) return <span className="severity severity-unrated"><span aria-hidden="true">{UNRATED_INDICATOR}</span>{UNRATED_VERDICT}</span>;
  const label = SEVERITY_LABELS[severity];
  return <span className={`severity severity-${label.toLowerCase().replaceAll(' ', '-')}`}><span aria-hidden="true">{severity === 0 ? '○' : '●'}</span>{label}</span>;
}

export function MovieWarnings({ warnings, contributorCount, movieId, refreshKey = 0, watched = false, onGuideChanged }: { warnings: MovieWarning[]; contributorCount: number; movieId?: string; refreshKey?: number; watched?: boolean; onGuideChanged?: () => void }) {
  const [revealed, setRevealed] = useState<MovieWarning[]>([]);
  useEffect(() => {setRevealed([]);}, [warnings, movieId]);
  const effective = warnings.map(warning => revealed.find(item => item.category === warning.category) ?? warning);
  function rows(visible:boolean) { return signatureQuestions.filter(question=>question.initiallyVisible===visible).map(question => {
    const category = questionCategories[question.id];
    const warning = category ? effective.find(item => item.category === category) : undefined;
    const severity = warning?.severity ?? null;
    return <li key={question.id}><div className="question-content"><QuestionHelp id={question.id} prompt={question.prompt}/>
      {questionLabels[question.id] ? <p className="question-category">{questionLabels[question.id]}</p> : null}
      {question.id === 'parents' && movieId ? <><FamilyVote movieId={movieId} watched={watched} onChanged={onGuideChanged}/><FamilySummaryCheck movieId={movieId} refreshKey={refreshKey} /></> : severity !== null ? <p className="fine">{getSignatureVerdict(question.id, severity, 0, isSeriousHarm(category ?? '', warning?.descriptors, severity))}</p> : noReportsCopy[question.id] ? <p className="fine">{noReportsCopy[question.id]}</p> : null}
      {question.id!=='parents' ? <SeverityBadge severity={severity}/> : null}
    </div></li>;
  }); }
  return <section className="mvp-signature" aria-label="Quick content questions"><div className="mvp-signature-heading"><h2>Before you press play</h2></div><ul className="mvp-question-list">{rows(true)}</ul><details className="signature-more"><summary>{MORE_QUESTIONS_LABEL}</summary><ul className="mvp-question-list">{rows(false)}</ul></details><p className="fine guide-caveat">Community reports, not suitability guarantees. Not yet rated can mean unassessed or spoiler-protected information. A green rating is only shown when someone has reported the topic as absent. Family votes are separate opinions.</p>{movieId ? <SelectiveReveal onHide={()=>{setRevealed([]);}} key={JSON.stringify(warnings)} movieId={movieId} onReveal={warning => setRevealed(current => [...current.filter(item => item.category !== warning.category), warning])} /> : null}<details className="mvp-product-details"><summary>Detailed warnings</summary><FactualWarnings warnings={effective} contributorCount={contributorCount} /></details></section>;
}

function posterUrl(path: string | null) {
  return path && /^\/[A-Za-z0-9_.\/-]+$/.test(path) && !path.includes('..') && !path.startsWith('//') ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

export function MovieDetail({ movieId, initialMovie = null, certifications = [], runtime = null, genres = [], backdropPath = null }: { movieId: string; initialMovie?: Movie | null; certifications?: string[]; runtime?: number | null; genres?: string[];backdropPath?:string|null }) {
  const [movie, setMovie] = useState<Movie | null>(initialMovie);
  const [loading, setLoading] = useState(!initialMovie);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [activePanel, setActivePanel] = useState<'guide' | 'contribute'>('guide');
  const [contributionOpened, setContributionOpened] = useState(false);
  const [saveConfirmation, setSaveConfirmation] = useState('');
  const filmList = useFilmList();
  const watched = !!movie && filmList.films.some(item => item.tmdbId === movie.tmdbId);
  useEffect(() => { if (filmList.ready && !watched) setActivePanel('guide'); }, [filmList.ready, watched]);
  const refresh = useCallback(() => setRetry(value => value + 1), []);

  useEffect(() => {
    function followHash() {
      const contribute = watched && window.location.hash === '#contribute';
      setActivePanel(contribute ? 'contribute' : 'guide');
      if (contribute) setContributionOpened(true);
    }
    followHash(); window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, [movieId, watched]);

  function selectPanel(panel:'guide'|'contribute') {
    if (panel==='contribute'&&!watched) return;
    setActivePanel(panel);
    if (panel==='contribute') { setContributionOpened(true); setSaveConfirmation(''); }
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
    {movie ? <><header className="mvp-movie-header film-detail-header"><div className="mvp-poster">{poster ? <img src={poster} alt={`${movie.title} poster`} width={228} height={342} /> : <div className="mvp-poster-fallback"><span>No poster available</span></div>}</div><div><h1>{movie.title}</h1>{movie.originalTitle !== movie.title ? <p className="mvp-original-title">{movie.originalTitle}</p> : null}<p className="movie-meta">{movie.year ?? 'Year unknown'} · {movie.language?.toUpperCase() ?? 'Language unknown'}{runtime ? ` · ${runtime} min` : ''}</p>{genres.length?<p className="film-genres">{genres.join(' / ')}</p>:null}<div className="film-header-actions"><label className="film-watched-toggle"><input type="checkbox" checked={watched} disabled={!filmList.ready} onChange={()=>filmList.toggle({...movie,movieId:movie.id})}/> Watched</label><MovieShare key={`share-${movie.id}`} movieId={movie.id} title={movie.title} posterPath={movie.posterPath} year={movie.year} genres={genres} backdropPath={backdropPath} /></div>{filmList.error ? <p role="alert">{filmList.error}</p> : null}<details className="film-certification"><summary>India certification · {certifications.length ? certifications.join(' / ') : 'Unavailable'}</summary><p className="fine">Source: TMDb release records. Labels may differ by release or cut. Separate from viewer warnings; not verified against a CBFC certificate.</p></details></div></header>
      <div className="film-tabs" role="tablist" aria-label="Movie sections">{(['guide','contribute'] as const).map(panel=><button key={panel} type="button" id={`tab-${panel}`} role="tab" aria-selected={activePanel===panel} aria-controls={`panel-${panel}`} aria-disabled={panel==='contribute'&&!watched} tabIndex={activePanel===panel?0:-1} onClick={()=>selectPanel(panel)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'guide':event.key==='End'?'contribute':panel==='guide'?'contribute':'guide';selectPanel(next);document.getElementById(`tab-${next}`)?.focus();}}}>{panel==='guide'?'Guide':'Contribute'}</button>)}</div>
      {!watched ? <p className="film-gate-note">Tick Watched above to add your experience. Saved on this browser.</p> : null}
      <div id="panel-guide" role="tabpanel" aria-labelledby="tab-guide" hidden={activePanel!=='guide'}>
      {saveConfirmation ? <p className="mvp-notice" role="status">{saveConfirmation}</p> : null}
      <MovieWarnings movieId={movie.id} warnings={movie.warnings} contributorCount={movie.contributorCount} refreshKey={retry} watched={watched} onGuideChanged={refresh} />
      <SynopsisReveal key={`synopsis-${movie.id}`} movieId={movie.id} />
      <MovieScenes readOnly key={`scenes-${movie.id}-${retry}`} movieId={movie.id} onChanged={refresh} />
      <MovieRepresentation readOnly movieId={movie.id} refreshKey={retry} onChanged={refresh} />
      </div>
      <div id="panel-contribute" role="tabpanel" aria-labelledby="tab-contribute" hidden={activePanel!=='contribute'}>{contributionOpened && watched ? <>
      <UnifiedContribution key={movie.id} movieId={movie.id} title={movie.title} year={movie.year} genres={genres} backdropPath={backdropPath} posterPath={movie.posterPath} watched={watched} onChanged={refresh} onSaved={()=>{ setSaveConfirmation('Your ratings were saved. The Guide shows the updated community warnings; protected details remain hidden.'); selectPanel('guide'); requestAnimationFrame(()=>document.getElementById('tab-guide')?.focus()); }}/>
      <MovieRepresentation movieId={movie.id} watched={watched} onChanged={refresh}/>
      </>:null}</div>
    </> : null}
  </>;
}

