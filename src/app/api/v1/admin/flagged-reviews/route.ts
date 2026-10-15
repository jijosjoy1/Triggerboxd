import { errorResponse, successResponse, ApiError } from '../../../../../lib/api-http';
import { parseAdminPaging } from '../../../../../lib/admin';
import { requireActiveUser } from '../../../../../lib/auth';
import { databaseError } from '../../../../../lib/movie-api';
import { createRequestClient } from '../../../../../lib/supabase/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let applyCookies = (response: Response) => response;
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['limit', 'offset'].includes(key))) throw new ApiError('INVALID_REQUEST');
    const paging = parseAdminPaging(query.get('limit'), query.get('offset')); if (!paging.ok) throw new ApiError('INVALID_REQUEST');
    const scoped = createRequestClient(request); applyCookies = scoped.applyCookies; await requireActiveUser(scoped.client);
    const { data, error } = await scoped.client.rpc('get_admin_flagged_reviews', { p_limit: paging.limit, p_offset: paging.offset }); databaseError(error);
    return applyCookies(successResponse(data));
  } catch (error) { return applyCookies(errorResponse(error)); }
}
