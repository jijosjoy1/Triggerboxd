import { errorResponse,idempotencyKey,readJsonBody,successResponse,validateMovieId } from '../../../../../../lib/api-http';
import { requireActiveUser } from '../../../../../../lib/auth';
import { createRequestClient } from '../../../../../../lib/supabase/server';
import { validateMutation } from '../../../../../../lib/request-security';
import { databaseError } from '../../../../../../lib/movie-api';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
import { parsePatchWarningInput } from '../../../../../../lib/validation';
export async function PATCH(request:Request,context:Context){
 let applyCookies:(response:Response)=>Response=response=>response;
 try{
  validateMutation(request);
  const session=createRequestClient(request);applyCookies=session.applyCookies;
  await requireActiveUser(session.client);
  const id=validateMovieId((await context.params).id);
  const input=parsePatchWarningInput(await readJsonBody(request));
  const {data,error}=await session.client.rpc('patch_warning',{
   p_movie_id:id,p_expected_revision:input.expectedRevision,p_watched:true,
   p_category:input.category,p_severity:input.severity,p_spoiler_level:input.spoilerLevel,
   p_descriptors:input.descriptors,p_idempotency_key:idempotencyKey(request)});
  databaseError(error);return applyCookies(successResponse(data));
 }catch(error){return applyCookies(errorResponse(error));}
}

