'use client';

import {useEffect,useRef,useState} from 'react';

import { familyAwkwardness } from '../lib/signature-questions';

import {refreshAuthSession,useAuthSession} from '../lib/supabase/browser';

import {REPRESENTATION_LABELS,type RepresentationSlug,type RepresentationResult,type OwnRepresentationResult,type FamilySummaryResult} from '../lib/representation-contracts';

async function request<T>(url:string,method='GET',body?:unknown,key?:string):Promise<T>{const auth=method==='GET'?null:await refreshAuthSession();const response=await fetch(url,{method,cache:'no-store',headers:auth?{'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken,...(key?{'Idempotency-Key':key}:{})}:undefined,body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result?.error?.message??'Could not load information.');return result.data as T;}

type Props={movieId:string;refreshKey?:number;onChanged?:()=>void;watched?:boolean;readOnly?:boolean};

export function MovieRepresentation(props:Props){const {session}=useAuthSession();return <RepresentationContent key={`${props.movieId}:${session?.user?.id??'anonymous'}:${props.refreshKey??0}`} {...props} signedIn={!!session?.user}/>;}

function RepresentationContent({movieId,onChanged,signedIn,watched=false,readOnly=false}:Props&{signedIn:boolean}){

 const [open,setOpen]=useState(false),[safe,setSafe]=useState<RepresentationResult|null>(null),[selected,setSelected]=useState<RepresentationSlug>('lgbtq_characters'),[level,setLevel]=useState(2),[checked,setChecked]=useState<RepresentationResult|null>(null),[own,setOwn]=useState<OwnRepresentationResult|null>(null),[spoiler,setSpoiler]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);

 const alive=useRef(true);const revealVersion=useRef(0);const attempt=useRef<{body:string;key:string}|null>(null);

 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);

 const endpoint=`/api/v1/movies/${movieId}/representation`;

 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');setFailed(false);try{await action();}catch(e){if(alive.current){setFailed(true);setMessage(e instanceof Error?e.message:'Request failed.');}}finally{if(alive.current)setBusy(false);}}

 async function loadSafe(){const data=await request<RepresentationResult>(endpoint);if(alive.current)setSafe(data);}

 async function write(remove:boolean){if(!watched||!own)return;const body={slug:selected,expectedRevision:own.representation?.revision??0,watched:true,...(!remove?{spoilerLevel:spoiler}:{})};const encoded=JSON.stringify({remove,body});if(attempt.current?.body!==encoded)attempt.current={body:encoded,key:crypto.randomUUID()};const result=await request<OwnRepresentationResult>(endpoint,remove?'DELETE':'PATCH',body,attempt.current.key);if(alive.current){setOwn(result);setChecked(null);attempt.current=null;setMessage(remove?'Your detail removed.':'Your informational detail saved.');await loadSafe();onChanged?.();}}

 function items(data:RepresentationResult){return data.representation.length?<ul>{data.representation.map(i=><li key={i.slug}>{REPRESENTATION_LABELS[i.slug]} · {i.count} {i.count===1?'report':'reports'}{i.provisional?' · Provisional':''}</li>)}</ul>:<p className="fine">No information available at this reveal level. Absence is not confirmed.</p>;}

 return <details className="mvp-product-details" onToggle={e=>{const value=e.currentTarget.open;setOpen(value);if(value&&!safe)void run(loadSafe);if(!value){revealVersion.current++;setChecked(null);setOwn(null);}}}><summary>Representation &amp; themes</summary><p className="fine">Informational representation, separate from warning intensity and family opinion.</p>{open&&safe?items(safe):null}{open?<><form className="mvp-compact-form" onSubmit={e=>{e.preventDefault();const version=++revealVersion.current;void run(async()=>{const data=await request<RepresentationResult>(endpoint,'POST',{slug:selected,level});if(alive.current&&version===revealVersion.current)setChecked(data);});}}><label>Detail to check<select value={selected} onChange={e=>{revealVersion.current++;setSelected(e.target.value as RepresentationSlug);setChecked(null);}}>{Object.entries(REPRESENTATION_LABELS).map(([s,label])=><option key={s} value={s}>{label}</option>)}</select></label><label>Reveal level<select value={level} onChange={e=>{revealVersion.current++;setLevel(Number(e.target.value));setChecked(null);}}><option value={1}>Descriptions only</option><option value={2}>Selected detail including category spoilers</option></select></label><button className="mvp-secondary" disabled={busy}>Check selected detail</button></form>{checked?items(checked):null}{!readOnly&&signedIn&&watched?<details onToggle={e=>{if(e.currentTarget.open&&!own)void run(async()=>{const data=await request<OwnRepresentationResult>(`${endpoint}/own`);if(alive.current)setOwn(data);});}}><summary>Your informational details</summary>{own?<><p className="fine">{own.representation?.details.map(d=>`${REPRESENTATION_LABELS[d.slug]} (protection ${d.spoilerLevel})`).join(' · ')||'No saved details.'}</p><label>Spoiler protection<select value={spoiler} onChange={e=>setSpoiler(Number(e.target.value))}><option value={0}>No spoiler</option><option value={1}>Hide descriptions</option><option value={2}>Hide category and descriptions</option></select></label><button type="button" className="mvp-secondary" disabled={busy||!watched} onClick={()=>void run(()=>write(false))}>Save selected detail</button><button type="button" className="mvp-secondary" disabled={busy||!watched||!own.representation?.details.some(d=>d.slug===selected)} onClick={()=>void run(()=>write(true))}>Remove my selected detail</button><button type="button" hidden={!failed} className="mvp-secondary" disabled={busy} onClick={()=>void run(async()=>{const data=await request<OwnRepresentationResult>(`${endpoint}/own`);if(alive.current){setOwn(data);attempt.current=null;}})}>Retry loading details</button></>:null}</details>:!readOnly&&!signedIn?<p className="fine">Sign in to add informational details.</p>:null}</>:null}{busy?<p role="status">Loading…</p>:null}{message?<p role="status">{message}</p>:null}</details>;

}

export function FamilySummaryCheck(props:Props){const {session}=useAuthSession();return <FamilyCheck key={`${props.movieId}:${session?.user?.id??'anonymous'}:${props.refreshKey??0}`} movieId={props.movieId}/>;}

function FamilyCheck({movieId}:{movieId:string}) {

 const [data,setData]=useState<FamilySummaryResult|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');

 const alive=useRef(true);

 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);

 async function check(){setBusy(true);setMessage('');try{const result=await request<FamilySummaryResult>(`/api/v1/movies/${movieId}/family-summary`,'POST',{check:true});if(alive.current)setData(result);}catch(e){if(alive.current)setMessage(e instanceof Error?e.message:'Could not check opinion.');}finally{if(alive.current)setBusy(false);}}

 return <div className="mvp-family-summary"><button type="button" className="mvp-secondary" disabled={busy} onClick={()=>{if(data){setData(null);setMessage('');}else void check();}}>{busy?'Checking…':data?'Hide family opinion':'Check family opinion'}</button>{!data ? <p className="fine">⚪ Not yet rated / not shown</p> : null}{data?<>

 <p>{familyAwkwardness(data.familySummary.value) ? <><span aria-hidden="true">{familyAwkwardness(data.familySummary.value)?.emoji} </span>{familyAwkwardness(data.familySummary.value)?.verdict} <span className="fine">{familyAwkwardness(data.familySummary.value)?.description}</span></> : '⚪ Not yet rated'}</p>

 <p className="fine">Subjective viewer opinions, not a suitability guarantee.</p>

 {data.familySummary.count>0?<details><summary>{data.familySummary.count} {data.familySummary.count===1?'vote':'votes'}{data.familySummary.provisional?' · Early result':''}</summary><ul>{data.familySummary.distribution.map((n,i)=><li key={i}>{i+1}/5 · {n} votes</li>)}</ul></details>:null}

 </>:null}{message?<p role="status">{message}</p>:null}</div>;

}

