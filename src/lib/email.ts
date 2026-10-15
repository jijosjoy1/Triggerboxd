import type { EmailSender } from './owner-notifications';

export class EmailNotConfiguredError extends Error {
  constructor() { super('EMAIL_NOT_CONFIGURED'); this.name = 'EmailNotConfiguredError'; }
}

const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';
const EMAIL_TIMEOUT_MS = 5_000;

/** Server-side mail configuration. Never exposed to the browser. */
export function emailConfiguration() {
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;
  const configured = !!(apiKey && from);
  return { configured, apiKey, from };
}

/**
 * Provider adapter. The sender address is configuration, never request input, and
 * an unverified sender is never impersonated: with no configuration the caller
 * skips delivery instead of sending from a guessed address.
 */
export function createProviderSender(fetchImpl: typeof fetch = fetch): EmailSender {
  return async message => {
    const config = emailConfiguration();
    if (!config.configured || !config.apiKey || !config.from) throw new EmailNotConfiguredError();
    const response = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        // Lets the provider collapse a duplicate retry of the same event.
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({ from: config.from, to: ['info@triggerboxd.com'], subject: message.subject, text: message.text }),
    });
    if (!response.ok) throw new Error(`email provider ${response.status}`);
  };
}
