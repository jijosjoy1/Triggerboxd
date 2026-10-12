'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { authMutation, refreshAuthSession, signOut, useAuthSession } from '../../lib/supabase/browser';
import styles from './login.module.css';

type Mode = 'login' | 'signup' | 'recovery';

export default function LoginForm({ next, linkError }: { next: string; linkError: string | null }) {
  const { session, loading, error: sessionError } = useAuthSession();
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const configured = session?.configured ?? false;
  const disabled = loading || busy || !configured || Boolean(sessionError);

  async function google() {
    if (!session) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const data = await authMutation<{ url: string }>('/api/auth/google/', { next }, session.csrfToken);
      window.location.assign(data.url);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in could not be completed.'); setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || disabled) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await authMutation<{ message?: string }>(`/api/auth/${mode}/`, { email: form.get('email'), ...(mode !== 'recovery' ? { password: form.get('password') } : {}), ...(mode === 'signup' ? { displayName: form.get('displayName') } : {}), next }, session.csrfToken);
      if (mode === 'login') { await refreshAuthSession(); window.location.assign(next); }
      else setNotice(result.message ?? 'Check your email for the next step.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in could not be completed.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (!session) return;
    setBusy(true); setError(null);
    try { await signOut(session.csrfToken); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-out failed.'); }
    finally { setBusy(false); }
  }

  return <section className={styles.panel} aria-busy={busy || loading}>
    <p className="eyebrow">Your account</p>
    <h1>Sign in to contribute</h1>
    <p>Share content warnings for films you’ve watched. You can browse warnings without an account.</p>
    {linkError ? <p className={styles.error} role="alert">{linkError === 'link' ? 'This confirmation or reset link has expired or was already used. Request a new link below.' : 'Sign-in could not be completed. Try again from this page.'}</p> : null}
    {loading ? <p role="status">Checking sign-in availability…</p> : null}
    {!loading && !configured ? <p className={styles.notice} role="status">Sign-in is not available yet. Authentication setup is still pending.</p> : null}
    {sessionError ? <p className={styles.error} role="alert">{sessionError} <button className={styles.tab} onClick={() => void refreshAuthSession().catch(() => {})}>Retry</button></p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {session?.user ? <div>
      <p>You’re signed in{session.user.email ? ` as ${session.user.email}` : ''}.</p>
      <p><Link className="button" href={next}>Continue to your film</Link></p>
      <button className={styles.tab} disabled={busy} onClick={logout}>Sign out</button>
    </div> : <>
      <button className={`button ${styles.full}`} disabled={disabled || session?.googleEnabled === false} onClick={google}>{busy ? 'Please wait…' : 'Continue with Google'}</button>
      {session?.passwordEnabled ? <>
        <div className={styles.tabs} aria-label="Email sign-in options">
          {(['login', 'signup', 'recovery'] as Mode[]).map(value => <button key={value} type="button" className={styles.tab} disabled={busy} aria-pressed={mode === value} onClick={() => { setMode(value); setError(null); setNotice(null); }}>{value === 'login' ? 'Email sign-in' : value === 'signup' ? 'Create account' : 'Forgot password'}</button>)}
        </div>
        <form className={styles.form} onSubmit={submit}>
          {mode === 'signup' ? <label>Display name<input name="displayName" autoComplete="nickname" maxLength={60} required disabled={busy} /></label> : null}
          <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} /></label>
          {mode !== 'recovery' ? <label>Password<input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 12 : 1} maxLength={128} required disabled={busy} /></label> : null}
          {mode === 'signup' ? <p className={styles.fine}>Use at least 12 characters. You’ll need to confirm your email before contributing. Your display name is separate from your email sign-in.</p> : null}
          <button className={`button ${styles.full}`} disabled={disabled}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in with email' : mode === 'signup' ? 'Create account' : 'Send reset link'}</button>
        </form>
      </> : <p className={styles.fine}>Email sign-in will be available after email delivery is configured.</p>}
    </>}
    <p className={styles.fine}><Link href="/privacy/">Privacy</Link> · <Link href={next}>Return to browsing</Link></p>
  </section>;
}
