import type { Metadata } from 'next';
import { MovieDetail } from '../../../components/movie-warnings';
import { loadPublicMovie } from '../../../lib/movie-page';
import { tmdbGateway } from '../../../lib/movie-api';
import '../../mvp.css';

export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{id:string}>}):Promise<Metadata>{
  const {id}=await params;
  const movie=await loadPublicMovie(id);
  return {title:movie?`${movie.title} content warnings`:'Film content guide',
    description:movie?`Viewer-reported content intensity for ${movie.title}. Unanswered categories remain Unknown.`:'Viewer content warnings.',
    alternates:{canonical:`/movies/${encodeURIComponent(id)}/`},robots:{index:!!movie&&movie.contributorCount>=3,follow:true}};
}

export default async function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const movie=await loadPublicMovie(id);
  let certifications: string[] = [];
  let runtime: number | null = null;
  let genres: string[] = [];
  if (movie) {
    try { ({ certifications, runtime, genres } = await tmdbGateway().getMoviePresentation(movie.tmdbId)); }
    catch { /* Optional metadata must never block warnings or contributions. */ }
  }
  return <main id="main" className="wrap mvp-page"><MovieDetail movieId={id} initialMovie={movie} certifications={certifications} runtime={runtime} genres={genres} /></main>;
}
