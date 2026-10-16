import { ApiError, errorResponse, readJsonBody, successResponse } from '../../../../../lib/api-http';
import { parseSubtitleAction } from '../../../../../lib/subtitle-estimates';
import { requireActiveUser } from '../../../../../lib/auth';
import { databaseError } from '../../../../../lib/movie-api';
import { validateMutation } from '../../../../../lib/request-security';
import { createRequestClient } from '../../../../../lib/supabase/server';
export const dynamic = 'force-dynamic';
async function handle(request: Request, mutation: boolean) {
  let applyCookies = (response: Response) => response;
  try {
    if (mutation) validateMutation(request);
    const scoped = createRequestClient(request); applyCookies = scoped.applyCookies;
    await requireActiveUser(scoped.client);
    // Authorize through the owner-checked RPC before doing any movie lookup.
    const query = new URL(request.url).searchParams.get('q');
    if (query && query.length > 100) throw new ApiError('INVALID_REQUEST');
    if (!mutation) {
      const {data,error} = await scoped.client.rpc('get_admin_subtitle_jobs',{p_query:query}); databaseError(error);
      return applyCookies(successResponse(data));
    }
    const action = parseSubtitleAction(await readJsonBody(request));
    let args: Record<string,unknown>;
    if (action.action==='enqueue') {
      // Search is restricted to the already imported catalogue for the first pilot.
      const check = await scoped.client.rpc('get_admin_subtitle_jobs',{p_query:null}); databaseError(check.error);
      const {data,error} = await scoped.client.from('movies').select('id').eq('tmdb_id',action.tmdbId).eq('visibility','published').maybeSingle(); databaseError(error);
      if (!data) throw new ApiError('NOT_FOUND');
      args={p_action:'enqueue',p_movie_id:data.id};
    } else {
      args={p_action:action.action,p_id:action.id,p_expected_revision:action.expectedRevision,p_note:action.note,
        p_rating:action.action==='approve'?action.rating:null,p_watched:action.action==='approve'};
    }
    const {data,error}=await scoped.client.rpc('admin_subtitle_action',args); databaseError(error);
    return applyCookies(successResponse(data));
  } catch(error) { return applyCookies(errorResponse(error)); }
}
export const GET=(request:Request)=>handle(request,false);
export const POST=(request:Request)=>handle(request,true);
