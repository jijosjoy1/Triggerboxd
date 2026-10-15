import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationDispatchEndpoint } from '../../src/lib/owner-notifications.ts';
import { successResponse, errorResponse } from '../../src/lib/api-http.ts';

const secret = 's'.repeat(48);
const event = {
  id: '00000000-0000-4000-8000-000000000123',
  leaseToken: '00000000-0000-4000-8000-000000000456',
  eventType: 'account_created',
  occurredAt: '2026-10-15T10:00:00Z',
  filmTitle: null,
  attempts: 1,
};
const request = token => new Request('https://triggerboxd.com/api/v1/internal/notifications/dispatch', {
  method: 'POST', headers: token ? { 'x-internal-dispatch-secret': token } : {},
});
function endpoint(overrides = {}) {
  return createNotificationDispatchEndpoint({
    secret: () => secret,
    configured: () => true,
    repository: () => ({ events: async () => [event], record: async () => true }),
    send: async () => {},
    success: successResponse,
    error: errorResponse,
    ...overrides,
  });
}

test('unauthorized calls do not inspect configuration or claim events', async () => {
  const handler = endpoint({ configured: () => { throw new Error('config read'); } });
  for (const token of [undefined, 'wrong', 'é'.repeat(48)]) {
    const response = await handler(request(token));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
});

test('missing email configuration skips before opening the repository', async () => {
  const handler = endpoint({
    configured: () => false,
    repository: () => { throw new Error('must not claim'); },
  });
  const response = await handler(request(secret));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    configured: false, skipped: true, reason: 'EMAIL_NOT_CONFIGURED',
  });
});

test('successful dispatch passes the lease to acknowledgement and returns aggregate counts', async () => {
  const calls = [];
  const handler = endpoint({
    repository: () => ({
      events: async limit => { assert.equal(limit, 5); return [event]; },
      record: async (...args) => { calls.push(args); return true; },
    }),
    send: async message => {
      assert.equal(message.to, 'info@triggerboxd.com');
      assert.equal(message.idempotencyKey, event.id);
    },
  });
  const response = await handler(request(secret));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    configured: true, skipped: false, claimed: 1, sent: 1, retried: 0, failed: 0,
    acknowledgementFailures: 0,
  });
  assert.deepEqual(calls, [[event.id, event.leaseToken, 'sent', undefined]]);
});

test('database claim failure is sanitized and does not send mail or leak PII', async () => {
  let sends = 0;
  let failures = 0;
  const handler = endpoint({
    repository: () => ({
      events: async () => { throw new Error('database connection for user@example.test failed'); },
      record: async () => true,
    }),
    send: async () => { sends += 1; },
    logFailure: () => { failures += 1; },
  });
  const response = await handler(request(secret));
  assert.equal(response.status, 503);
  const body = JSON.stringify(await response.json());
  assert.doesNotMatch(body, /user@example\.test|database connection/);
  assert.equal(sends, 0);
  assert.equal(failures, 1);
});
