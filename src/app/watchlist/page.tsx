import type { Metadata } from 'next';
import { MovieSearch } from '../../components/movie-search';
import '../mvp.css';
export const metadata:Metadata={title:'Your watchlist',robots:{index:false,follow:false},alternates:{canonical:'/watchlist/'}};
export default function WatchlistPage(){return <main id="main" className="wrap mvp-page"><div className="film-page-heading"><h1>Your watchlist</h1><p>Saved on this browser. Films stay here until you remove them or clear browser data.</p></div><MovieSearch savedOnly/></main>;}
