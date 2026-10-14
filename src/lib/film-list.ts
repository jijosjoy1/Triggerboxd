import { isUuid } from './validation';

export type FilmItem = { tmdbId: number; movieId?: string | null; title: string; originalTitle: string; year: number | null; language: string | null; posterPath: string | null };
export const FILM_LIST_KEY = 'triggerboxd.watched.v1';
export const FILM_LIST_EVENT = 'triggerboxd:watched';
export const MAX_SAVED_FILMS = 200;

export function cleanFilm(value: unknown): FilmItem | null {
  if (!value || typeof value !== 'object') return null;
  const film = value as Record<string, unknown>;
  if (!Number.isSafeInteger(film.tmdbId) || Number(film.tmdbId) <= 0 || typeof film.title !== 'string' || !film.title.trim() || film.title.length > 500) return null;
  return {
    tmdbId: Number(film.tmdbId), movieId: typeof film.movieId === 'string' && isUuid(film.movieId) ? film.movieId : null,
    title: film.title, originalTitle: typeof film.originalTitle === 'string' ? film.originalTitle.slice(0, 500) : film.title,
    year: Number.isInteger(film.year) && Number(film.year) > 1800 && Number(film.year) < 3000 ? Number(film.year) : null,
    language: typeof film.language === 'string' && /^[a-z]{2,3}$/i.test(film.language) ? film.language : null,
    posterPath: typeof film.posterPath === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(film.posterPath) && !film.posterPath.includes('..') && !film.posterPath.startsWith('//') ? film.posterPath : null,
  };
}

export function parseFilmList(raw: string | null): FilmItem[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error('Saved films could not be read. Clear the watched list to start again.'); }
  if (!Array.isArray(data)) throw new Error('Saved films could not be read. Clear the watched list to start again.');
  const seen = new Set<number>();
  return data.slice(0, MAX_SAVED_FILMS).flatMap(value => {
    const movie = cleanFilm(value);
    if (!movie || seen.has(movie.tmdbId)) return [];
    seen.add(movie.tmdbId); return [movie];
  });
}

export function toggleFilm(list: FilmItem[], film: FilmItem): FilmItem[] {
  const clean = cleanFilm(film);
  if (!clean) throw new Error('This film could not be saved.');
  if (list.some(item => item.tmdbId === clean.tmdbId)) return list.filter(item => item.tmdbId !== clean.tmdbId);
  if (list.length >= MAX_SAVED_FILMS) throw new Error('Your watched films has 200 films. Remove one before adding another.');
  return [clean, ...list];
}

export function filmDestination(id: string, contribute = false) {
  if (!isUuid(id)) throw new Error('The film service returned an invalid film address. Please retry.');
  return `/movies/${id}/${contribute ? '#contribute' : ''}`;
}

export function filmPoster(path: string | null, size: 'w185' | 'w342' | 'w500' = 'w342') {
  return path && /^\/[A-Za-z0-9_./-]+$/.test(path) && !path.includes('..') && !path.startsWith('//') ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

