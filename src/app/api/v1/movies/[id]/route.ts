import { errorResponse,successResponse,validateMovieId,ApiError } from '../../../../../lib/api-http';
import { databaseError,publicDatabase } from '../../../../../lib/movie-api';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const id=validateMovieId((await params).id);
    const {data,error}=await publicDatabase().rpc('get_movie_summary',{p_movie_id:id});
    databaseError(error);if(!data)throw new ApiError('NOT_FOUND');
    return successResponse(data);
  }catch(error){return errorResponse(error);}
}
