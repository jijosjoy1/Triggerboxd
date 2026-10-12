import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requestOrigin } from '../request-security';

export function authConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let configured = false;
  if (url && key) {
    try { const parsed = new URL(url); configured = ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { /* unusable configuration */ }
  }
  return { url, key, configured, passwordEnabled: configured && process.env.ENABLE_PASSWORD_AUTH === 'true', googleEnabled: configured && process.env.ENABLE_GOOGLE_AUTH !== 'false' };
}

/** Request-local SDK client. Always apply cookies to success AND error responses. */
export function createRequestClient(request: Request) {
  const { url, key, configured } = authConfiguration();
  if (!configured || !url || !key) throw new AuthError(503, 'AUTH_NOT_CONFIGURED');
  const jar = new Map(new NextRequest(request.url, { headers: request.headers }).cookies.getAll().map(({ name, value }) => [name, value]));
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const responseHeaders: Record<string, string> = {};
  const client = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, secure: requestOrigin(request).startsWith('https://'), sameSite: 'lax', path: '/' },
    cookies: {
      getAll() { return [...jar].map(([name, value]) => ({ name, value })); },
      setAll(cookies, headers) {
        for (const cookie of cookies) { jar.set(cookie.name, cookie.value); pending.set(cookie.name, cookie); }
        Object.assign(responseHeaders, headers);
      },
    },
  });
  function applyCookies<T extends Response>(response: T): T {
    for (const [name, value] of Object.entries(responseHeaders)) response.headers.set(name, value);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie');
    // ResponseCookies implements proper serialization, including chunk removals.
    const cookieResponse = new NextResponse(null);
    for (const cookie of pending.values()) cookieResponse.cookies.set(cookie.name, cookie.value, cookie.options);
    for (const value of cookieResponse.headers.getSetCookie()) response.headers.append('Set-Cookie', value);
    return response;
  }
  return { client, applyCookies };
}
