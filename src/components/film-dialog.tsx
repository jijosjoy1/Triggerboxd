'use client';
import { useEffect, useId, useRef } from 'react';
import { filmPoster, type FilmItem } from '../lib/film-list';
import { useFilmList } from './film-list';

export function FilmDialog({film,busy,error,onClose,onOpen}:{film:FilmItem;busy:boolean;error:string;onClose:()=>void;onOpen:(contribute:boolean)=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const list = useFilmList();
  const poster = filmPoster(film.posterPath);
  const saved = list.films.some(item => item.tmdbId === film.tmdbId);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    element?.showModal(); closeButton.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={dialog} className="film-dialog" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="film-dialog-content"><button ref={closeButton} type="button" className="film-close" aria-label="Close movie actions" onClick={onClose}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      <div className="film-dialog-header">{poster ? <img src={poster} width={150} height={225} alt={`${film.title} poster`}/> : <div className="film-poster-empty" aria-hidden="true">No poster</div>}<div><h2 id={titleId}>{film.title}</h2><p>{film.year ?? 'Year unknown'} · {film.language?.toUpperCase() ?? 'Language unknown'}</p>{film.originalTitle!==film.title ? <p className="film-original">{film.originalTitle}</p> : null}</div></div>
      <div className="film-dialog-actions"><button type="button" className="button" disabled={busy} onClick={()=>onOpen(false)}>{busy ? 'Opening…' : 'View guide'}</button><button type="button" className="film-secondary" aria-pressed={saved} disabled={!list.ready} onClick={()=>list.toggle(film)}>{saved ? '✓ In watchlist' : '+ Watchlist'}</button><button type="button" className="film-secondary" disabled={busy} onClick={()=>onOpen(true)}>Contribute</button></div>
      <p className="film-save-note">Watchlist saves on this browser.</p>{error || list.error ? <p className="form-error" role="alert">{error || list.error}</p> : null}
    </div>
  </dialog>;
}
