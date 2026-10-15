/** Internal execution through OpenNext preserves its request context and secrets. */
export async function runOwnerNotificationSchedule(app, env, ctx) {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM || !env.INTERNAL_DISPATCH_SECRET || env.INTERNAL_DISPATCH_SECRET.length < 32) {
    return { skipped: true, reason: 'NOT_CONFIGURED' };
  }
  const origin = new URL(env.APP_ORIGIN || 'https://triggerboxd.com');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('OWNER_NOTIFICATION_ORIGIN_INVALID');
  }
  const request = new Request(new URL('/api/v1/internal/notifications/dispatch/', origin), {
    method: 'POST', headers: { 'x-internal-dispatch-secret': env.INTERNAL_DISPATCH_SECRET },
  });
  const response = await app.fetch(request, env, ctx);
  if (!response.ok) throw new Error('OWNER_NOTIFICATION_DISPATCH_FAILED');
  const body = await response.json();
  return body.data;
}
