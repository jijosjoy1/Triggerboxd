/**
 * Owner-notification content and delivery, kept free of framework imports so the
 * wording and retry rules can be unit tested with a mocked sender.
 *
 * The recipient is fixed server-side. It is never read from a request, a row or
 * any other caller-influenced value.
 */
import { timingSafeEqual } from 'node:crypto';

export const OWNER_NOTIFICATION_RECIPIENT = 'info@triggerboxd.com';
export const OWNER_DASHBOARD_URL = 'https://triggerboxd.com/admin/';
export const MAX_DISPATCH_BATCH = 5;

export type NotificationEventType = 'account_created' | 'film_imported';
export type NotificationEvent = {
  id: string;
  leaseToken: string;
  eventType: NotificationEventType;
  occurredAt: string;
  filmTitle: string | null;
  attempts: number;
};
export type OwnerMessage = { to: string; subject: string; text: string; idempotencyKey: string };
export type EmailSender = (message: OwnerMessage) => Promise<void>;
export type RecordOutcome = 'sent' | 'retry' | 'failed';

function eventTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'unknown time' : parsed.toISOString();
}

/**
 * Minimal notification: event type, event time, the film title only when the
 * event is about a film, and a dashboard link. No account email, provider name,
 * review text or warning detail is ever included.
 */
export function buildOwnerMessage(event: NotificationEvent): OwnerMessage {
  const lines = event.eventType === 'film_imported'
    ? ['A new film was imported into Triggerboxd.', `Film: ${event.filmTitle ?? 'Untitled'}`, `Time: ${eventTime(event.occurredAt)}`]
    : ['A new account was created on Triggerboxd.', `Time: ${eventTime(event.occurredAt)}`];
  return {
    to: OWNER_NOTIFICATION_RECIPIENT,
    subject: event.eventType === 'film_imported' ? 'Triggerboxd: new film imported' : 'Triggerboxd: new account created',
    text: [...lines, `Dashboard: ${OWNER_DASHBOARD_URL}`].join('\n'),
    // Opaque outbox ID avoids exposing an account ID in provider metadata.
    // Resend deduplicates for 24 hours; a later retry may still duplicate mail.
    idempotencyKey: event.id,
  };
}

/** Constant-time shared-secret check for the dispatch endpoint. */
export function dispatchAuthorised(supplied: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return false;
  if (!supplied) return false;
  const suppliedBytes = Buffer.from(supplied);
  const secretBytes = Buffer.from(secret);
  if (suppliedBytes.length !== secretBytes.length) return false;
  return timingSafeEqual(suppliedBytes, secretBytes);
}

/** Transient failures are retried; anything the provider calls permanent is not. */
export function classifyDeliveryFailure(error: unknown): { outcome: RecordOutcome; code: string } {
  const message = error instanceof Error ? error.message : String(error);
  // A missing sender is a configuration problem, not a rejection: keep the event
  // queued so it can be delivered once the provider is configured.
  if (/not[_ ]configured/i.test(message)) return { outcome: 'retry', code: 'not_configured' };
  if (/\b(429|rate)/i.test(message)) return { outcome: 'retry', code: 'rate_limited' };
  if (/\b(408|timeout|timed out|aborted)/i.test(message)) return { outcome: 'retry', code: 'timeout' };
  if (/\b(5\d\d|unavailable|outage|network)/i.test(message)) return { outcome: 'retry', code: 'upstream' };
  if (/\b(4\d\d|invalid|rejected|suppressed|not configured)/i.test(message)) return { outcome: 'failed', code: 'rejected' };
  return { outcome: 'retry', code: 'unknown' };
}

export type DispatchDeps = {
  events: (limit: number) => Promise<NotificationEvent[]>;
  send: EmailSender;
  record: (id: string, leaseToken: string, outcome: RecordOutcome, errorCode?: string) => Promise<boolean>;
  limit?: number;
  log?: (summary: DispatchSummary) => void;
};

export type DispatchSummary = { claimed: number; sent: number; retried: number; failed: number; acknowledgementFailures: number };

/**
 * Delivers one batch. Each event is isolated: a send or bookkeeping failure is
 * recorded and never propagates, so a mail outage cannot fail the caller and one
 * bad event cannot block the rest of the batch.
 */
export async function dispatchOwnerNotifications(deps: DispatchDeps): Promise<DispatchSummary> {
  const limit = Math.min(Math.max(1, deps.limit ?? MAX_DISPATCH_BATCH), MAX_DISPATCH_BATCH);
  const summary: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, acknowledgementFailures: 0 };
  const events = await deps.events(limit);
  for (const event of events) {
    summary.claimed += 1;
    let outcome: RecordOutcome = 'sent';
    let code: string | undefined;
    try {
      await deps.send(buildOwnerMessage(event));
    } catch (error) {
      ({ outcome, code } = classifyDeliveryFailure(error));
    }
    try {
      if (!await deps.record(event.id, event.leaseToken, outcome, code)) summary.acknowledgementFailures += 1;
    } catch { summary.acknowledgementFailures += 1; }
    if (outcome === 'sent') summary.sent += 1;
    else if (outcome === 'retry') summary.retried += 1;
    else summary.failed += 1;
  }
  deps.log?.(summary);
  return summary;
}

export type NotificationRepository = Pick<DispatchDeps, 'events' | 'record'>;
export type NotificationEndpointDeps = {
  secret: () => string | undefined;
  configured: () => boolean;
  repository: () => NotificationRepository;
  send: EmailSender;
  success: (data: unknown) => Response;
  error: (error: unknown) => Response;
  log?: (summary: DispatchSummary) => void;
  logFailure?: () => void;
};

/** The HTTP boundary is injectable so tests can exercise it without live mail or DB. */
export function createNotificationDispatchEndpoint(deps: NotificationEndpointDeps) {
  return async (request: Request): Promise<Response> => {
    if (!dispatchAuthorised(request.headers.get('x-internal-dispatch-secret'), deps.secret())) {
      return deps.error(new Error('NOT_FOUND'));
    }
    if (!deps.configured()) {
      return deps.success({ configured: false, skipped: true, reason: 'EMAIL_NOT_CONFIGURED' });
    }
    try {
      const repository = deps.repository();
      const summary = await dispatchOwnerNotifications({
        ...repository,
        send: deps.send,
        log: deps.log,
      });
      return deps.success({ configured: true, skipped: false, ...summary });
    } catch (error) {
      deps.logFailure?.();
      return deps.error(error);
    }
  };
}
