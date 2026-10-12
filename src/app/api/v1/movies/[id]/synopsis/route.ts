import { errorResponse, readJsonBody, successResponse, validateMovieId } from '../../../../../../lib/api-http';
import { publicDatabase, databaseError } from '../../../../../../lib/movie-api';
import { validateMutation } from '../../../../../../lib/request-security';
import { ApiError } from '../../../../../../lib/api-http';

export const runtime = 'nodejs';
/** Synopsis is deliberately absent from default movie payloads. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    validateMutation(request);
    const body = await readJsonBody(request);
    if (Object.keys(body).length !== 1 || body.reveal !== true) throw new ApiError('INVALID_REQUEST');
    const id = validateMovieId((await context.params).id);
    const { data, error } = await publicDatabase().from('movies').select('synopsis').eq('id', id).eq('visibility', 'published').maybeSingle();
    databaseError(error);
    if (!data) throw new ApiError('NOT_FOUND');
    return successResponse({ synopsis: data.synopsis ?? null });
  } catch (error) { return errorResponse(error); }
}
