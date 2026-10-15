import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOwnerMessage, classifyDeliveryFailure, dispatchOwnerNotifications, dispatchAuthorised,
  OWNER_NOTIFICATION_RECIPIENT, OWNER_DASHBOARD_URL, MAX_DISPATCH_BATCH,
} from '../../src/lib/owner-notifications.ts';
import { createProviderSender, emailConfiguration, EmailNotConfiguredError } from '../../src/lib/email.ts';

const accountEvent = { id: 'e1', leaseToken: 'lease-1', eventType: 'account_created', occurredAt: '2026-10-15T09:30:00.000Z', filmTitle: null, attempts: 1 };
const filmEvent = { id: 'e2', leaseToken: 'lease-2', eventType: 'film_imported', occurredAt: '2026-10-15T10:00:00.000Z', filmTitle: 'Kantara', attempts: 1 };

test('the recipient is fixed server-side and never taken from input', () => {
  assert.equal(OWNER_NOTIFICATION_RECIPIENT, 'info@triggerboxd.com');
  assert.equal(buildOwnerMessage(accountEvent).to, OWNER_NOTIFICATION_RECIPIENT);
  // A caller-supplied recipient cannot replace the fixed one.
  assert.equal(buildOwnerMessage(accountEvent, undefined).to, 'info@triggerboxd.com');
});

test('notifications carry only the event type, time, film title and dashboard link', () => {
  const film = buildOwnerMessage(filmEvent);
  assert.equal(film.subject, 'Triggerboxd: new film imported');
  assert.equal(film.text, `A new film was imported into Triggerboxd.\nFilm: Kantara\nTime: 2026-10-15T10:00:00.000Z\nDashboard: ${OWNER_DASHBOARD_URL}`);
  const account = buildOwnerMessage(accountEvent);
  assert.equal(account.subject, 'Triggerboxd: new account created');
  assert.doesNotMatch(account.text, /Film:/);
  for (const message of [film, account]) {
    assert.doesNotMatch(message.text, /@(?!triggerboxd\.com)/, 'no account email may appear');
    assert.doesNotMatch(message.text, /google|avatar|photo|review|severity|warning/i);
    assert.equal(message.idempotencyKey, message.idempotencyKey.trim());
  }
  assert.equal(film.idempotencyKey, 'e2');
});

test('delivery failures are classified into retry or terminal outcomes', () => {
  assert.deepEqual(classifyDeliveryFailure(new Error('email provider 429')), { outcome: 'retry', code: 'rate_limited' });
  assert.deepEqual(classifyDeliveryFailure(new Error('upstream timeout')), { outcome: 'retry', code: 'timeout' });
  assert.deepEqual(classifyDeliveryFailure(new Error('email provider 503')), { outcome: 'retry', code: 'upstream' });
  assert.deepEqual(classifyDeliveryFailure(new Error('email provider 400')), { outcome: 'failed', code: 'rejected' });
  assert.deepEqual(classifyDeliveryFailure(new Error('EMAIL_NOT_CONFIGURED')), { outcome: 'retry', code: 'not_configured' });
  assert.deepEqual(classifyDeliveryFailure({ weird: true }), { outcome: 'retry', code: 'unknown' });
});

test('only the shared secret admits a dispatch call', () => {
  const secret = 's'.repeat(48);
  assert.equal(dispatchAuthorised(secret, secret), true);
  assert.equal(dispatchAuthorised(null, secret), false);
  assert.equal(dispatchAuthorised('x'.repeat(48), secret), false);
  assert.equal(dispatchAuthorised(secret.slice(1), secret), false);
  assert.equal(dispatchAuthorised(secret, undefined), false);
  assert.equal(dispatchAuthorised(secret, 'too-short'), false, 'a short secret is never accepted');
  assert.equal(dispatchAuthorised('é'.repeat(48), secret), false, 'multibyte tokens fail safely');
});

test('a successful batch sends once and marks each event sent', async () => {
  const sent = [], recorded = [];
  const summary = await dispatchOwnerNotifications({
    events: async () => [accountEvent, filmEvent],
    send: async message => { sent.push(message); },
    record: async (id, lease, outcome) => { recorded.push([id, lease, outcome]); return true; },
  });
  assert.deepEqual(summary, { claimed: 2, sent: 2, retried: 0, failed: 0, acknowledgementFailures: 0 });
  assert.equal(sent.length, 2);
  assert.deepEqual(recorded, [['e1', 'lease-1', 'sent'], ['e2', 'lease-2', 'sent']]);
  assert.deepEqual(sent.map(message => message.idempotencyKey), ['e1', 'e2']);
});

test('a failed send records a retry and never throws out of the batch', async () => {
  const recorded = [];
  const summary = await dispatchOwnerNotifications({
    events: async () => [accountEvent, filmEvent],
    send: async message => { if (message.idempotencyKey === 'e1') throw new Error('email provider 503'); },
    record: async (id, lease, outcome, code) => { recorded.push([id, lease, outcome, code]); return true; },
  });
  assert.deepEqual(summary, { claimed: 2, sent: 1, retried: 1, failed: 0, acknowledgementFailures: 0 });
  assert.deepEqual(recorded[0], ['e1', 'lease-1', 'retry', 'upstream']);
  assert.deepEqual(recorded[1], ['e2', 'lease-2', 'sent', undefined]);
});

test('a rejected address fails terminally, and a bookkeeping failure is swallowed', async () => {
  const recorded = [];
  const summary = await dispatchOwnerNotifications({
    events: async () => [accountEvent],
    send: async () => { throw new Error('email provider 422 rejected'); },
    record: async (id, lease, outcome, code) => { recorded.push([id, lease, outcome, code]); throw new Error('bookkeeping unavailable'); },
  });
  assert.deepEqual(summary, { claimed: 1, sent: 0, retried: 0, failed: 1, acknowledgementFailures: 1 });
  assert.deepEqual(recorded, [['e1', 'lease-1', 'failed', 'rejected']]);
});

test('a queue read failure does not deliver partial work silently', async () => {
  await assert.rejects(dispatchOwnerNotifications({
    events: async () => { throw new Error('queue unavailable'); },
    send: async () => {},
    record: async () => {},
  }), /queue unavailable/);
});

test('the batch size is always bounded', async () => {
  let asked = 0;
  await dispatchOwnerNotifications({ events: async limit => { asked = limit; return []; }, send: async () => {}, record: async () => {}, limit: 500 });
  assert.equal(asked, MAX_DISPATCH_BATCH);
  await dispatchOwnerNotifications({ events: async limit => { asked = limit; return []; }, send: async () => {}, record: async () => {}, limit: 0 });
  assert.equal(asked, 1);
});

test('delivery is skipped, not faked, when the provider is not configured', async () => {
  const saved = { ...process.env };
  delete process.env.EMAIL_API_KEY; delete process.env.EMAIL_FROM;
  try {
    assert.equal(emailConfiguration().configured, false);
    await assert.rejects(createProviderSender()({ to: OWNER_NOTIFICATION_RECIPIENT, subject: 'x', text: 'y', idempotencyKey: 'k' }), EmailNotConfiguredError);
  } finally { process.env = saved; }
});

test('a configured sender posts once with the provider idempotency key', async () => {
  const saved = { ...process.env };
  process.env.EMAIL_API_URL = 'https://malicious.example.test/steal';
  process.env.EMAIL_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'warnings@triggerboxd.com';
  const calls = [];
  try {
    const send = createProviderSender(async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 202 });
    });
    await send({ to: 'attacker@example.test', subject: 's', text: 't', idempotencyKey: 'e2' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers['idempotency-key'], 'e2');
    assert.ok(!calls[0].init.headers['idempotency-key'].includes('@'));
    assert.equal(calls[0].init.body.includes('info@triggerboxd.com'), true);
    assert.equal(calls[0].init.body.includes('attacker@example.test'), false);
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    const failing = createProviderSender(async () => new Response('nope', { status: 503 }));
    await assert.rejects(failing({ to: OWNER_NOTIFICATION_RECIPIENT, subject: 's', text: 't', idempotencyKey: 'k' }), /503/);
  } finally { process.env = saved; }
});
