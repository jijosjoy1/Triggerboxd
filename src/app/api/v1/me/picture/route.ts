import { ApiError, errorResponse, readJsonBody, successResponse } from '../../../../../lib/api-http';
import { requireActiveUser } from '../../../../../lib/auth';
import { AVATAR_MAX_BYTES, sanitizeAvatar } from '../../../../../lib/avatar';
import { databaseError, serviceDatabase } from '../../../../../lib/movie-api';
import { validateMutation } from '../../../../../lib/request-security';
import { createRequestClient } from '../../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let applyCookies = (r: Response) => r;
  try {
    const scoped = createRequestClient(request); applyCookies = scoped.applyCookies;
    await requireActiveUser(scoped.client);
    const { data, error } = await scoped.client.rpc('get_my_profile_picture'); databaseError(error);
    return applyCookies(successResponse(data));
  } catch (error) { return applyCookies(errorResponse(error)); }
}
async function write(request: Request, remove: boolean) {
  let applyCookies = (r: Response) => r;
  try {
    validateMutation(request);
    const scoped = createRequestClient(request); applyCookies = scoped.applyCookies;
    const user = await requireActiveUser(scoped.client);
    const body = await readJsonBody(request, remove ? 1024 : Math.ceil(AVATAR_MAX_BYTES * 4 / 3) + 100);
    let image: string | null = null;
    if (remove) { if (Object.keys(body).length) throw new ApiError('INVALID_REQUEST'); }
    else {
      if (Object.keys(body).length !== 1 || typeof body.image !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.image)) throw new ApiError('INVALID_REQUEST');
      image = Buffer.from(sanitizeAvatar(Buffer.from(body.image, 'base64'))).toString('base64');
    }
    // Only this verified, sanitized boundary has permission to store image bytes.
    const { data, error } = await serviceDatabase().rpc('set_profile_picture', { p_actor: user.id, p_image: image }); databaseError(error);
    return applyCookies(successResponse(data));
  } catch (error) { return applyCookies(errorResponse(error)); }
}
export const POST = (request: Request) => write(request, false);
export const DELETE = (request: Request) => write(request, true);
