'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CATEGORY_SLUGS, type CategorySlug } from '../lib/contracts';
import { formatTimestamp, parseTimestamp, type MovieNote, type MovieNotes } from '../lib/scene-contracts';
import { refreshAuthSession, useAuthSession } from '../lib/supabase/browser';
import { ContributorIdentity } from './contributor-identity';

const label=(s:string)=>({
 gore_graphic_violence:'Gore / disturbing visuals',
 graphic_violence:'Graphic violence / bloodshed',
 horror:'Horror / frightening content',
} as Record<string,string>)[s]??s.replaceAll('_',' ');
async function read<T>(response:Response):Promise<T>{let body;try{body=await response.json();}catch{throw new Error('Unable to reach the service. Please try again.');}if(!response.ok)throw new Error(body.error?.message??'Unable to complete this request.');return body.data;}
export function MovieScenes({movieId,onChanged,watched=false,readOnly=false}:{movieId:string;onChanged?:()=>void;watched?:boolean;readOnly?:boolean}){
 const [open,setOpen]=useState(false);const {session}=useAuthSession();
 return <details className="mvp-scenes" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Scene timeline &amp; community notes</summary>
  <p>Timestamps are approximate and may differ between streaming, theatrical, censored or extended versions. Notes are community reports.</p>
  {open&&<ScenePanel key={`${movieId}:${session?.user?.id??'public'}`} movieId={movieId} signedIn={!!session?.user} watched={watched} readOnly={readOnly} onChanged={onChanged}/>}
 </details>;
}
function ScenePanel({movieId,signedIn,onChanged,watched,readOnly}:{movieId:string;signedIn:boolean;onChanged?:()=>void;watched:boolean;readOnly:boolean}){
 const [filter,setFilter]=useState<CategorySlug|''>('');const [page,setPage]=useState<MovieNotes>({notes:[],nextOffset:null});
 const [status,setStatus]=useState('');const [loading,setLoading]=useState(false);const [epoch,setEpoch]=useState(0);
 const [viewCategory,setViewCategory]=useState<CategorySlug>('nudity');const [level,setLevel]=useState<0|1|2>(0);const [revealCategory,setRevealCategory]=useState<CategorySlug>('nudity');
 const [ownOpen,setOwnOpen]=useState(false);const [report,setReport]=useState<MovieNote|null>(null);
 const sequence=useRef(0);const alive=useRef(true);
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
 const path=`/api/v1/movies/${movieId}/scenes/`;
 // Each exact mutation body keeps its key for an uncertain network retry.
 const retries=useRef(new Map<string,string>());
 async function mutate<T>(url:string,method:string,body:Record<string,unknown>):Promise<T>{
  const session=await refreshAuthSession();const serialized=JSON.stringify(body);const identity=`${url}:${method}:${serialized}`;
  let key=retries.current.get(identity);if(!key){key=crypto.randomUUID();retries.current.set(identity,key);}
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':key},body:serialized});
  const data=await read<T>(response);retries.current.delete(identity);return data;
 }
 useEffect(()=>{
  const controller=new AbortController();const request=++sequence.current;setLoading(true);setStatus('');setPage({notes:[],nextOffset:null});setLevel(0);setReport(null);
  const query=filter?`?category=${encodeURIComponent(filter)}`:'';
  void fetch(path+query,{cache:'no-store',signal:controller.signal}).then(read<MovieNotes>).then(data=>{if(sequence.current===request)setPage(data);}).catch(e=>{if(!controller.signal.aborted&&sequence.current===request)setStatus(e.message);}).finally(()=>{if(!controller.signal.aborted&&sequence.current===request)setLoading(false);});
  return ()=>controller.abort();
 },[path,filter,epoch]);
 function refreshed(){setLevel(0);setEpoch(n=>n+1);onChanged?.();}
 async function load(offset:number,revealLevel:0|1|2=level,selected:CategorySlug|''=level?viewCategory:filter){
  const request=++sequence.current;setLoading(true);setStatus('');
  try{
   const data=revealLevel?await mutate<MovieNotes>(path,'POST',{categories:[selected],level:revealLevel,offset}):await read<MovieNotes>(await fetch(path+`?offset=${offset}${selected?`&category=${selected}`:''}`,{cache:'no-store'}));
   if(!alive.current||request!==sequence.current)return;
   if(selected)setViewCategory(selected);setLevel(revealLevel);setPage(prev=>({notes:offset?[...prev.notes,...data.notes]:data.notes,nextOffset:data.nextOffset}));
  }catch(e){if(alive.current&&request===sequence.current)setStatus(e instanceof Error?e.message:'Unable to load notes.');}
  finally{if(alive.current&&request===sequence.current)setLoading(false);}
 }
 return <div className="mvp-scenes-panel">
  <label>Filter category <select value={filter} onChange={e=>setFilter(e.target.value as CategorySlug|'')}><option value="">All public categories</option>{CATEGORY_SLUGS.map(c=><option key={c} value={c}>{label(c)}</option>)}</select></label>
  <details className="mvp-scene-reveal"><summary>Reveal selected category information</summary><p>Only your chosen category will be loaded.</p>
   <label>Category to reveal <select value={revealCategory} onChange={e=>setRevealCategory(e.target.value as CategorySlug)}>{CATEGORY_SLUGS.map(c=><option key={c} value={c}>{label(c)}</option>)}</select></label>
   <button type="button" disabled={loading} onClick={()=>void load(0,2,revealCategory)}>Reveal this category</button>
  </details>
  <p role="status" aria-live="polite">{loading?'Loading notes…':status}</p>
  {!loading&&!status&&page.notes.length===0&&<p>No public notes in this view.</p>}
  <ul className="mvp-scene-list">{page.notes.map(note=><li key={note.id}>
   <ContributorIdentity author={note.author}/>
   <strong>{label(note.category)}</strong> {note.severity!=null&&<span> · {['None','Mild','Moderate','Severe','Very severe','Extreme'][note.severity]}</span>} {note.startSeconds!==null&&<span>{formatTimestamp(note.startSeconds)}{note.endSeconds!==null?` – ${formatTimestamp(note.endSeconds)}`:''}</span>}
   {note.version&&<p>Version: {note.version}</p>}
   {note.comment===null?<button type="button" disabled={loading} onClick={()=>void load(0,1,note.category)}>Reveal details for this category</button>:<p className="mvp-scene-comment">{note.comment}</p>}
   {signedIn&&<button type="button" onClick={()=>setReport(note)}>Report / suggest correction</button>}
  </li>)}</ul>
  {page.nextOffset!==null&&<button type="button" disabled={loading} onClick={()=>void load(page.nextOffset!)}>Load more notes</button>}
  {level>0&&<><p>Showing revealed notes for {label(viewCategory)}.</p><button type="button" onClick={refreshed}>Return to spoiler-free notes</button></>}
  {report&&<ReportForm note={report} mutate={mutate} movieId={movieId} close={()=>setReport(null)}/>}
  {!readOnly && signedIn && watched?<details onToggle={e=>setOwnOpen(e.currentTarget.open)}><summary>Add or manage your notes</summary>{ownOpen&&<OwnNotes path={path} mutate={mutate} onSaved={refreshed} watched={watched}/>}</details>:!readOnly && !signedIn?<a href={`/login/?next=${encodeURIComponent(`/movies/${movieId}/`)}`}>Sign in to add or report notes</a>:null}
 </div>;
}
type Mutate=<T>(url:string,method:string,body:Record<string,unknown>)=>Promise<T>;
/** Owner-only note controls mounted by a single expanded contribution card. */
export function CategoryOwnNotes({movieId,category,watched,onChanged}:{movieId:string;category:CategorySlug;watched:boolean;onChanged:()=>void}){
 const [open,setOpen]=useState(false);
 const retries=useRef(new Map<string,string>());
 const path=`/api/v1/movies/${encodeURIComponent(movieId)}/scenes/`;
 const mutate:Mutate=async <T,>(url:string,method:string,body:Record<string,unknown>):Promise<T>=>{
  const session=await refreshAuthSession();if(!session.user)throw new Error('Sign in again to edit notes.');
  const encoded=JSON.stringify(body),identity=`${url}:${method}:${encoded}`;
  let key=retries.current.get(identity);if(!key){key=crypto.randomUUID();retries.current.set(identity,key);}
  const result=await read<T>(await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':key},body:encoded}));
  retries.current.delete(identity);return result;
 };
 return <details className="unified-note-manager" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Notes and scene timestamps</summary>{open?<OwnNotes path={path} mutate={mutate} onSaved={onChanged} watched={watched} category={category}/>:null}</details>;
}
function OwnNotes({path,mutate,onSaved,watched,category}:{path:string;mutate:Mutate;onSaved:()=>void;watched:boolean;category?:CategorySlug}){
 const [notes,setNotes]=useState<MovieNote[]>([]);const [editing,setEditing]=useState<MovieNote|null>(null);const [message,setMessage]=useState('');const [revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();void fetch(path+'own/',{cache:'no-store',signal:controller.signal}).then(read<{notes:MovieNote[]}>).then(d=>setNotes(d.notes)).catch(e=>{if(!controller.signal.aborted)setMessage(e.message);});return ()=>controller.abort();},[path,revision]);
 const [deleting,setDeleting]=useState<MovieNote|null>(null);const [busy,setBusy]=useState(false);
 async function remove(){if(!deleting||!watched)return;setBusy(true);try{await mutate(path,'DELETE',{noteId:deleting.id,expectedRevision:deleting.revision});setDeleting(null);setEditing(null);setRevision(n=>n+1);onSaved();}catch(e){setMessage(e instanceof Error?e.message:'Unable to delete.');}finally{setBusy(false);}}
 return <div className="mvp-own-notes"><p>Your own entries below may contain spoilers.</p><p role="status">{message}</p><button type="button" hidden={!message} disabled={busy} onClick={()=>{setEditing(null);setDeleting(null);setRevision(n=>n+1);setMessage('');}}>Retry loading notes</button>
  {notes.filter(n=>!category||n.category===category).map(n=><div key={n.id}><span>{label(n.category)} · {formatTimestamp(n.startSeconds)||'No timestamp'}</span><p className="mvp-scene-comment">{n.comment}</p><button type="button" onClick={()=>setEditing(n)}>Edit note</button><button type="button" onClick={()=>setDeleting(n)}>Delete note</button></div>)}
  {deleting&&<div role="group" aria-label="Confirm deleting note"><p>Delete this note? This cannot be undone.</p><button type="button" disabled={busy} onClick={()=>void remove()}>Confirm delete</button><button type="button" disabled={busy} onClick={()=>setDeleting(null)}>Cancel</button></div>}
  <NoteForm watched={watched} category={category} key={editing?.id??`new:${revision}`} note={editing} save={async body=>{await mutate(path,'PUT',body);setEditing(null);setRevision(n=>n+1);onSaved();}} cancel={()=>setEditing(null)}/>
 </div>;
}
function NoteForm({note,save,cancel,watched,category}:{note:MovieNote|null;save:(body:Record<string,unknown>)=>Promise<void>;cancel:()=>void;watched:boolean;category?:CategorySlug}){
 const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const id=useRef(note?.id??'');
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!watched)return;const form=e.currentTarget;const f=new FormData(form);setBusy(true);setMessage('');try{
  if(!id.current)id.current=crypto.randomUUID();
  await save({noteId:id.current,expectedRevision:note?.revision??0,watched:true,category:category??f.get('category'),severity:f.get('severity')===''?null:Number(f.get('severity')),comment:String(f.get('comment')??'').trim()||null,startSeconds:parseTimestamp(String(f.get('start')??'')),endSeconds:parseTimestamp(String(f.get('end')??'')),version:String(f.get('version')??'').trim()||null,spoilerLevel:Number(f.get('spoiler'))});
  setMessage('Note saved.');
 }catch(e){setMessage(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}}
 return <form onSubmit={submit} className="mvp-scene-form"><h3>{note?'Edit note':'Add optional note or scene'}</h3>
  {category?<p className="fine">Category: {label(category)}</p>:<label>Category <select name="category" defaultValue={note?.category??'nudity'}>{CATEGORY_SLUGS.map(c=><option key={c} value={c}>{label(c)}</option>)}</select></label>}
  <label>Severity (optional)<select name="severity" defaultValue={note?.severity??''}><option value="">Unknown / not assessed</option><option value="0">None</option><option value="1">Mild</option><option value="2">Moderate</option><option value="3">Severe</option><option value="4">Very severe</option><option value="5">Extreme</option></select></label>
  <label>Comment (optional, up to 280 characters)<textarea name="comment" maxLength={280} defaultValue={note?.comment??''}/></label>
  <label>Start (optional, HH:MM:SS)<input name="start" placeholder="00:12:30" defaultValue={formatTimestamp(note?.startSeconds??null)}/></label>
  <label>End (optional, HH:MM:SS)<input name="end" placeholder="00:13:00" defaultValue={formatTimestamp(note?.endSeconds??null)}/></label>
  <label>Movie version (optional)<input name="version" maxLength={80} defaultValue={note?.version??''}/></label>
  <label>Spoiler protection <select name="spoiler" defaultValue={note?.spoilerLevel??0}><option value="0">No spoiler</option><option value="1">Description is a spoiler</option><option value="2">Even the category is a spoiler</option></select></label>
  <p>Provide a comment or a start timestamp. Avoid personal information.</p>
  <button disabled={busy||!watched} type="submit">{busy?'Saving…':'Save note'}</button>{note&&<button type="button" disabled={busy} onClick={cancel}>Cancel edit</button>}<p role="status" aria-live="polite">{message}</p>
 </form>;
}
function ReportForm({note,mutate,movieId,close}:{note:MovieNote;mutate:Mutate;movieId:string;close:()=>void}){
 const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);try{await mutate(`/api/v1/movies/${movieId}/reports/`,'POST',{noteId:note.id,targetRevision:note.revision,reason:f.get('reason'),correction:String(f.get('correction')??'').trim()||null});setMessage('Report sent for owner review.');}catch(e){setMessage(e instanceof Error?e.message:'Unable to report.');}finally{setBusy(false);}}
 return <form onSubmit={submit} className="mvp-scene-form"><h3>Report note</h3><label>Reason <select name="reason"><option value="incorrect">Incorrect information</option><option value="spoiler">Unmarked spoiler</option><option value="abuse">Abuse</option></select></label><label>Suggested correction (optional)<textarea name="correction" maxLength={280}/></label><button type="submit" disabled={busy}>Send report</button><button type="button" onClick={close}>Close</button><p role="status">{message}</p></form>;
}
