import { errorResponse, validateMovieId } from '../../../../../lib/api-http';
import { databaseError, publicDatabase } from '../../../../../lib/movie-api';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = validateMovieId((await context.params).id);
    const { data, error } = await publicDatabase().rpc('get_profile_picture', { p_id: id }); databaseError(error);
    if (typeof data !== 'string') return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
    return new Response(Buffer.from(data, 'base64'), { headers: {
      'content-type': 'image/jpeg', 'content-disposition': 'inline; filename="profile.jpg"',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'no-store', 'x-robots-tag': 'noindex',
    } });
  } catch (error) { return errorResponse(error); }
}
