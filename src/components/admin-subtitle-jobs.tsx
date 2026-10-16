'use client';
import { useEffect, useRef, useState } from 'react';
import { ESTIMATE_VERDICTS, type SubtitleJob } from '../lib/subtitle-estimates';
import { refreshAuthSession } from '../lib/supabase/browser';
import { formatIstTime } from '../lib/ist-time';
type Film={id:string;tmdbId:number;title:string;year:number|null;state:string|null};
type View={jobs:SubtitleJob[];movies:Film[]};
const FACTOR_NAMES:Record<string,string>={mildProfanityCues:'Mild language',strongProfanityCues:'Strong language',slurCues:'Slurs',sexualContentCues:'Sexual references',sexualViolenceReferenceCues:'Sexual-violence references'};

export function AdminSubtitleJobs({accountId}:{accountId:string}) {
  const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[version,setVersion]=useState(0),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<string|null>(null),[rating,setRating]=useState(3),[watched,setWatched]=useState(false),[note,setNote]=useState('');
  const active=useRef(true),mutation=useRef<AbortController|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;mutation.current?.abort();};},[]);
  useEffect(()=>{
    const controller=new AbortController(); setError('');
    void fetch(`/api/v1/admin/subtitle-jobs/?q=${encodeURIComponent(search)}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok||!result.data)throw new Error(result.error?.message??'Unable to load subtitle jobs.');if(!controller.signal.aborted)setView(result.data);})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Unable to load jobs.');});
    return()=>controller.abort();
  },[search,version]);
  const current=view?.jobs.find(job=>job.id===selected);
  function choose(job:SubtitleJob){setSelected(job.id);setRating(job.approvedRating??job.result?.rating??3);setWatched(false);setNote('');setNotice('');}
  async function act(body:Record<string,unknown>) {
    if(busy)return;setBusy(true);setError('');setNotice('');const controller=new AbortController();mutation.current=controller;
    try {
      const session=await refreshAuthSession();if(!active.current||session.user?.id!==accountId)return;
      const response=await fetch('/api/v1/admin/subtitle-jobs/',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify(body)});
      const result=await response.json();if(!active.current)return;
      if(response.status===409){setSelected(null);setVersion(value=>value+1);throw new Error('Another moderator or the worker updated this result. Reload and review the latest version.');}
      if(!response.ok||!result.data)throw new Error(result.error?.message??'Unable to update this analysis.');
      setView(result.data);setWatched(false);setNote('');
      setNotice(body.action==='enqueue'?'Analysis requested. Existing requests are reused. Refresh to check progress.':body.action==='approve'?'Approved. Triggerboxd Thinks now shows this rating on the film guide.':body.action==='reject'?'Rejected. This result stays private.':'Reopened for review. The previous public estimate is withdrawn.');
    }catch(reason){if(active.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Unable to update this analysis.');}
    finally{if(active.current)setBusy(false);}
  }
  return <section aria-labelledby="subtitle-admin-heading" className="subtitle-admin">
    <h2 id="subtitle-admin-heading">Triggerboxd Thinks</h2>
    <p>Request a subtitle analysis, then review it against the film you watched. Only approved estimates appear publicly.</p>
    <p className="fine">Experimental dialogue scoring. Counts are clues, not verified scenes or measured confidence. Nudity, intimacy and gore require your independent viewing. Subtitle text is kept off this dashboard.</p>
    <form className="subtitle-search" onSubmit={event=>{event.preventDefault();setSearch(query.trim());setVersion(value=>value+1);}}>
      <label htmlFor="subtitle-film-search">Find a film already in Triggerboxd</label>
      <div className="adm-review-actions"><input id="subtitle-film-search" type="search" value={query} maxLength={100} onChange={event=>setQuery(event.target.value)} required/><button className="mvp-secondary" disabled={busy} type="submit">Search</button></div>
      <p className="fine">For a missing film, <a href="/search/">find and open it in the catalogue</a> first.</p>
    </form>
    {error?<p role="alert" className="adm-review-error">{error}</p>:null}
    {notice?<p role="status">{notice}</p>:null}
    {view?.movies.length?<ul className="adm-list">{view.movies.map(film=><li key={film.id}><span>{film.title} {film.year?`(${film.year})`:''}</span><span className="fine">{film.state?.replaceAll('_',' ')??'Not analysed'}</span><button type="button" className="mvp-secondary" disabled={busy||!!film.state} onClick={()=>void act({action:'enqueue',tmdbId:film.tmdbId})}>{film.state?'Already requested':'Analyse subtitles'}</button></li>)}</ul>:search?<p>No matching films found in this catalogue.</p>:null}
    <div className="adm-review-actions"><h3>Recent analysis jobs</h3><button type="button" className="mvp-secondary" disabled={busy} onClick={()=>setVersion(value=>value+1)}>Refresh jobs</button></div>
    {!view?<p role="status">Loading analysis jobs…</p>:!view.jobs.length?<p>No analysis requested yet.</p>:<ul className="adm-list">{view.jobs.map(job=><li key={job.id}>
      <button type="button" className="adm-review-link" aria-expanded={selected===job.id} onClick={()=>choose(job)}>{job.title} · {job.state.replaceAll('_',' ')}</button>
      <span className="fine">Updated {formatIstTime(job.updatedAt)}{job.failureReason?` · ${job.failureReason.replaceAll('_',' ')}`:''}</span>
    </li>)}</ul>}
    {current?<section className="adm-review-detail" aria-label={`${current.title}: analysis review`}>
      <h3><a href={`/movies/${current.movieId}/`}>{current.title}</a></h3>
      <p>Status: <strong>{current.state.replaceAll('_',' ')}</strong> · Revision {current.revision}</p>
      {current.result?<><p>Script proposes: <strong>{current.result.rating===null?'Unrated':`${current.result.rating}/5`}</strong>{current.result.rating!==null?` · ${ESTIMATE_VERDICTS[current.result.rating]}`:''}</p>
        <dl className="subtitle-factors">{Object.entries(current.result.factors).map(([key,count])=><div key={key}><dt>{FACTOR_NAMES[key]??key}</dt><dd>{count} cues</dd></div>)}</dl>
        <p className="fine">{current.result.cueCount} subtitle cues · {current.result.subtitleLanguage} · Vocabulary {current.result.rulesVersion} · Scorer {current.result.scorerVersion}. Visual coverage unknown.</p></>:<p>{current.state==='failed'?'Analysis failed. Reopen to request a bounded retry.':'Waiting for the background worker. Refresh jobs to check progress.'}</p>}
      {current.reviewer?<p className="fine">Reviewed by {current.reviewer}{current.reviewedAt?` · ${formatIstTime(current.reviewedAt)}`:''}</p>:null}
      {current.note?<p>Review note: {current.note}</p>:null}
      {current.state==='needs_review'?<form className="adm-flag-form" onSubmit={event=>{event.preventDefault();void act({action:'approve',id:current.id,expectedRevision:current.revision,rating,watched,note:note.trim()||null});}}>
        <label>Family awkwardness rating<select value={rating} disabled={busy} onChange={event=>setRating(Number(event.target.value))}>{[1,2,3,4,5].map(level=><option key={level} value={level}>{level}/5 · {ESTIMATE_VERDICTS[level]}</option>)}</select></label>
        <label><input type="checkbox" checked={watched} disabled={busy} onChange={event=>setWatched(event.target.checked)}/> I watched this film edition and checked the proposed rating.</label>
        <label>Reason or correction (required to adjust or reject)<textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={280} rows={3} disabled={busy}/></label>
        <p className="fine">Use a spoiler-safe reason. Do not include names, contact details or subtitle excerpts.</p>
        <div className="adm-review-actions"><button type="submit" className="mvp-secondary" disabled={busy||!watched||(rating!==current.result?.rating&&!note.trim())}>Approve and publish {rating}/5</button><button type="button" className="mvp-secondary" disabled={busy||!note.trim()} onClick={()=>void act({action:'reject',id:current.id,expectedRevision:current.revision,note:note.trim()})}>Reject</button></div>
      </form>:['approved','rejected','failed'].includes(current.state)?<form className="adm-flag-form" onSubmit={event=>{event.preventDefault();void act({action:'reopen',id:current.id,expectedRevision:current.revision,note:note.trim()});}}>
        {current.state==='approved'?<p>Already approved: {current.approvedRating}/5. Further decisions require reopening this review.</p>:null}
        <label>Reason to reopen<textarea value={note} maxLength={280} rows={2} onChange={event=>setNote(event.target.value)} disabled={busy}/></label>
        <button className="mvp-secondary" type="submit" disabled={busy||!note.trim()}>Reopen review{current.state==='approved'?' and withdraw estimate':''}</button>
      </form>:null}
    </section>:null}
  </section>;
}
