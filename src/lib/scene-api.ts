import { errorResponse, idempotencyKey, readJsonBody, successResponse, validateMovieId } from './api-http';
import { requireActiveUser } from './auth';
import { createRequestClient } from './supabase/server';
import { validateMutation } from './request-security';
import { databaseError, publicDatabase } from './movie-api';
import { parseNoteInput, parseNoteDelete, parseNoteReport, parseSceneQuery } from './scene-contracts';
export type SceneContext={params:Promise<{id:string}>};
export async function sceneRequest(request:Request,context:SceneContext,operation:'list'|'reveal'|'own'|'put'|'delete'|'report'){
 let applyCookies:(response:Response)=>Response=response=>response;
 try{
  const id=validateMovieId((await context.params).id);
  const mutation=!['list','own'].includes(operation);
  if(mutation)validateMutation(request);
  let client=publicDatabase();
  if(['own','put','delete','report'].includes(operation)){
   const session=createRequestClient(request);applyCookies=session.applyCookies;client=session.client;
   await requireActiveUser(client);
  }
  let rpc:string;let args:Record<string,unknown>={p_movie_id:id};
  if(operation==='list'||operation==='reveal'){
   const url=new URL(request.url);
   if(operation==='list'&&Array.from(url.searchParams.keys()).some(k=>!['category','offset'].includes(k)))throw new Error('INVALID_REQUEST');
   const input=parseSceneQuery(operation==='reveal'?await readJsonBody(request):{categories:url.searchParams.getAll('category'),offset:Number(url.searchParams.get('offset')??0)},operation==='reveal');
   rpc='get_movie_notes';args={...args,p_categories:input.categories,p_level:input.level,p_limit:20,p_offset:input.offset};
  }else if(operation==='own'){rpc='get_my_movie_notes';}
  else{
   const body=await readJsonBody(request);args.p_idempotency_key=idempotencyKey(request);
   if(operation==='put'){
    const i=parseNoteInput(body);rpc='put_movie_note';args={...args,p_note_id:i.noteId,p_expected_revision:i.expectedRevision,p_watched:i.watched,p_category:i.category,p_comment:i.comment,p_start_seconds:i.startSeconds,p_end_seconds:i.endSeconds,p_version:i.version,p_spoiler_level:i.spoilerLevel,p_severity:i.severity};
   }else if(operation==='delete'){
    const i=parseNoteDelete(body);rpc='delete_movie_note';args={...args,p_note_id:i.noteId,p_expected_revision:i.expectedRevision};
   }else{
    const i=parseNoteReport(body);rpc='report_movie_note';args={...args,p_note_id:i.noteId,p_target_revision:i.targetRevision,p_reason:i.reason,p_correction:i.correction};
   }
  }
  const {data,error}=await client.rpc(rpc,args);databaseError(error);
  return applyCookies(successResponse(data));
 }catch(error){return applyCookies(errorResponse(error));}
}

