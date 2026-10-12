import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AuthError } from './request-security';
export { AuthError } from './request-security';

export async function requireUser(client: SupabaseClient): Promise<User> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) throw new AuthError(401, 'AUTH_REQUIRED');
  return data.user;
}

export async function requireActiveUser(client: SupabaseClient): Promise<User> {
  const user = await requireUser(client);
  const { data, error } = await client.rpc('get_my_account_status');
  if (error) throw new AuthError(503, 'SERVICE_UNAVAILABLE');
  const account = Array.isArray(data) ? data[0] : data;
  if (!account || account.status !== 'active') throw new AuthError(403, 'ACCOUNT_SUSPENDED');
  if (!user.email_confirmed_at || account.emailVerified !== true) throw new AuthError(403, 'EMAIL_NOT_VERIFIED');
  return user;
}
