'use client';

import { useSyncExternalStore } from 'react';

export type AuthSession = {
  user: { id: string; nickname: string } | null;
  csrfToken: string;
  passwordEnabled: boolean;
  configured: boolean;
  googleEnabled?: boolean;
};
type Snapshot = { session: AuthSession | null; loading: boolean; error: string | null };
const initialSnapshot: Snapshot = { session: null, loading: true, error: null };
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();
let pending: Promise<AuthSession> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let channel: BroadcastChannel | undefined;

function publish(value: Snapshot) {
  const previousUserId = snapshot.session?.user?.id ?? null;
  const userId = value.session?.user?.id ?? null;
  const hadSession = snapshot.session !== null;
  snapshot = value;
  for (const listener of listeners) listener();
  if (value.session && (previousUserId !== userId || (!hadSession && userId))) {
    window.dispatchEvent(new CustomEvent('triggerboxd:account-change', { detail: { previousUserId, userId } }));
  }
}

export async function refreshAuthSession(): Promise<AuthSession> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('/api/auth/session/', { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.data || typeof body.data.csrfToken !== 'string') throw new Error(body.error?.message ?? 'Unable to check sign-in. Please try again.');
      const session: AuthSession = body.data;
      publish({ session, loading: false, error: null });
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to check sign-in. Please try again.';
      // Do not announce logout on an outage; protected endpoints always revalidate.
      publish({ session: snapshot.session, loading: false, error: message });
      throw new Error(message);
    } finally { pending = null; }
  })();
  return pending;
}

function refreshQuietly() { if (document.visibilityState === 'visible') void refreshAuthSession().catch(() => {}); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshAuthSession().catch(() => {});
    timer = setInterval(()=>{if(snapshot.session?.user)refreshQuietly();}, 60000);
    window.addEventListener('focus', refreshQuietly);
    document.addEventListener('visibilitychange', refreshQuietly);
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('triggerboxd-auth');
      channel.onmessage = refreshQuietly;
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      window.removeEventListener('focus', refreshQuietly);
      document.removeEventListener('visibilitychange', refreshQuietly);
      channel?.close(); channel = undefined;
    }
  };
}

export function useAuthSession() {
  const value = useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
  return { ...value, refresh: refreshAuthSession };
}

export async function authMutation<T = Record<string, unknown>>(path: string, body: Record<string, unknown>, csrfToken: string): Promise<T> {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body),
  });
  let envelope;
  try { envelope = await response.json(); } catch { throw new Error('Unable to reach sign-in. Please try again.'); }
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Sign-in could not be completed. Please try again.');
  return envelope.data as T;
}

export async function signOut(csrfToken: string) {
  await authMutation('/api/auth/logout/', {}, csrfToken);
  const previousUserId = snapshot.session?.user?.id ?? null;
  window.dispatchEvent(new CustomEvent('triggerboxd:account-change', { detail: { previousUserId, userId: null, signedOut: true } }));
  channel?.postMessage({ type: 'signed-out' });
  await refreshAuthSession();
}
