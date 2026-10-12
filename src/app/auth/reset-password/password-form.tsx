'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { authMutation, refreshAuthSession, useAuthSession } from '../../../lib/supabase/browser';
import styles from '../../login/login.module.css';

export default function PasswordForm({ next }: { next: string }) {
  const { session, loading, error: sessionError } = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.user || !session.passwordEnabled) return;
    const form = new FormData(event.currentTarget);
    const password = form.get('password');
    if (password !== form.get('confirm')) { setError('The passwords do not match.'); return; }
    setBusy(true); setError(null);
    try {
      await authMutation('/api/auth/password/', { password, next }, session.csrfToken);
      await refreshAuthSession(); setDone(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Your password could not be updated.'); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel} aria-busy={loading || busy}>
    <h1>Choose a new password</h1>
    {loading ? <p role="status">Checking your reset session…</p> : null}
    {sessionError || error ? <p className={styles.error} role="alert">{error ?? sessionError}</p> : null}
    {!loading && (!session?.user || !session.passwordEnabled) ? <p>This reset session is unavailable or has expired. <Link href={`/login/?next=${encodeURIComponent(next)}`}>Request a new reset link</Link>.</p> : null}
    {done ? <p role="status">Your password has been updated. <Link href={next}>Continue to your film</Link>.</p> : session?.user && session.passwordEnabled ? <form className={styles.form} onSubmit={submit}>
      <p>Use at least 12 characters.</p>
      <label>New password<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required disabled={busy} /></label>
      <label>Confirm new password<input name="confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" required disabled={busy} /></label>
      <button className="button" disabled={busy || Boolean(sessionError)}>{busy ? 'Saving…' : 'Update password'}</button>
    </form> : null}
  </section>;
}
