'use client';
import { useEffect, useRef, useState } from 'react';
import { avatarUrl, AVATAR_MAX_BYTES, AVATAR_SIZE } from '../../lib/avatar';
import { refreshAuthSession } from '../../lib/supabase/browser';
import styles from './picture.module.css';

async function preparePicture(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP image smaller than 5 MB.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16_000_000) throw new Error('Choose an image smaller than 16 megapixels.');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d'); if (!context) throw new Error('This browser cannot prepare a profile picture.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const edge = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to prepare this picture.')), 'image/jpeg', 0.82));
    if (result.size > AVATAR_MAX_BYTES) throw new Error('This picture is too detailed. Try a simpler image.');
    return result;
  } finally { bitmap.close(); }
}

export default function PictureForm({ userId, nickname }: { userId: string; nickname: string }) {
  const [savedId, setSavedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const mounted = useRef(true), selection = useRef(0), request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void fetch('/api/v1/me/picture/', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? 'Unable to load your picture.');
      if (mounted.current) setSavedId(body.data.avatarId);
    }).catch(reason => { if (!controller.signal.aborted && mounted.current) setError(reason.message); })
      .finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; selection.current++; controller.abort(); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!draft) { setPreview(null); return; }
    const url = URL.createObjectURL(draft); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [draft]);
  async function choose(file: File) {
    const version = ++selection.current; setError(''); setMessage(''); setBusy(true);
    try { const blob = await preparePicture(file); if (mounted.current && version === selection.current) setDraft(blob); }
    catch (reason) { if (mounted.current && version === selection.current) setError(reason instanceof Error ? reason.message : 'Unable to read this picture.'); }
    finally { if (mounted.current && version === selection.current) setBusy(false); }
  }
  async function save(remove = false) {
    if (busy || (!remove && !draft)) return;
    setBusy(true); setError(''); setMessage('');
    const controller = new AbortController(); request.current = controller;
    try {
      const session = await refreshAuthSession();
      if (!mounted.current || session.user?.id !== userId) throw new Error('Your account changed. Reload before saving.');
      const image = !remove && draft ? btoa(String.fromCharCode(...new Uint8Array(await draft.arrayBuffer()))) : null;
      if (!mounted.current) return;
      const response = await fetch('/api/v1/me/picture/', { method: remove ? 'DELETE' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify(remove ? {} : { image }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Unable to save your picture.');
      if (!mounted.current) return;
      setSavedId(result.data.avatarId); setDraft(null); if (input.current) input.current.value = '';
      setMessage(remove ? 'Profile picture removed. Your notes no longer show your picture or nickname.' : 'Profile picture saved. It is public beside your nickname on community notes.');
    } catch (reason) { if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to save your picture.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  const source = preview || avatarUrl(savedId);
  return <section className={styles.section} aria-labelledby="profile-picture-title">
    <h2 id="profile-picture-title">Profile picture</h2>
    <div className={styles.identity}>
      {source ? <img className={styles.picture} src={source} alt={draft ? 'New profile picture preview' : 'Your profile picture'} width={88} height={88} /> : <span className={styles.placeholder} aria-hidden="true">{nickname.trim().slice(0, 1).toUpperCase() || '?'}</span>}
      <div><strong>{nickname}</strong><p className={styles.hint}>{draft ? 'Preview · not saved yet' : loading ? 'Loading picture…' : savedId ? 'Public on community notes' : 'No picture added'}</p></div>
    </div>
    <p className={styles.hint}>Saving a picture makes it and your nickname public on your existing and future community notes. Google photos are never imported. Use an avatar if you prefer not to show your face.</p>
    <label className={styles.label}>Choose a picture<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={loading || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void choose(file); }} /></label>
    <p className={styles.hint}>JPG, PNG or WebP, up to 5 MB and 16 megapixels. Preview is cropped to a square. Only a resized copy is saved; photo metadata is removed.</p>
    <div className={styles.actions}>
      <button type="button" className="button" disabled={loading || busy || !draft} onClick={() => void save()}>{busy ? 'Working…' : 'Save picture'}</button>
      {draft ? <button type="button" className="button" disabled={busy} onClick={() => { setDraft(null); if (input.current) input.current.value = ''; }}>Discard preview</button> : null}
      {savedId ? <button type="button" className="button" disabled={loading || busy} onClick={() => void save(true)}>Remove picture</button> : null}
    </div>
    {message ? <p role="status">{message}</p> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}
  </section>;
}
