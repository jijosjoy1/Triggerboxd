'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useAuthSession} from '../lib/supabase/browser';
import {filmPoster} from '../lib/film-list';
type History={page:number;hasMore:boolean;results:{updatedAt:string;visibility:string;movie:{id:string;title:string;release_date:string|null;original_language:string|null;poster_path:string|null}|null}[]};
export function ContributionHistory(){
  const {session,loading:authLoading,error:authError}=useAuthSession();
  const [page,setPage]=useState(1),[retry,setRetry]=useState(0);
  const [stored,setStored]=useState<{userId:string;history:History}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const userId=session?.user?.id;
  const result=stored?.userId===userId?stored?.history??null:null;
  useEffect(()=>{
    const abort=new AbortController();setStored(null);setError('');setLoading(false);
    if(!userId)return;
    setLoading(true);
    void fetch(`/api/v1/me/contributions?page=${page}`,{cache:'no-store',signal:abort.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Could not load your contributions.');
      if(!abort.signal.aborted)setStored({userId,history:body.data});
    }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not load your contributions.');})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[userId,page,retry]);
  if(authLoading)return <p role="status">Checking sign-in…</p>;
  if(authError)return <p role="alert">{authError}</p>;
  if(!userId)return <Link className="button" href="/login/?next=%2Fcontributions%2F">Sign in to see your contributions</Link>;
  return <>{loading?<p role="status">Loading your contributions…</p>:null}{error?<div role="alert"><p>{error}</p><button className="mvp-secondary" onClick={()=>setRetry(value=>value+1)}>Try again</button></div>:null}
    {result?.results.length?<ul className="film-grid">{result.results.map((entry,index)=>{const movie=entry.movie,poster=filmPoster(movie?.poster_path??null);return <li key={movie?.id??index}>{movie?<Link className="film-tile" href={`/movies/${movie.id}/#contribute`}><span className="film-tile-poster">{poster?<img src={poster} alt="" width={185} height={278} loading="lazy"/>:<span className="film-poster-empty">No poster available</span>}</span><strong>{movie.title}</strong><span className="film-tile-meta">{movie.release_date?.slice(0,4)??'Year unknown'} · {movie.original_language?.toUpperCase()??'—'}</span><span className="fine contribution-updated">Updated <time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleDateString()}</time>{entry.visibility==='hidden'?' · Hidden from public guide':''}</span></Link>:<div className="film-tile"><strong>Film unavailable</strong><span className="fine">Your contribution is saved, but this film is not publicly available.</span></div>}</li>;})}</ul>:result&&!loading?<div className="film-empty"><h2>{page===1?'Your contributions will appear here.':'No more contributions.'}</h2>{page===1?<Link className="button" href="/search/">Find a film</Link>:null}</div>:null}
    {!loading&&!error&&(page>1||result?.hasMore)?<nav className="contribution-pagination" aria-label="Contribution pages"><button className="mvp-secondary" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {page}</span><button className="mvp-secondary" disabled={!result?.hasMore} onClick={()=>setPage(value=>value+1)}>Next</button></nav>:null}</>;
}
