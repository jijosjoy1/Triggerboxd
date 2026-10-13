'use client';
import { useCallback, useEffect, useState } from 'react';
import { FILM_LIST_EVENT, FILM_LIST_KEY, parseFilmList, toggleFilm, type FilmItem } from '../lib/film-list';

export function useFilmList() {
  const [films, setFilms] = useState<FilmItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    function read() {
      try { setFilms(parseFilmList(localStorage.getItem(FILM_LIST_KEY))); setError(''); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Watchlist storage is unavailable on this browser.'); }
      setReady(true);
    }
    function storage(event: StorageEvent) { if (event.key === FILM_LIST_KEY || event.key === null) read(); }
    read(); window.addEventListener('storage', storage); window.addEventListener(FILM_LIST_EVENT, read);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(FILM_LIST_EVENT, read); };
  }, []);
  const toggle = useCallback((film: FilmItem) => {
    try {
      const current = parseFilmList(localStorage.getItem(FILM_LIST_KEY));
      const next = toggleFilm(current, film);
      localStorage.setItem(FILM_LIST_KEY, JSON.stringify(next));
      setFilms(next); setError(''); window.dispatchEvent(new Event(FILM_LIST_EVENT));
      return !current.some(item => item.tmdbId === film.tmdbId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this film. Browser storage may be full or disabled.');
      return null;
    }
  }, []);
  const clear = useCallback(() => {
    try { localStorage.removeItem(FILM_LIST_KEY); setFilms([]); setError(''); window.dispatchEvent(new Event(FILM_LIST_EVENT)); }
    catch { setError('Browser storage is unavailable.'); }
  }, []);
  return { films, ready, error, toggle, clear };
}

export function WatchlistButton({film}:{film:FilmItem}) {
  const list = useFilmList();
  const saved = list.films.some(item => item.tmdbId === film.tmdbId);
  return <div className="film-save"><button className="film-secondary" type="button" disabled={!list.ready} aria-pressed={saved} onClick={()=>list.toggle(film)}>{saved ? '✓ In watchlist' : '+ Watchlist'}</button><span className="film-save-note">Saved on this browser</span>{list.error ? <p role="alert" className="form-error">{list.error}</p> : null}</div>;
}
