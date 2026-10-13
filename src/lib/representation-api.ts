import { errorResponse,idempotencyKey,readJsonBody,successResponse,validateMovieId,ApiError } from './api-http';
import { requireActiveUser } from './auth';
import { createRequestClient } from './supabase/server';
import { validateMutation } from './request-security';
import { databaseError,publicDatabase } from './movie-api';
import { parseFamilyCheck,parseRepresentationReveal,parseRepresentationWrite } from './representation-contracts';
export type RepresentationContext={params:Promise<{id:string}>};
export async function representationRequest(request:Request,context:RepresentationContext,operation:'list'|'reveal'|'own'|'put'|'delete'|'family'){
 let applyCookies:(response:Response)=>Response=response=>response;
 try{
  const id=validateMovieId((await context.params).id);
  if(new URL(request.url).search)throw new ApiError('INVALID_REQUEST');
  if(!['list','own'].includes(operation))validateMutation(request);
  let client=publicDatabase();
  if(['own','put','delete'].includes(operation)){const session=createRequestClient(request);applyCookies=session.applyCookies;client=session.client;await requireActiveUser(client);}
  let rpc='get_representation';let args:Record<string,unknown>={p_movie_id:id};
  if(operation==='list')args={...args,p_slugs:[],p_level:0};
  else if(operation==='reveal'){const i=parseRepresentationReveal(await readJsonBody(request));args={...args,p_slugs:[i.slug],p_level:i.level};}
  else if(operation==='own')rpc='get_my_representation';
  else if(operation==='family'){parseFamilyCheck(await readJsonBody(request));rpc='get_family_summary';}
  else {const i=parseRepresentationWrite(await readJsonBody(request),operation==='delete');rpc='put_representation';args={...args,p_expected_revision:i.expectedRevision,p_watched:true,p_slug:i.slug,p_spoiler_level:i.spoilerLevel,p_remove:i.remove,p_idempotency_key:idempotencyKey(request)};}
  const {data,error}=await client.rpc(rpc,args);databaseError(error);return applyCookies(successResponse(data));
 }catch(error){return applyCookies(errorResponse(error));}
}
