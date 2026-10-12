import { errorResponse,idempotencyKey,readJsonBody,successResponse,validateMovieId } from '../../../../../../lib/api-http';
import { parseContributionInput,parseDeleteContributionInput } from '../../../../../../lib/validation';
import { requireActiveUser } from '../../../../../../lib/auth';
import { createRequestClient } from '../../../../../../lib/supabase/server';
import { validateMutation } from '../../../../../../lib/request-security';
import { databaseError } from '../../../../../../lib/movie-api';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
async function handle(request:Request,context:Context){
  let applyCookies:(response:Response)=>Response=response=>response;
  try{
    if(request.method!=='GET')validateMutation(request);
    const session=createRequestClient(request);applyCookies=session.applyCookies;
    await requireActiveUser(session.client);
    const id=validateMovieId((await context.params).id);
    if(request.method==='GET'){
      const {data,error}=await session.client.rpc('get_my_contribution',{p_movie_id:id});databaseError(error);
      return applyCookies(successResponse(data));
    }
    const body=await readJsonBody(request);
    const input=request.method==='DELETE'?parseDeleteContributionInput(body):parseContributionInput(body);
    const args={p_movie_id:id,p_expected_revision:input.expectedRevision,p_idempotency_key:idempotencyKey(request)};
    if(request.method==='DELETE'){
      const {error}=await session.client.rpc('delete_contribution',args);databaseError(error);
      return applyCookies(new Response(null,{status:204,headers:{'cache-control':'private, no-store'}}));
    }
    const ratings=parseContributionInput(body).ratings;
    const {data,error}=await session.client.rpc('put_contribution',{...args,p_watched:true,p_ratings:ratings});databaseError(error);
    return applyCookies(successResponse(data));
  }catch(error){return applyCookies(errorResponse(error));}
}
export const GET=handle;
export const PUT=handle;
export const DELETE=handle;
