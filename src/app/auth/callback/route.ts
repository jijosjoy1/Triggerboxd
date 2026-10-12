import { NextResponse } from 'next/server';
import { issueCsrf, requestOrigin, safeReturnPath } from '../../../lib/request-security';
import { authConfiguration, createRequestClient } from '../../../lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeReturnPath(url.searchParams.get('next'));
  const login = new URL('/login/', requestOrigin(request));
  login.searchParams.set('next', next);
  login.searchParams.set('error', 'callback');
  let scoped: ReturnType<typeof createRequestClient> | undefined;
  try {
    const code = url.searchParams.get('code');
    if (!code || code.length > 2048 || url.searchParams.has('error')) throw new Error();
    const recovery = url.searchParams.get('flow') === 'recovery';
    if (recovery && !authConfiguration().passwordEnabled) throw new Error();
    scoped = createRequestClient(request);
    const { error } = await scoped.client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const destination = new URL(recovery ? '/auth/reset-password/' : next, requestOrigin(request));
    if (recovery) destination.searchParams.set('next', next);
    const response = NextResponse.redirect(destination, 303);
    issueCsrf(request, response, true);
    response.headers.set('Referrer-Policy', 'no-referrer');
    return scoped.applyCookies(response);
  } catch {
    const response = NextResponse.redirect(login, 303);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return scoped ? scoped.applyCookies(response) : response;
  }
}
