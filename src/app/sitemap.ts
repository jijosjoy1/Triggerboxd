import type {MetadataRoute} from 'next';
import {publicDatabase} from '../lib/movie-api';
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  const pages:MetadataRoute.Sitemap=['','/about','/privacy'].map(path=>({url:`https://triggerboxd.com${path}/`}));
  // Empty/unconfigured/hidden guides never enter the sitemap.
  try{
    const {data,error}=await publicDatabase().rpc('get_indexable_movies',{p_limit:500,p_offset:0});
    if(!error&&Array.isArray(data))for(const movie of data){
      if(typeof movie.id==='string')pages.push({url:`https://triggerboxd.com/movies/${movie.id}/`,lastModified:movie.updatedAt});
    }
  }catch{/* Provider setup is pending; retain the public marketing sitemap. */}
  return pages;
}
