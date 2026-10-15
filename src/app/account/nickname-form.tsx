'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { authMutation, refreshAuthSession, useAuthSession } from '../../lib/supabase/browser';
import styles from '../login/login.module.css';
import PictureForm from './picture-form';

function Editor({ nickname, csrfToken, continueTo }: { nickname: string; csrfToken: string; continueTo?: string }) {
  const [value, setValue] = useState(continueTo && nickname === 'Viewer' ? '' : nickname);
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
      if (continueTo) { window.location.assign(continueTo); return; }
      void refreshAuthSession().catch(() => {});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save nickname.');
    } finally { setBusy(false); }
  }

  return <form className={styles.form} onSubmit={save}>
    <label>Nickname<input name="nickname" autoComplete="nickname" placeholder="ackermen1234" maxLength={60} value={value} onChange={event => setValue(event.target.value)} required disabled={busy} /></label>
    <p className={styles.fine}>For example, ackermen1234. Choose a nickname instead of your real name or contact details. You can save your nickname and contribute without a profile picture.</p>
    <button className="button" disabled={busy}>{busy ? 'Saving…' : continueTo ? 'Save nickname and continue' : 'Save nickname'}</button>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </form>;
}

export default function NicknameForm({setup=false,next='/account/'}:{setup?:boolean;next?:string}) {
  const { session, loading, error } = useAuthSession();
  const onboarding = setup || session?.user?.needsNickname === true;
  return <section className={styles.panel}>
    <p className="eyebrow">Your account</p><h1>{onboarding ? 'Choose your nickname' : 'Your profile'}</h1>
    {onboarding ? <p>One last step: choose how you want to be known. Your Google name and email stay private. A profile picture is optional and can be added later.</p> : null}
    {loading ? <p role="status">Checking your account…</p> : error ? <p className={styles.error} role="alert">{error}</p> : session?.user ? <Editor key={`${session.user.id}:${onboarding}`} nickname={session.user.nickname} csrfToken={session.csrfToken} continueTo={onboarding?next:undefined} /> : <p><Link href={`/login/?next=${encodeURIComponent(next)}`}>Sign in to choose a nickname</Link></p>}
    {!onboarding && !loading && !error && session?.user ? <PictureForm key={session.user.id} userId={session.user.id} nickname={session.user.nickname} /> : null}
    <p><Link href="/contributions/">Your contributions</Link></p>
  </section>;
}
