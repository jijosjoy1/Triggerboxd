import {ApiError,errorResponse,successResponse} from '../../../../../lib/api-http';
import {requireActiveUser} from '../../../../../lib/auth';
import {createRequestClient} from '../../../../../lib/supabase/server';
import {databaseError} from '../../../../../lib/movie-api';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  let applyCookies:(response:Response)=>Response=response=>response;
  try{
    const session=createRequestClient(request);applyCookies=session.applyCookies;
    const user=await requireActiveUser(session.client);
    const raw=new URL(request.url).searchParams.get('page')??'1';
    if(!/^[1-9][0-9]{0,4}$/.test(raw))throw new ApiError('INVALID_REQUEST');
    const page=Number(raw),offset=(page-1)*24;
    // Both explicit ownership and existing RLS restrict this to the signed-in account.
    const {data,error}=await session.client.from('contributions')
      .select('updated_at,visibility,movies(id,title,release_date,original_language,poster_path)')
      .eq('user_id',user.id).order('updated_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+24);
    databaseError(error);
    const rows=data??[];
    return applyCookies(successResponse({page,hasMore:rows.length>24,results:rows.slice(0,24).map(row=>({updatedAt:row.updated_at,visibility:row.visibility,movie:Array.isArray(row.movies)?row.movies[0]??null:row.movies}))}));
  }catch(error){return applyCookies(errorResponse(error));}
}
