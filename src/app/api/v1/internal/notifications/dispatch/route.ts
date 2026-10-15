import { errorResponse, successResponse } from '../../../../../../lib/api-http';
import { createProviderSender, emailConfiguration } from '../../../../../../lib/email';
import { databaseError, serviceDatabase } from '../../../../../../lib/movie-api';
import { createNotificationDispatchEndpoint, type NotificationEvent } from '../../../../../../lib/owner-notifications';

export const dynamic = 'force-dynamic';

/**
 * Delivers queued owner notifications. Invoked by the scheduled job with a
 * server-side shared secret; it is not reachable from the browser, and it never
 * accepts a recipient, template or event from the request.
 */
export const POST = createNotificationDispatchEndpoint({
  secret: () => process.env.INTERNAL_DISPATCH_SECRET,
  configured: () => emailConfiguration().configured,
  repository: () => {
    const client = serviceDatabase();
    return {
      events: async (limit: number) => {
        const { data, error } = await client.rpc('notification_events', { p_limit: limit });
        databaseError(error);
        return (Array.isArray(data) ? data : []) as NotificationEvent[];
      },
      send: createProviderSender(),
      record: async (id: string, leaseToken: string, outcome: 'sent' | 'retry' | 'failed', errorCode?: string) => {
        const { data, error } = await client.rpc('record_notification_result', {
          p_id: id, p_lease_token: leaseToken, p_outcome: outcome, p_error_code: errorCode ?? null,
        });
        databaseError(error);
        return data === true;
      },
    };
  },
  send: createProviderSender(),
  success: successResponse,
  error: errorResponse,
  log: summary => console.info('owner notification dispatch', summary),
  logFailure: () => console.error('owner notification dispatch failed'),
});
