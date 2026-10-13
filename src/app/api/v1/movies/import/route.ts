import { errorResponse,idempotencyKey,readJsonBody,successResponse } from '../../../../../lib/api-http';
import { parseImportMovieInput } from '../../../../../lib/validation';
import { AuthError, requireActiveUser } from '../../../../../lib/auth';
import { createRequestClient } from '../../../../../lib/supabase/server';
import { validateMutation } from '../../../../../lib/request-security';
import { databaseError,searchSubject,serviceDatabase,tmdbGateway } from '../../../../../lib/movie-api';
export const runtime='nodejs';
export async function POST(request:Request){
  let applyCookies:(response:Response)=>Response=response=>response;
  try{
    validateMutation(request);
    const context=createRequestClient(request);applyCookies=context.applyCookies;
    let user;
    try { user=await requireActiveUser(context.client); }
    catch(error) { if(!(error instanceof AuthError)||error.code!=='AUTH_REQUIRED')throw error; }
    const body=parseImportMovieInput(await readJsonBody(request));
    const key=idempotencyKey(request);
    if(!user){
      const quota=await serviceDatabase().rpc('consume_public_import_quota',{p_subject_hash:await searchSubject(request)});
      databaseError(quota.error);
    }
    const movie=await tmdbGateway().getMovieDetails(body.tmdbId);
    if(!user){
      const {data,error}=await serviceDatabase().rpc('import_public_movie',{
        p_tmdb_id:movie.tmdbId,
        p_metadata:{title:movie.title,originalTitle:movie.originalTitle,releaseDate:movie.releaseDate,language:movie.language,productionCountries:movie.productionCountries,posterPath:movie.posterPath,synopsis:movie.overview},
      });
      databaseError(error);
      return applyCookies(successResponse({id:data.id,tmdbId:data.tmdbId},data.created?201:200));
    }
    const {data,error}=await serviceDatabase().rpc('import_movie',{
      p_actor_id:user.id,p_tmdb_id:movie.tmdbId,p_idempotency_key:key,
      p_metadata:{title:movie.title,originalTitle:movie.originalTitle,releaseDate:movie.releaseDate,language:movie.language,productionCountries:movie.productionCountries,posterPath:movie.posterPath,synopsis:movie.overview},
    });
    databaseError(error);
    return applyCookies(successResponse({id:data.id,tmdbId:data.tmdbId},data.created?201:200));
  }catch(error){return applyCookies(errorResponse(error));}
}
