'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { isUuid } from '../lib/validation';
import { MovieStory } from './movie-story';

export const SHARE_ORIGIN = 'https://triggerboxd.com';

export function movieShareUrl(movieId: string): string {
  return `${SHARE_ORIGIN}/movies/${encodeURIComponent(movieId)}/`;
}

export function whatsappShareUrl(url: string, title: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
}

export function redditShareUrl(url: string, title: string): string {
  return `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
}

type ShareOutcome = { state: 'success' | 'error'; text: string };

const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
}

async function copyText(value: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard?.writeText) {
    try { await clipboard.writeText(value); return true; } catch { /* Fall back to the manual route below. */ }
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch { return false; }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function MovieShare({ movieId, title, posterPath, year, genres, backdropPath }: { movieId: string; title: string; posterPath?: string|null;year?:number|null;genres?:string[];backdropPath?:string|null }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [nativeShare, setNativeShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const shareable = isUuid(movieId);
  const url = movieShareUrl(movieId);
  const shareTitle = title.trim() || 'this film';

  useEffect(() => {
    setNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current;
      node.showModal();
      firstFocusable(node)?.focus();
    } else if (!open && node.open) node.close();
  }, [open]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const onClose = () => { restoreFocus.current?.focus(); restoreFocus.current = null; };
    node.addEventListener('close', onClose);
    return () => node.removeEventListener('close', onClose);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  function close() { setOpen(false); }

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      await navigator.share({ title: shareTitle, url });
      setOutcome({ state: 'success', text: 'The share sheet opened.' });
      close();
    } catch (error) {
      if (isAbort(error)) { close(); return; }
      const copied = await copyText(url);
      setOutcome(copied
        ? { state: 'success', text: 'Sharing was unavailable. The link is copied instead.' }
        : { state: 'error', text: 'Sharing and copying both failed. Copy the link below by hand.' });
    } finally { setBusy(false); }
  }

  async function copyLink() {
    if (busy) return;
    setBusy(true);
    const copied = await copyText(url);
    setOutcome(copied
      ? { state: 'success', text: 'Link copied to the clipboard.' }
      : { state: 'error', text: 'The link could not be copied. Copy the link below by hand.' });
    setBusy(false);
  }

  return <>
    <button ref={trigger} type="button" className="mvp-share-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={`Share ${shareTitle}`} disabled={!shareable} onClick={() => { setOutcome(null); setOpen(value => !value); }}>Share</button>
    <dialog ref={dialog} className="mvp-share" aria-labelledby={titleId} onClick={event => { if (event.target === dialog.current) close(); }} onCancel={close}>
      <div className="mvp-share-panel">
        <h2 id={titleId}>Share this film</h2>
        <p className="fine">The link buttons share only the film title and URL. Story cards below include the report you choose.</p>
        <div className="mvp-share-actions">
          {nativeShare ? <button type="button" className="mvp-secondary" disabled={busy} onClick={() => void share()}>{busy ? 'Sharing…' : 'Share via device'}</button> : null}
          <button type="button" className="button mvp-share-primary" disabled={busy} onClick={() => void copyLink()}>{busy ? 'Copying…' : 'Copy link'}</button>
        </div>
        <ul className="mvp-share-links">
          <li><a href={whatsappShareUrl(url, shareTitle)} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>Send on WhatsApp</a></li>
          <li><a href={redditShareUrl(url, shareTitle)} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>Share on Reddit</a></li>
        </ul>
        <label className="mvp-share-field">Film link<input className="mvp-share-url" type="text" value={url} readOnly spellCheck={false} aria-label="Canonical film link" onFocus={event => event.currentTarget.select()} /></label>
        {open ? <MovieStory movieId={movieId} title={shareTitle} posterPath={posterPath} year={year} genres={genres} backdropPath={backdropPath} /> : null}
        <div className="mvp-share-feedback" role="status" aria-live="polite" data-visible={outcome?.state === 'success' ? 'true' : 'false'}>{outcome?.state === 'success' ? outcome.text : ''}</div>
        <div className="mvp-share-feedback mvp-share-error" role="alert" aria-live="assertive" data-visible={outcome?.state === 'error' ? 'true' : 'false'}>{outcome?.state === 'error' ? outcome.text : ''}</div>
        <button type="button" className="mvp-share-close" onClick={close}>Close</button>
      </div>
    </dialog>
  </>;
}
