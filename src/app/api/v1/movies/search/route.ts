import { errorResponse, successResponse } from '../../../../../lib/api-http';
import { parseSearchInput } from '../../../../../lib/validation';
import { databaseError, publicDatabase, searchSubject, serviceDatabase, tmdbGateway } from '../../../../../lib/movie-api';
export const runtime='nodejs';
export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const {query,page}=parseSearchInput(url.searchParams.get('q'),url.searchParams.get('page')??'1');
    const gateway=tmdbGateway();
    const {error}=await serviceDatabase().rpc('consume_search_quota',{p_subject_hash:await searchSubject(request)});
    databaseError(error);
    const result=await gateway.searchMovies({query,page});
    const ids=result.results.map(movie=>movie.tmdbId);
    const existing=ids.length?await publicDatabase().from('movies').select('id,tmdb_id').in('tmdb_id',ids):{data:[],error:null};
    databaseError(existing.error);
    const lookup=new Map((existing.data??[]).map(movie=>[Number(movie.tmdb_id),String(movie.id)]));
    return successResponse({...result,results:result.results.map(movie=>({...movie,movieId:lookup.get(movie.tmdbId)??null}))});
  }catch(error){return errorResponse(error);}
}
