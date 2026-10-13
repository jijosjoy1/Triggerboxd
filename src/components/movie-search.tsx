'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { refreshAuthSession } from '../lib/supabase/browser';
import { filmDestination, filmPoster, type FilmItem } from '../lib/film-list';
import { FilmDialog } from './film-dialog';
import { useFilmList } from './film-list';

type SearchPage = { results: FilmItem[]; page: number; hasMore: boolean };
async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new Error('Too many requests. Please wait a moment and try again.');
    throw new Error(result?.error?.message || 'We couldn’t load this request. Please try again.');
  }
  if (!result || !('data' in result)) throw new Error('The service returned an incomplete response. Please try again.');
  return result.data as T;
}

export function MovieSearch({savedOnly = false}:{savedOnly?:boolean}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [result, setResult] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<FilmItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const importAttempt = useRef<{ tmdbId: number; key: string } | null>(null);
  const opening = useRef(false);
  const actionVersion = useRef(0);
  const resumeSelection = useRef<number | null>(null);
  const list = useFilmList();
  const normalized = query.trim();
  const validQuery = [...normalized].length >= 2 && [...normalized].length <= 100;

  useEffect(() => {
    const url = new URL(window.location.href);
    setQuery((url.searchParams.get('q') ?? '').slice(0,100));
    const initialPage = Number(url.searchParams.get('page'));
    if (Number.isInteger(initialPage) && initialPage >= 1 && initialPage <= 20) setPage(initialPage);
    const initialSelection = Number(url.searchParams.get('tmdbId'));
    if (Number.isSafeInteger(initialSelection) && initialSelection > 0) resumeSelection.current = initialSelection;
    setHydrated(true);
    return () => { actionVersion.current++; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams();
    if (normalized) params.set('q',normalized);
    if (page > 1) params.set('page',String(page));
    if (selected) params.set('tmdbId',String(selected.tmdbId));
    const queryString = params.toString();
    window.history.replaceState(window.history.state,'',`${window.location.pathname}${queryString ? `?${queryString}` : ''}`);
  }, [hydrated,normalized,page,selected]);

  useEffect(() => {
    if (savedOnly || !hydrated) return;
    const controller = new AbortController();
    setResult(null); setError(''); setLoading(validQuery);
    if (!validQuery) return () => controller.abort();
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({q:normalized,page:String(page)});
      fetch(`/api/v1/movies/search?${params}`,{signal:controller.signal})
        .then(readResponse<SearchPage>)
        .then(data => {
          if (controller.signal.aborted) return;
          setResult(data);
          const match = data.results.find(movie => movie.tmdbId === resumeSelection.current);
          if (match) {setSelected(match);resumeSelection.current=null;}
        })
        .catch(reason => {if(!controller.signal.aborted)setError(reason instanceof Error ? reason.message : 'Search could not connect.');})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },350);
    return ()=>{clearTimeout(timeout);controller.abort();};
  },[normalized,page,retry,validQuery,hydrated,savedOnly]);

  function closeSelection() {
    actionVersion.current++; opening.current=false; setImporting(false); setSelected(null); setImportError('');
  }
  async function openMovie(contribute: boolean) {
    if (!selected || opening.current) return;
    const movie = selected, version = ++actionVersion.current;
    opening.current=true; setImporting(true); setImportError('');
    try {
      if (movie.movieId) {window.location.assign(filmDestination(movie.movieId,contribute));return;}
      const session = await refreshAuthSession();
      if (version !== actionVersion.current) return;
      if (importAttempt.current?.tmdbId !== movie.tmdbId) importAttempt.current={tmdbId:movie.tmdbId,key:crypto.randomUUID()};
      const response = await fetch('/api/v1/movies/import',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':importAttempt.current.key},body:JSON.stringify({tmdbId:movie.tmdbId})});
      const data = await readResponse<{id:string}>(response);
      if (version===actionVersion.current) window.location.assign(filmDestination(data.id,contribute));
    } catch(reason) {if(version===actionVersion.current)setImportError(reason instanceof Error ? reason.message : 'Could not open this film. Please retry.');}
    finally {if(version===actionVersion.current){opening.current=false;setImporting(false);}}
  }
  function submitSearch(event:FormEvent) {event.preventDefault();setPage(1);setRetry(value=>value+1);}
  const movies = savedOnly ? list.films.filter(movie=>`${movie.title} ${movie.originalTitle}`.toLowerCase().includes(normalized.toLowerCase())) : result?.results ?? [];
  return <section className="film-browser" aria-label={savedOnly ? 'Your watched films' : 'Film search'}>
    <form className="film-search" onSubmit={submitSearch} role="search"><label htmlFor="film-query" className="film-field-label">{savedOnly ? 'Find in your watched films' : 'Film title'}</label><div className="film-search-control"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input id="film-query" type="search" value={query} maxLength={100} autoComplete="off" placeholder={savedOnly ? 'Find a saved film…' : 'Search films, in any language…'} onChange={event=>{setQuery(event.target.value);setPage(1);closeSelection();resumeSelection.current=null;}}/><button className="button" type="submit" disabled={!savedOnly&&!validQuery}>Search</button></div></form>
    <div role="status" aria-live="polite" className="film-result-count">{loading ? 'Searching…' : savedOnly ? `${movies.length} saved ${movies.length===1?'film':'films'} · on this browser` : result ? `${movies.length} ${movies.length===1?'film':'films'} · page ${page}` : 'Find a film. Choose what to do next.'}</div>
    {error || (savedOnly&&list.error) ? <div className="mvp-notice" role="alert"><p>{error || list.error}</p>{savedOnly ? <button className="film-secondary" onClick={()=>{if(window.confirm('Clear the watched list saved on this browser?'))list.clear();}}>Clear watched list</button> : <button className="film-secondary" onClick={()=>setRetry(value=>value+1)}>Retry search</button>}</div> : null}
    {movies.length ? <ul className="film-grid">{movies.map(movie=>{const poster=filmPoster(movie.posterPath);return <li key={movie.tmdbId}><button className="film-tile" type="button" aria-haspopup="dialog" aria-label={`Open actions for ${movie.title}${movie.year?` (${movie.year})`:''}`} onClick={()=>{setSelected(movie);setImportError('');}}><span className="film-tile-poster">{poster ? <img src={poster} alt="" width={185} height={278} loading="lazy"/> : <span className="film-poster-empty">No poster available</span>}<span className="film-tile-prompt" aria-hidden="true">View · Watched · Contribute</span></span><strong>{movie.title}</strong><span className="film-tile-meta">{movie.year??'Year unknown'} · {movie.language?.toUpperCase()??'—'}</span></button></li>;})}</ul> : (!loading&&(result||savedOnly&&list.ready)) ? <div className="film-empty"><h2>{savedOnly?'Films you have watched go here.':'No films found.'}</h2><p>{savedOnly?'Find a film and tap Mark as watched after you have seen it.':'Try another spelling or the original title.'}</p>{savedOnly?<a className="button" href="/search/">Find a film</a>:null}</div> : !normalized ? <div className="film-empty"><h2>Less guessing. Better movie nights.</h2><p>Search a title to check its guide, mark it as watched, or add what you noticed.</p><p className="fine">Movie details from TMDb. Content warnings from viewers.</p></div> : null}
    {!savedOnly&&result&&(page>1||result.hasMore)?<nav className="mvp-pagination" aria-label="Search result pages"><button className="film-secondary" disabled={page<=1||loading} onClick={()=>setPage(value=>value-1)}>Previous</button><span>{page}</span><button className="film-secondary" disabled={!result.hasMore||page>=20||loading} onClick={()=>setPage(value=>value+1)}>Next</button></nav>:null}
    {selected?<FilmDialog key={selected.tmdbId} film={selected} busy={importing} error={importError} onClose={closeSelection} onOpen={contribute=>void openMovie(contribute)}/>:null}
  </section>;
}

