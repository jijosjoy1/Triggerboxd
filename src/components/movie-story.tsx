'use client';
import { useEffect, useRef, useState } from 'react';
import { drawStoryCard } from '../lib/story-card';
import type { FamilySummaryResult } from '../lib/representation-contracts';
import { refreshAuthSession } from '../lib/supabase/browser';

export function MovieStory({movieId,title}:{movieId:string;title:string}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const generation = useRef(0);
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const [summary,setSummary] = useState<FamilySummaryResult['familySummary'] | null>(null);
  useEffect(() => { generation.current++; setOpen(false); setSummary(null); setBusy(false); setMessage(''); return () => { generation.current++; }; }, [movieId,title]);
  useEffect(() => { if (open && canvas.current) { try { drawStoryCard(canvas.current,title,summary); } catch(e) { setMessage(e instanceof Error ? e.message : 'Image unavailable.'); } } }, [open,title,summary]);
  async function check() {
    const version = generation.current; setBusy(true); setMessage('');
    try {
      const auth = await refreshAuthSession();
      const response = await fetch(`/api/v1/movies/${movieId}/family-summary`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',...(auth ? {'X-CSRF-Token':auth.csrfToken} : {})},body:JSON.stringify({check:true})});
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? 'Could not check family votes.');
      if (version === generation.current) setSummary(result.data.familySummary);
    } catch(e) { if (version === generation.current) setMessage(e instanceof Error ? e.message : 'Could not check votes.'); }
    finally { if (version === generation.current) setBusy(false); }
  }
  function download() {
    const version = generation.current;
    canvas.current?.toBlob(blob => {
      if (version !== generation.current) return;
      if (!blob) { setMessage('Could not create the PNG. Try again.'); return; }
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `triggerboxd-${movieId}-story.png`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),60000);
      setMessage('PNG download requested. Save it, then upload it to your Story.');
    },'image/png');
  }
  return <section className="mvp-story"><button type="button" className="mvp-secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>Make a funny Story card</button>{open ? <div className="mvp-story-panel"><p className="fine">A playful family-screening card. No plot, warnings or contributor identities. Checking family votes may reveal context.</p><canvas ref={canvas} className="mvp-story-preview" role="img" aria-label={`${title}. Family-screening Story card; community opinion, not a safety guarantee.`}/><button type="button" className="mvp-secondary" disabled={busy} onClick={()=>void check()}>{busy ? 'Checking…' : 'Use community family votes · may reveal context'}</button><button type="button" className="button" disabled={busy} onClick={download}>Download Story PNG</button><p className="fine">1080 × 1920. Manual upload to Instagram or any Story app.</p>{message ? <p role="status">{message}</p> : null}</div> : null}</section>;
}
