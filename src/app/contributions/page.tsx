import type {Metadata} from 'next';
import {ContributionHistory} from '../../components/contribution-history';
import '../mvp.css';
export const metadata:Metadata={title:'My contributions',robots:{index:false,follow:false},alternates:{canonical:'/contributions/'}};
export default function ContributionsPage(){return <main id="main" className="wrap mvp-page"><div className="film-page-heading"><h1>My contributions</h1><p>Films you have added warnings or representation details to, most recently updated first. Saved to your account across devices.</p></div><ContributionHistory/></main>;}
