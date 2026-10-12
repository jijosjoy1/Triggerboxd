import { randomBytes, timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

export function safeReturnPath(value: unknown, fallback = '/search/'): string {
  if (typeof value !== 'string' || value.length > 1500 || !value.startsWith('/') || value.startsWith('//')) return fallback;
  let decoded = value;
  try { for (let i = 0; i < 3; i++) decoded = decodeURIComponent(decoded); } catch { return fallback; }
  if (decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded) || /^\/(?:auth|api|login)(?:\/|\?|#|$)/i.test(decoded)) return fallback;
  const url = new URL(value, 'https://return.invalid');
  if (url.origin !== 'https://return.invalid' || url.pathname.startsWith('//') || /^\/(?:auth|api|login)(?:\/|$)/i.test(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function requestOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN;
  if (!configured) {
    const url=new URL(request.url);
    const host=request.headers.get('host');
    // Next dev normalizes 127.0.0.1 to localhost in Request.url. Only accept
    // loopback Host values here; deployed origins must use APP_ORIGIN.
    if(process.env.NODE_ENV==='development'&&url.protocol==='http:'&&host&&/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host)){
      try{return new URL(`http://${host}`).origin;}catch{throw new AuthError(503,'SERVICE_UNAVAILABLE');}
    }
    return url.origin;
  }
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new AuthError(503, 'SERVICE_UNAVAILABLE'); }
}

export function readCookie(request: Request, name: string): string | undefined {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  try { return decodeURIComponent(matches[0].slice(name.length + 1)); } catch { return undefined; }
}

export function validateMutation(request: Request): void {
  if (request.headers.get('origin') !== requestOrigin(request)) throw new AuthError(403, 'FORBIDDEN');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AuthError(415, 'INVALID_CONTENT_TYPE');
  const cookie = readCookie(request, 'tb-csrf');
  const token = request.headers.get('x-csrf-token');
  if (!cookie || !token || !/^[a-f0-9]{48}$/.test(cookie) || !/^[a-f0-9]{48}$/.test(token) || !timingSafeEqual(Buffer.from(cookie), Buffer.from(token))) throw new AuthError(403, 'FORBIDDEN');
}

type CookieResponse = { headers: Headers; cookies: { set(name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number }): unknown } };

export function issueCsrf(request: Request, response: CookieResponse, rotate = false): string {
  const existing = readCookie(request, 'tb-csrf');
  const token = !rotate && existing && /^[a-f0-9]{48}$/.test(existing) ? existing : randomBytes(24).toString('hex');
  response.cookies.set('tb-csrf', token, { httpOnly: true, secure: requestOrigin(request).startsWith('https://'), sameSite: 'lax', path: '/', maxAge: 3600 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Cookie');
  return token;
}
