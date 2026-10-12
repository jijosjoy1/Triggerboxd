import { errorResponse,idempotencyKey,readJsonBody,successResponse,validateMovieId } from '../../../../../../lib/api-http';
import { requireActiveUser } from '../../../../../../lib/auth';
import { createRequestClient } from '../../../../../../lib/supabase/server';
import { validateMutation } from '../../../../../../lib/request-security';
import { databaseError } from '../../../../../../lib/movie-api';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
import { parseFamilyVoteInput } from '../../../../../../lib/validation';
async function handle(request:Request,context:Context){
 let applyCookies:(response:Response)=>Response=response=>response;
 try{
  if(request.method!=='GET')validateMutation(request);
  const session=createRequestClient(request);applyCookies=session.applyCookies;
  await requireActiveUser(session.client);
  const id=validateMovieId((await context.params).id);
  if(request.method==='GET'){
   const {data,error}=await session.client.rpc('get_my_family_vote',{p_movie_id:id});
   databaseError(error);return applyCookies(successResponse(data));
  }
  const input=parseFamilyVoteInput(await readJsonBody(request));
  const {data,error}=await session.client.rpc('put_family_vote',{
   p_movie_id:id,p_expected_revision:input.expectedRevision,p_watched:true,p_value:input.value,p_idempotency_key:idempotencyKey(request)});
  databaseError(error);return applyCookies(successResponse(data));
 }catch(error){return applyCookies(errorResponse(error));}
}
export const GET=handle;
export const PUT=handle;

