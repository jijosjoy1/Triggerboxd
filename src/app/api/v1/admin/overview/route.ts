import { errorResponse, successResponse } from '../../../../../lib/api-http';
import { parseAdminPaging } from '../../../../../lib/admin';
import { requireActiveUser } from '../../../../../lib/auth';
import { databaseError } from '../../../../../lib/movie-api';
import { AuthError } from '../../../../../lib/request-security';
import { createRequestClient } from '../../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Owner-only aggregate. Authentication is checked here; authorisation is enforced
 * again inside the database function against the private owner allowlist, so a
 * signed-in non-owner receives no rows even if this handler were bypassed.
 */
export async function GET(request: Request): Promise<Response> {
  let applyCookies: (response: Response) => Response = response => response;
  try {
    const url = new URL(request.url);
    const paging = parseAdminPaging(url.searchParams.get('limit'), url.searchParams.get('offset'));
    if (!paging.ok) throw new AuthError(400, 'INVALID_REQUEST');
    const scoped = createRequestClient(request);
    applyCookies = scoped.applyCookies;
    await requireActiveUser(scoped.client);
    const { data, error } = await scoped.client.rpc('get_admin_overview', { p_recent_limit: paging.limit, p_recent_offset: paging.offset });
    databaseError(error);
    return applyCookies(successResponse(data));
  } catch (error) {
    return applyCookies(errorResponse(error));
  }
}
