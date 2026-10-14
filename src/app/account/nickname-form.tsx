'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { authMutation, refreshAuthSession, useAuthSession } from '../../lib/supabase/browser';
import styles from '../login/login.module.css';

function Editor({ nickname, csrfToken }: { nickname: string; csrfToken: string }) {
  const [value, setValue] = useState(nickname);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await authMutation<{ nickname: string }>('/api/v1/me/nickname/', { nickname: value }, csrfToken);
      setValue(result.nickname);
      setMessage('Nickname saved. Your Google name and email stay private.');
      void refreshAuthSession().catch(() => {});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save nickname.');
    } finally { setBusy(false); }
  }

  return <form className={styles.form} onSubmit={save}>
    <label>Nickname<input name="nickname" autoComplete="nickname" maxLength={60} value={value} onChange={event => setValue(event.target.value)} required disabled={busy} /></label>
    <p className={styles.fine}>Choose a name you are comfortable using if contributor names are shown in the future. Avoid your real name or contact details.</p>
    <button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save nickname'}</button>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </form>;
}

export default function NicknameForm() {
  const { session, loading, error } = useAuthSession();
  return <section className={styles.panel}>
    <p className="eyebrow">Your account</p><h1>Nickname</h1>
    {loading ? <p role="status">Checking your account…</p> : error ? <p className={styles.error} role="alert">{error}</p> : session?.user ? <Editor key={session.user.id} nickname={session.user.nickname} csrfToken={session.csrfToken} /> : <p><Link href="/login/?next=%2Faccount%2F">Sign in to choose a nickname</Link></p>}
    <p><Link href="/contributions/">Your contributions</Link></p>
  </section>;
}
