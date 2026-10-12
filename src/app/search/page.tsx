import type { Metadata } from 'next';
import { MovieSearch } from '../../components/movie-search';
import '../mvp.css';

export const metadata: Metadata = {
  title: 'Find a film',
  robots: { index: false, follow: true },
  alternates: { canonical: '/search/' },
};

export default function SearchPage() {
  return <main id="main" className="wrap mvp-page">
    <div className="mvp-intro"><span className="label">FIND YOUR NEXT FILM</span>
      <h1>Know before you watch.</h1>
      <p className="muted">Search by title, including a film’s original language. Content warnings come from viewers who have watched the film.</p>
    </div>
    <MovieSearch />
  </main>;
}
