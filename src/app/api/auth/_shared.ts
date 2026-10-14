import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/auth';
import { parseNickname } from '../../../lib/nickname';
import { AuthError, issueCsrf, requestOrigin, safeReturnPath, validateMutation } from '../../../lib/request-security';
import { authConfiguration, createRequestClient } from '../../../lib/supabase/server';

export function authFailure(error: unknown) {
  const known = error instanceof AuthError;
  return NextResponse.json({ error: { code: known ? error.code : 'SERVICE_UNAVAILABLE', message: known ? authMessage(error.code) : 'Sign-in is temporarily unavailable. Please try again.',requestId:crypto.randomUUID() } }, { status: known ? error.status : 503, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie',...(known&&error.status===429?{'Retry-After':'60'}:{}) } });
}

function authMessage(code: string): string {
  const messages: Record<string, string> = {
    AUTH_NOT_CONFIGURED: 'Sign-in is not available yet. Authentication setup is still pending.',
    PASSWORD_AUTH_DISABLED: 'Email sign-in is not available yet.',
    AUTH_REQUIRED: 'Please sign in to continue.',
    INVALID_CREDENTIALS: 'Unable to sign in. Check your details and confirm your email.',
    INVALID_REQUEST: 'Please check the details you entered.',
    INVALID_CONTENT_TYPE: 'Send the request as JSON.',
    FORBIDDEN: 'This request could not be verified. Reload the page and try again.',
    RATE_LIMITED: 'Too many attempts. Please wait before trying again.',
    AUTH_FAILED: 'Sign-in could not be completed. Please try again.',
  };
  return messages[code] ?? 'Sign-in is temporarily unavailable. Please try again.';
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const stream = request.body?.getReader();
  if (!stream) throw new AuthError(400, 'INVALID_REQUEST');
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  while (true) {
    const { done, value } = await stream.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 8192) { await stream.cancel(); throw new AuthError(413, 'INVALID_REQUEST'); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new AuthError(400, 'INVALID_REQUEST'); }
}

function emailValue(body: Record<string, unknown>) {
  if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) throw new AuthError(400, 'INVALID_REQUEST');
  return body.email.trim();
}

function passwordValue(body: Record<string, unknown>, creating: boolean) {
  if (typeof body.password !== 'string' || body.password.length > 128 || body.password.length < (creating ? 12 : 1)) throw new AuthError(400, 'INVALID_REQUEST');
  return body.password;
}

type Operation = 'google' | 'login' | 'signup' | 'recovery' | 'password' | 'logout';

export function mutationHandler(operation: Operation) {
  return async (request: Request): Promise<Response> => {
    let scoped: ReturnType<typeof createRequestClient> | undefined;
    try {
      validateMutation(request);
      const body = await readBody(request);
      const config = authConfiguration();
      if (!config.configured) throw new AuthError(503, 'AUTH_NOT_CONFIGURED');
      if (!['google', 'logout'].includes(operation) && !config.passwordEnabled) throw new AuthError(503, 'PASSWORD_AUTH_DISABLED');
      if (operation === 'google' && !config.googleEnabled) throw new AuthError(503, 'AUTH_NOT_CONFIGURED');
      scoped = createRequestClient(request);
      const { client } = scoped;
      const next = safeReturnPath(body.next);
      const callback = new URL('/auth/callback/', requestOrigin(request));
      callback.searchParams.set('next', next);
      let data: Record<string, unknown> = {};
      let providerError: { status?: number } | null = null;
      if (operation === 'google') {
        const result = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback.toString(), skipBrowserRedirect: true } });
        providerError = result.error;
        if (!result.error && !result.data.url) throw new AuthError(503, 'AUTH_FAILED');
        data = { url: result.data.url };
      } else if (operation === 'login') {
        const result = await client.auth.signInWithPassword({ email: emailValue(body), password: passwordValue(body, false) });
        providerError = result.error;
        if (!result.error) {
          const user = await requireUser(client);
          data = { user: { id: user.id }, next };
        }
      } else if (operation === 'signup') {
        if (typeof body.displayName !== 'string' || body.displayName.trim().length < 1 || body.displayName.trim().length > 60) throw new AuthError(400, 'INVALID_REQUEST');
        const result = await client.auth.signUp({ email: emailValue(body), password: passwordValue(body, true), options: { emailRedirectTo: callback.toString(), data: { nickname: parseNickname(body.displayName), nickname_chosen: true } } });
        providerError = result.error;
        // Same response for existing and new identities. No manual identity merging.
        data = { confirmationRequired: true, message: 'If signup is available for this email, check your inbox to confirm it.' };
      } else if (operation === 'recovery') {
        callback.searchParams.set('flow', 'recovery');
        const result = await client.auth.resetPasswordForEmail(emailValue(body), { redirectTo: callback.toString() });
        providerError = result.error;
        data = { message: 'If this email has an account, you will receive a password reset link.' };
      } else if (operation === 'password') {
        await requireUser(client);
        const result = await client.auth.updateUser({ password: passwordValue(body, true) });
        providerError = result.error;
        data = { updated: !result.error, next };
      } else {
        const result = await client.auth.signOut({ scope: 'local' });
        providerError = result.error;
        data = { signedOut: !result.error };
      }
      if (providerError) {
        if (providerError.status === 429) throw new AuthError(429, 'RATE_LIMITED');
        throw new AuthError(operation === 'login' ? 401 : 503, operation === 'login' ? 'INVALID_CREDENTIALS' : 'AUTH_FAILED');
      }
      const response = NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
      if (['login', 'logout', 'password'].includes(operation)) issueCsrf(request, response, true);
      return scoped.applyCookies(response);
    } catch (error) {
      const response = authFailure(error);
      return scoped ? scoped.applyCookies(response) : response;
    }
  };
}
