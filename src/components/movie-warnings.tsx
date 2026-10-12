'use client';

import Link from 'next/link';
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
export function MovieWarnings({ warnings, contributorCount, movieId }: { warnings: MovieWarning[]; contributorCount: number; movieId?: string }) {
  const [revealed, setRevealed] = useState<MovieWarning[]>([]);
  useEffect(() => setRevealed([]), [warnings, movieId]);
  const effective = warnings.map(warning => revealed.find(item => item.category === warning.category) ?? warning);
  function rows(visible: boolean) { return signatureQuestions.filter(question => question.initiallyVisible === visible).map(question => {
    const warning = effective.find(item => item.category === questionCategories[question.id]);
    const severity = warning?.severity ?? null;
    return <li key={question.id}><div><h3>{question.prompt}</h3><p className="fine">{severity === null ? 'Not shown · Check' : getSignatureVerdict(question.id, severity, 0, true)}</p></div>{severity !== null ? <span className={`severity severity-${SEVERITY_LABELS[severity].toLowerCase()}`}>{SEVERITY_LABELS[severity]}</span> : null}</li>;
  }); }
  return <section className="mvp-signature" aria-label="Quick content questions"><div className="mvp-signature-heading"><div><span className="label">BEFORE YOU PRESS PLAY</span><h2>A quick content check</h2></div><a className="text-link" href="#contribute">Add warning →</a></div><ul className="mvp-question-list">{rows(true)}</ul><details className="mvp-product-details"><summary>Show 3 more questions</summary><ul className="mvp-question-list">{rows(false)}</ul></details><p className="fine">Community reports, not suitability guarantees. Not shown can mean unassessed or protected information. Family votes are separate opinions.</p>{movieId ? <SelectiveReveal key={JSON.stringify(warnings)} movieId={movieId} onReveal={warning => setRevealed(current => [...current.filter(item => item.category !== warning.category), warning])} /> : null}<details className="mvp-product-details"><summary>Detailed factual warnings · all original categories</summary><FactualWarnings warnings={effective} contributorCount={contributorCount} /></details></section>;
}

function posterUrl(path: string | null) {
  return path && /^\/[A-Za-z0-9_.\/-]+$/.test(path) && !path.includes('..') && !path.startsWith('//') ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

export function MovieDetail({ movieId, initialMovie = null, certifications = [], runtime = null, genres = [] }: { movieId: string; initialMovie?: Movie | null; certifications?: string[]; runtime?: number | null; genres?: string[] }) {
  const [movie, setMovie] = useState<Movie | null>(initialMovie);
  const [loading, setLoading] = useState(!initialMovie);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry(value => value + 1), []);

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
    {movie ? <><header className="mvp-movie-header"><div className="mvp-poster">{poster ? <img src={poster} alt={`${movie.title} poster`} width={228} height={342} /> : <div className="mvp-poster-fallback"><span aria-hidden="true">◇</span><span>No poster available</span></div>}</div><div><span className="label">FILM CONTENT GUIDE</span><h1>{movie.title}</h1>{movie.originalTitle !== movie.title ? <p className="mvp-original-title">{movie.originalTitle}</p> : null}<p className="movie-meta">{movie.year ?? 'Year unknown'} <span className="divider">/</span> {movie.language?.toUpperCase() ?? 'Language unknown'}</p><a href="#contribute" className="text-link">Add your watched-film assessment →</a></div></header>
      <aside className="mvp-notice" aria-label="Indian film certification"><p><strong>India certification</strong> · {certifications.length ? certifications.join(' / ') : 'Unavailable'}</p><p className="fine">Source: TMDb release records. Labels may differ by release or cut. This is separate from viewer warnings and is not verified against a CBFC certificate.</p></aside>
      <p className="fine">{runtime ? `${runtime} min` : 'Runtime unavailable'}{genres.length ? ` · ${genres.join(' / ')}` : ''}</p>
      <MovieWarnings movieId={movie.id} warnings={movie.warnings} contributorCount={movie.contributorCount} />
      <SynopsisReveal key={`synopsis-${movie.id}`} movieId={movie.id} />
      <QuickContribution key={`quick-${movie.id}`} movieId={movie.id} onChanged={refresh} />
      <details className="mvp-product-details"><summary>Edit all original assessments / delete contribution</summary><RealContribution movieId={movie.id} onChanged={refresh} /></details>
    </> : null}
  </>;
}
