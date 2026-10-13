'use client';
import { refreshAuthSession } from '../lib/supabase/browser';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

type SearchMovie = { tmdbId: number; movieId?: string | null; title: string; originalTitle: string; year: number | null; language: string | null; posterPath: string | null };
type SearchPage = { results: SearchMovie[]; page: number; hasMore: boolean };
type Session = { user: { id: string } | null; csrfToken: string; configured: boolean };

function posterUrl(path: string | null) {
  return path && /^\/[A-Za-z0-9_.\/-]+$/.test(path) && !path.includes('..') && !path.startsWith('//') ? `https://image.tmdb.org/t/p/w185${path}` : null;
}

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 503) throw new Error('Real film search is awaiting service setup. Please try again later.');
    if (response.status === 429) {
      const seconds = response.headers.get('Retry-After');
      throw new Error(`Too many requests. Please wait${seconds && /^\d+$/.test(seconds) ? ` ${seconds} seconds` : ' a little'} before retrying.`);
    }
    throw new Error(result?.error?.message || 'We couldn’t load this request. Please try again.');
  }
  if (!result || !('data' in result)) throw new Error('The service returned an incomplete response. Please try again.');
  return result.data as T;
}

export function MovieSearch() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SearchMovie | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const importAttempt = useRef<{ tmdbId: number; key: string } | null>(null);
  const opening = useRef(false);
  const resumeOpening = useRef(false);
  const normalized = query.trim();
  const validQuery = [...normalized].length >= 2 && [...normalized].length <= 100;

  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(window.location.href);
    const initialQuery = url.searchParams.get('q');
    if (initialQuery) setQuery(initialQuery.slice(0, 100));
    const initialPage = Number(url.searchParams.get('page'));
    if (Number.isInteger(initialPage) && initialPage >= 1 && initialPage <= 20) setPage(initialPage);
    const initialSelection = Number(url.searchParams.get('tmdbId'));
    if (Number.isSafeInteger(initialSelection) && initialSelection > 0) {
      // Restore selection only from fresh search metadata after the login return.
      importAttempt.current = { tmdbId: initialSelection, key: crypto.randomUUID() };
      resumeOpening.current = url.searchParams.get('open') === '1';
    }
    refreshAuthSession()
      .then(value=>{if(!controller.signal.aborted)setSession(value);})
      .catch((reason: unknown) => { if (!controller.signal.aborted) setSessionError(reason instanceof Error ? reason.message : 'Sign-in is temporarily unavailable.'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError('');
    setLoading(validQuery);
    if (!validQuery) return () => controller.abort();
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({ q: normalized, page: String(page) });
      fetch(`/api/v1/movies/search?${params}`, { signal: controller.signal })
        .then(readResponse<SearchPage>)
        .then((data) => {
          if (controller.signal.aborted) return;
          setResult(data);
          const returning = importAttempt.current;
          if (returning) {
            const match = data.results.find(movie => movie.tmdbId === returning.tmdbId);
            if (match) setSelected(match);
          }
        })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Search could not connect. Please retry.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 350);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [normalized, page, retry, validQuery]);

  async function importMovie(movie: SearchMovie | null = selected) {
    if (!movie || opening.current) return;
    opening.current = true;
    setSelected(movie);
    setImporting(true);
    setImportError('');
    try {
      if (movie.movieId && /^[0-9a-f-]{36}$/i.test(movie.movieId)) {
        window.location.assign(`/movies/${movie.movieId}/`);
        return;
      }
      const freshSession = await refreshAuthSession();
      setSession(freshSession);
      if (!importAttempt.current || importAttempt.current.tmdbId !== movie.tmdbId) importAttempt.current = { tmdbId: movie.tmdbId, key: crypto.randomUUID() };
      const response = await fetch('/api/v1/movies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': freshSession.csrfToken, 'Idempotency-Key': importAttempt.current.key },
        body: JSON.stringify({ tmdbId: movie.tmdbId }),
      });
      const data = await readResponse<{ id: string; tmdbId: number }>(response);
      if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error('The film service returned an invalid film address. Please retry.');
      window.location.assign(`/movies/${data.id}/`);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : 'The request could not connect. Your selection is still here; retry when connected.');
    } finally { opening.current = false; setImporting(false); }
  }

  useEffect(() => {
    if (resumeOpening.current && selected && session?.configured) {
      resumeOpening.current = false;
      void importMovie(selected);
    }
  }, [selected, session]);

  function submitSearch(event: FormEvent) { event.preventDefault(); setPage(1); setRetry(value => value + 1); }

  return <section aria-label="Film search">
    <form className="mvp-search-form" onSubmit={submitSearch} role="search">
      <label htmlFor="film-query">Film title</label>
      <div><input id="film-query" type="search" value={query} maxLength={100} autoComplete="off" placeholder="Search a film title…" aria-describedby="search-hint" onChange={event => { setQuery(event.target.value); setPage(1); setSelected(null); setImportError(''); importAttempt.current = null; }} /><button className="button" type="submit" disabled={!validQuery}>Search <span aria-hidden="true">→</span></button></div>
      <p className="fine" id="search-hint">Enter 2–100 characters. Worldwide movie metadata from TMDb. This search does not assess content.</p>
    </form>
    <div role="status" aria-live="polite" className="mvp-search-status">{loading ? 'Searching films…' : result ? `${result.results.length} films on page ${result.page}.` : !error ? 'Find a film to see its viewer content guide.' : ''}</div>
    {error ? <div className="mvp-notice" role="alert"><p>{error}</p><button className="mvp-secondary" type="button" onClick={() => setRetry(value => value + 1)}>Retry search</button></div> : null}
    {result && result.results.length === 0 ? <div className="mvp-notice"><h2>No films found.</h2><p>Try the original title, a different spelling, or a shorter title.</p></div> : null}
    {result ? <ul className="mvp-results">{result.results.map(movie => {
      const poster = posterUrl(movie.posterPath);
      return <li key={movie.tmdbId}><button className={`mvp-result${selected?.tmdbId === movie.tmdbId ? ' is-selected' : ''}`} type="button" disabled={importing} onClick={() => void importMovie(movie)}>
        <span className="mvp-thumb">{poster ? <img src={poster} alt="" width={92} height={138} loading="lazy" /> : <span aria-hidden="true">◇</span>}</span>
        <span className="mvp-result-copy"><strong>{movie.title}</strong>{movie.originalTitle !== movie.title ? <span>{movie.originalTitle}</span> : null}<span className="fine">{movie.year ?? 'Year unknown'} · {movie.language?.toUpperCase() ?? 'Language unknown'}</span><span className="text-link">Choose film <span aria-hidden="true">→</span></span></span>
      </button></li>;
    })}</ul> : null}
    {result && (page > 1 || result.hasMore) ? <nav className="mvp-pagination" aria-label="Search result pages"><button className="mvp-secondary" disabled={page <= 1 || loading} type="button" onClick={() => setPage(value => value - 1)}>Previous page</button><span>Page {page}</span><button className="mvp-secondary" disabled={!result.hasMore || page >= 20 || loading} type="button" onClick={() => setPage(value => value + 1)}>Next page</button></nav> : null}
    {selected ? <section className="mvp-selection" aria-labelledby="selected-title"><span className="label">SELECTED FILM</span><h2 id="selected-title">{selected.title}</h2><p className="muted">{selected.year ?? 'Year unknown'} · {selected.language?.toUpperCase() ?? 'Language unknown'}</p><p>Open its guide to check viewer reports. A film without assessments will show Unknown in every category.</p>
      {selected.movieId && /^[0-9a-f-]{36}$/i.test(selected.movieId) ? <Link className="button" href={`/movies/${selected.movieId}/`}>Open content guide →</Link> : sessionError ? <p role="alert" className="form-error">{sessionError}</p> : session === null ? <p role="status">Preparing film…</p> : !session.configured ? <p className="mvp-notice">Real film guides are awaiting service setup.</p> : <button className="button" type="button" onClick={() => void importMovie()} disabled={importing}>{importing ? 'Opening film…' : 'Open content guide →'}</button>}
      {importError ? <p className="form-error" role="alert">{importError}</p> : null}
    </section> : null}
  </section>;
}
