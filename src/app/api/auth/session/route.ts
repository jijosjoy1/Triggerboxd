import { NextResponse } from 'next/server';
import { issueCsrf } from '../../../../lib/request-security';
import { authConfiguration, createRequestClient } from '../../../../lib/supabase/server';
import { authFailure } from '../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const config = authConfiguration();
  let scoped: ReturnType<typeof createRequestClient> | undefined;
  try {
    let user: { id: string; nickname: string; needsNickname: boolean } | null = null;
    if (config.configured) {
      scoped = createRequestClient(request);
      const result = await scoped.client.auth.getUser();
      if (result.error && result.error.name !== 'AuthSessionMissingError' && result.error.status && result.error.status >= 500) throw result.error;
      if (!result.error && result.data.user && !result.data.user.is_anonymous) {
        const status = await scoped.client.rpc('get_my_account_status');
        if (status.error || !status.data || typeof status.data.displayName !== 'string') throw new Error('Account profile unavailable');
        user = { id: result.data.user.id, nickname: status.data.displayName, needsNickname: status.data.nicknameChosen !== true };
      }
    }
    const response = NextResponse.json({ data: { user, csrfToken: '', passwordEnabled: config.passwordEnabled, configured: config.configured, googleEnabled: config.googleEnabled } });
    const csrfToken = issueCsrf(request, response);
    // Retain the cookie response while replacing only its JSON body.
    const final = new NextResponse(JSON.stringify({ data: { user, csrfToken, passwordEnabled: config.passwordEnabled, configured: config.configured, googleEnabled: config.googleEnabled } }), { status: 200, headers: response.headers });
    return scoped ? scoped.applyCookies(final) : final;
  } catch (error) {
    const response = authFailure(error);
    return scoped ? scoped.applyCookies(response) : response;
  }
}
