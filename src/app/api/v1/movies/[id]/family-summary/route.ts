import {representationRequest,type RepresentationContext} from '../../../../../../lib/representation-api';
import { errorResponse, successResponse, validateMovieId, ApiError } from '../../../../../../lib/api-http';
import { publicDatabase, databaseError } from '../../../../../../lib/movie-api';
export const runtime='nodejs';
export const POST=(r:Request,c:RepresentationContext)=>representationRequest(r,c,'family');
/** Independent, spoiler-free opinions are public; protected warnings remain gated. */
export async function GET(request: Request, context: RepresentationContext) {
  try {
    if (new URL(request.url).search) throw new ApiError('INVALID_REQUEST');
    const id = validateMovieId((await context.params).id);
    const { data, error } = await publicDatabase().rpc('get_family_summary', { p_movie_id: id }); databaseError(error);
    return successResponse(data);
  } catch (error) { return errorResponse(error); }
}
