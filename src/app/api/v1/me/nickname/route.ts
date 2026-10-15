import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth';
import { readJsonBody } from '../../../../../lib/api-http';
import { parseNickname } from '../../../../../lib/nickname';
import { AuthError, validateMutation } from '../../../../../lib/request-security';
import { createRequestClient } from '../../../../../lib/supabase/server';
import { authFailure } from '../../../auth/_shared';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let applyCookies: (response: Response) => Response = response => response;
  try {
    validateMutation(request);
    let body: Record<string, unknown>;
    try { body = await readJsonBody(request); }
    catch { throw new AuthError(400, 'INVALID_REQUEST'); }
    if (Object.keys(body).length !== 1) throw new AuthError(400, 'INVALID_REQUEST');
    const nickname = parseNickname(body.nickname);
    const scoped = createRequestClient(request);
    applyCookies = scoped.applyCookies;
    const user = await requireUser(scoped.client);
    const { data, error } = await scoped.client.from('profiles')
      .update({ display_name: nickname, nickname_set: true })
      .eq('user_id', user.id)
      .select('display_name').single();
    if (error || !data) throw new AuthError(503, 'SERVICE_UNAVAILABLE');
    return applyCookies(NextResponse.json({ data: { nickname: data.display_name } }, { headers: { 'Cache-Control': 'private, no-store' } }));
  } catch (error) {
    return applyCookies(authFailure(error));
  }
}
