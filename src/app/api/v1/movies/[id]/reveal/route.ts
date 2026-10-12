import { errorResponse,readJsonBody,successResponse,validateMovieId } from '../../../../../../lib/api-http';
import { createRequestClient } from '../../../../../../lib/supabase/server';
import { validateMutation } from '../../../../../../lib/request-security';
import { databaseError } from '../../../../../../lib/movie-api';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
import { parseRevealWarningsInput } from '../../../../../../lib/validation';
/** Explicit same-origin reveal; no authentication or persisted reveal preference. */
export async function POST(request:Request,context:Context){
 let applyCookies:(response:Response)=>Response=response=>response;
 try{
  validateMutation(request);
  const session=createRequestClient(request);applyCookies=session.applyCookies;
  const id=validateMovieId((await context.params).id);
  const input=parseRevealWarningsInput(await readJsonBody(request));
  const {data,error}=await session.client.rpc('reveal_movie_warnings',{p_movie_id:id,p_categories:input.categories,p_level:input.level});
  databaseError(error);return applyCookies(successResponse(data));
 }catch(error){return applyCookies(errorResponse(error));}
}

