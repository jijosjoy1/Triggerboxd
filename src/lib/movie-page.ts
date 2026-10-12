import { cache } from 'react';
import type { Movie } from '../components/movie-warnings';
import { validateMovieId } from './api-http';
import { publicDatabase } from './movie-api';

/** Request-scoped React cache shares metadata/page reads, never user data across requests. */
export const loadPublicMovie=cache(async(id:string):Promise<Movie|null>=>{
  try{
    validateMovieId(id);
    const {data,error}=await publicDatabase().rpc('get_movie_summary',{p_movie_id:id});
    if(error||!data)return null;
    return data as Movie;
  }catch{return null;}
});
