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
    <div className="film-page-heading">
      <h1>Find a film</h1>
      <p>Check the guide. Mark as watched. Share what you noticed.</p>
    </div>
    <MovieSearch />
  </main>;
}

