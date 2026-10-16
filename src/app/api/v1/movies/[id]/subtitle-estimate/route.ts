import { errorResponse, successResponse, validateMovieId } from '../../../../../../lib/api-http';
import { databaseError, publicDatabase } from '../../../../../../lib/movie-api';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const id=validateMovieId((await context.params).id);
    const {data,error}=await publicDatabase().rpc('get_subtitle_estimate',{p_movie_id:id}); databaseError(error);
    return successResponse(data);
  }catch(error){return errorResponse(error);}
}
