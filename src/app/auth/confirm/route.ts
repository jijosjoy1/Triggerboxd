import { NextResponse } from 'next/server';
import { issueCsrf, requestOrigin, safeReturnPath } from '../../../lib/request-security';
import { authConfiguration, createRequestClient } from '../../../lib/supabase/server';

/** Optional Supabase email-template target using TokenHash; default PKCE mail uses callback. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeReturnPath(url.searchParams.get('next'));
  const type = url.searchParams.get('type');
  const tokenHash = url.searchParams.get('token_hash');
  let scoped: ReturnType<typeof createRequestClient> | undefined;
  try {
    if (!authConfiguration().passwordEnabled || !tokenHash || tokenHash.length > 2048 || (type !== 'email' && type !== 'recovery')) throw new Error();
    scoped = createRequestClient(request);
    const { error } = await scoped.client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw error;
    const destination = new URL(type === 'recovery' ? '/auth/reset-password/' : next, requestOrigin(request));
    if (type === 'recovery') destination.searchParams.set('next', next);
    const response = NextResponse.redirect(destination, 303);
    issueCsrf(request, response, true);
    response.headers.set('Referrer-Policy', 'no-referrer');
    return scoped.applyCookies(response);
  } catch {
    const destination = new URL('/login/', requestOrigin(request));
    destination.searchParams.set('error', 'link');
    destination.searchParams.set('next', next);
    const response = NextResponse.redirect(destination, 303);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return scoped ? scoped.applyCookies(response) : response;
  }
}
