import type { Metadata } from 'next';
import { MovieSearch } from '../../components/movie-search';
import '../mvp.css';
export const metadata:Metadata={title:'Your watched films',robots:{index:false,follow:false},alternates:{canonical:'/watched/'}};
export default function WatchedPage(){return <main id="main" className="wrap mvp-page"><div className="film-page-heading"><h1>Your watched films</h1><p>Saved on this browser. Films stay here until you remove them or clear browser data.</p></div><MovieSearch savedOnly/></main>;}

