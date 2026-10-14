'use client';
import { useEffect, useRef, useState } from 'react';
import { drawStoryCard } from '../lib/story-card';
import type { FamilySummaryResult } from '../lib/representation-contracts';
import type {CategoryRating} from '../lib/contracts';
import { refreshAuthSession } from '../lib/supabase/browser';
import {filmPoster} from '../lib/film-list';
import {isUuid} from '../lib/validation';

export function MovieStory({movieId,title,posterPath,warning,ownFamilyValue}:{movieId:string;title:string;posterPath?:string|null;warning?:CategoryRating;ownFamilyValue?:number|null}) {
  const canvas=useRef<HTMLCanvasElement>(null),generation=useRef(0),imageVersion=useRef(0);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [summary,setSummary]=useState<FamilySummaryResult['familySummary']|null>(null),[personal,setPersonal]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const link=isUuid(movieId)?`https://triggerboxd.com/movies/${movieId}/`:'';
  useEffect(()=>{generation.current++;setOpen(false);setSummary(null);setPersonal(false);setBusy(false);setFile(null);setMessage('');return()=>{generation.current++;imageVersion.current++;};},[movieId,title]);
  useEffect(()=>{
    if(warning && ownFamilyValue && ownFamilyValue>=1 && ownFamilyValue<=5){setSummary({value:ownFamilyValue,count:1,distribution:[],provisional:false});setPersonal(true);}
  },[warning,ownFamilyValue]);
  useEffect(()=>{
    if(!open || !canvas.current)return;
    const version=++imageVersion.current;setFile(null);
    const target=canvas.current;
    let image:HTMLImageElement|null=null;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const render=(poster:HTMLImageElement|null)=>{
      if(version!==imageVersion.current)return;
      if(timer)clearTimeout(timer);
      if(image){image.onload=null;image.onerror=null;}
      try{
        drawStoryCard(target,title,summary,movieId,warning,personal,poster);
        target.toBlob(blob=>{if(version===imageVersion.current){if(blob)setFile(new File([blob],`triggerboxd-${movieId}-story.png`,{type:'image/png'}));else setMessage('Image unavailable. Copy the movie link instead.');}},'image/png');
      }catch(e){setMessage(e instanceof Error?e.message:'Image unavailable.');}
    };
    const url=filmPoster(posterPath??null,'w500');
    if(url){
      image=new Image();image.crossOrigin='anonymous';
      image.onload=()=>render(image);
      image.onerror=()=>{if(version===imageVersion.current)setMessage('Poster unavailable. Your card can still be shared.');render(null);};
      timer=setTimeout(()=>{if(version===imageVersion.current)setMessage('Poster took too long to load. Your card can still be shared.');render(null);},8000);
      image.src=url;
    }else render(null);
    return()=>{imageVersion.current++;if(timer)clearTimeout(timer);if(image){image.onload=null;image.onerror=null;}};
  },[open,title,posterPath,summary,movieId,warning,personal]);
  async function check(){
    const version=generation.current;setBusy(true);setMessage('');
    try{
      const auth=await refreshAuthSession();const response=await fetch(`/api/v1/movies/${movieId}/family-summary`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken},body:JSON.stringify({check:true})});
      const result=await response.json();if(!response.ok)throw new Error(result?.error?.message??'Could not check family votes.');
      if(version===generation.current){setSummary(result.data.familySummary);setPersonal(false);}
    }catch(e){if(version===generation.current)setMessage(e instanceof Error?e.message:'Could not check votes.');}
    finally{if(version===generation.current)setBusy(false);}
  }
  function download(){
    if(!file)return;
    const url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    setMessage('PNG saved. In Instagram, create a Story and choose this image.');
  }
  async function share(){
    if(!file || busy)return;
    const version=generation.current;
    if(!navigator.share || !navigator.canShare?.({files:[file]})){download();setMessage('This browser cannot share image files directly. Save the PNG, then choose it in Instagram Stories.');return;}
    setBusy(true);setMessage('');
    try{
      // The PNG is prepared before the tap, preserving browser user activation.
      await navigator.share({files:[file],title:`${title} — Triggerboxd`,text:`Find detailed trigger warnings: ${link}`});
      if(version===generation.current)setMessage('Card sent to the share menu. Finish your Story in Instagram.');
    }catch(e){if(version===generation.current)setMessage(e instanceof Error&&e.name==='AbortError'?'Sharing cancelled.': 'Sharing failed. Save the PNG and upload it to your Story.');}
    finally{if(version===generation.current)setBusy(false);}
  }
  async function copy(){try{await navigator.clipboard.writeText(link);setMessage('Movie link copied. Paste it into an Instagram Link sticker.');}catch{setMessage('Copy the movie link from the field below for your Link sticker.');}}
  return <section className="mvp-story"><button type="button" className="mvp-secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>{warning?'Share my warning as a Story':'Make an awkwardness Story card'}</button>{open?<div className="mvp-story-panel">
    <p className="fine">{warning?'Your saved warning, with spoiler protection preserved.':'A community awkwardness report with an original ink illustration.'}</p>
    <canvas ref={canvas} className="mvp-story-preview" role="img" aria-label={`${title}. ${personal?'My':'Community'} awkwardness report. ${summary?.value??'Unknown'} of 5. ${warning?'Includes my saved warning.':''}`}/>
    <button type="button" className="mvp-secondary" disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Use community awkwardness votes'}</button>
    <button type="button" className="button" disabled={busy||!file} onClick={()=>void share()}>Share Story card</button>
    <button type="button" className="mvp-secondary" disabled={busy||!file} onClick={download}>Save PNG</button>
    <p className="fine">Choose Instagram in your phone’s share menu. If it isn’t listed, save the PNG and add it to your Story.</p>
    <button type="button" className="mvp-secondary" onClick={()=>void copy()}>Copy movie link for Story sticker</button>
    <label className="story-link">Movie link<input type="text" readOnly value={link} onFocus={e=>e.currentTarget.select()}/></label>
    <a className="text-link" href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">Open Instagram ↗</a>
    <p className="fine">The printed URL is part of the image. Add a Link sticker in Instagram to make it tappable.</p>
    {message?<p role="status">{message}</p>:null}
  </div>:null}</section>;
}
