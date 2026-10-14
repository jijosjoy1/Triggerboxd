'use client';
import {useEffect,useRef,useState} from 'react';
import {FilmDialog} from './film-dialog';
import {useFilmList} from './film-list';
import {filmDestination,filmPoster,type FilmItem} from '../lib/film-list';
import {refreshAuthSession} from '../lib/supabase/browser';

export function RecentFilms({films}:{films:FilmItem[]}) {
  const [index,setIndex]=useState(0),[paused,setPaused]=useState(false),[hovered,setHovered]=useState(false);
  const [selected,setSelected]=useState<FilmItem|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const attempt=useRef<{id:number;key:string}|null>(null),version=useRef(0);
  const list=useFilmList();
  useEffect(()=>()=>{version.current++;},[]);
  useEffect(()=>{
    if(films.length<2 || paused || hovered || selected)return;
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer:ReturnType<typeof setInterval>|undefined;
    function sync(){if(timer)clearInterval(timer);if(!motion.matches && !document.hidden)timer=setInterval(()=>setIndex(i=>(i+1)%films.length),7000);}
    sync();motion.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
    return ()=>{if(timer)clearInterval(timer);motion.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
  },[films.length,paused,hovered,selected]);
  async function open(contribute:boolean){
    if(!selected || busy || contribute&&!list.films.some(f=>f.tmdbId===selected.tmdbId))return;
    const current=++version.current;setBusy(true);setError('');
    try {
      let id=selected.movieId;
      if(!id){
        const session=await refreshAuthSession();if(current!==version.current)return;
        if(attempt.current?.id!==selected.tmdbId)attempt.current={id:selected.tmdbId,key:crypto.randomUUID()};
        const response=await fetch('/api/v1/movies/import',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':attempt.current.key},body:JSON.stringify({tmdbId:selected.tmdbId})});
        const result=await response.json();
        if(!response.ok)throw new Error(result?.error?.message??'Could not open this film. Please retry.');
        id=result?.data?.id;
      }
      if(current===version.current)window.location.assign(filmDestination(id??'',contribute));
    }catch(e){if(current===version.current)setError(e instanceof Error?e.message:'Could not open this film.');}
    finally{if(current===version.current)setBusy(false);}
  }
  if(!films.length)return <section className="recent-empty"><h2>Find your next movie night.</h2><p>Recent releases are temporarily unavailable.</p><a className="text-link" href="/search/">Search films →</a></section>;
  const film=films[index%films.length],poster=filmPoster(film.posterPath);
  return <section className="recent-films" aria-label="Recent Indian releases" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setHovered(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setHovered(false);}}>
    <div className="recent-feature"><button className="recent-poster" type="button" aria-label={`Open actions for ${film.title}`} aria-haspopup="dialog" onClick={()=>{setSelected(film);setError('');}}>{poster?<img src={poster} width={228} height={342} alt={`${film.title} poster`}/>:null}</button><div className="recent-caption"><p className="recent-label">Recent Indian releases</p><h2>{film.title}</h2><p>{film.year??'Year unknown'} · {film.language?.toUpperCase()??'Language unknown'}</p><button className="button" type="button" onClick={()=>{setSelected(film);setError('');}}>Explore film ↗</button><p className="fine">Metadata from TMDb. Warnings from viewers.</p></div></div>
    {films.length>1?<div className="recent-controls"><button type="button" aria-label="Previous movie" onClick={()=>{setPaused(true);setIndex(i=>(i+films.length-1)%films.length);}}>←</button><span>{index+1} / {films.length}</span><button type="button" aria-label="Next movie" onClick={()=>{setPaused(true);setIndex(i=>(i+1)%films.length);}}>→</button><button type="button" aria-pressed={paused} onClick={()=>setPaused(!paused)}>{paused?'Resume rotation':'Pause rotation'}</button></div>:null}
    <ul className="recent-thumbnails">{films.map((f,i)=><li key={f.tmdbId}><button type="button" aria-label={`Show ${f.title}`} aria-pressed={index===i} onClick={()=>{setPaused(true);setIndex(i);}}><img src={filmPoster(f.posterPath,'w185')!} alt="" width={62} height={93} loading="lazy"/></button></li>)}</ul>
    {selected?<FilmDialog film={selected} busy={busy} error={error} onOpen={contribute=>void open(contribute)} onClose={()=>{version.current++;setSelected(null);setBusy(false);setError('');}}/>:null}
  </section>;
}
