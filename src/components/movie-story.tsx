'use client';
import { useEffect, useRef, useState } from 'react';
import { drawStoryCard, storyLevel, storyReaction, storyCaption } from '../lib/story-card';
import type { FamilySummaryResult } from '../lib/representation-contracts';
import type {CategoryRating} from '../lib/contracts';
import { refreshAuthSession, useAuthSession } from '../lib/supabase/browser';
import {loadStoryImage,storyImageUrl,storyAccent} from '../lib/story-assets';
import {loadDefaultStoryRating} from '../lib/story-default';
import {isUuid} from '../lib/validation';

export function MovieStory({movieId,title,posterPath,backdropPath,year,genres,warning,ownFamilyValue,defaultOpen=false}:{movieId:string;title:string;posterPath?:string|null;backdropPath?:string|null;year?:number|null;genres?:string[];warning?:CategoryRating;ownFamilyValue?:number|null;defaultOpen?:boolean}) {
  const canvas=useRef<HTMLCanvasElement>(null),generation=useRef(0),imageVersion=useRef(0);
  const [open,setOpen]=useState(defaultOpen),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const {session,loading:authLoading,error:authError}=useAuthSession();
  const [defaultLoaded,setDefaultLoaded]=useState(false);
  const [initialLoading,setInitialLoading]=useState(defaultOpen);
  const [community,setCommunity]=useState<FamilySummaryResult['familySummary']|null>(null);
  const [own,setOwn]=useState<number|null>(ownFamilyValue??null);
  const [source,setSource]=useState<'personal'|'community'>(ownFamilyValue?'personal':'community');
  const [renderRevision,setRenderRevision]=useState(0);
  const [compactTitle,setCompactTitle]=useState(false);
  const [artMode,setArtMode]=useState<'poster'|'backdrop'>('poster');
  const [file,setFile]=useState<File|null>(null);
  const personal=source==='personal';
  const summary=personal?(own?{value:own,count:1,distribution:[],provisional:false}:null):community;
  const level=storyLevel(summary,personal);
  const link=isUuid(movieId)?`https://triggerboxd.com/movies/${movieId}/`:'';
  useEffect(()=>{generation.current++;imageVersion.current++;setOpen(defaultOpen);setInitialLoading(defaultOpen);setDefaultLoaded(false);setCommunity(null);setOwn(ownFamilyValue??null);setSource(ownFamilyValue?'personal':'community');setArtMode('poster');setCompactTitle(false);setBusy(false);setFile(null);setMessage('');return()=>{generation.current++;imageVersion.current++;};},[movieId,title,session?.user?.id]);
  useEffect(()=>{setOwn(ownFamilyValue??null);},[ownFamilyValue]);
  useEffect(()=>{
    if(!open||authLoading)return;
    if(authError||!session){setMessage(authError??'Could not check sign-in.');setInitialLoading(false);return;}
    const version=++generation.current;imageVersion.current++;setFile(null);setInitialLoading(true);
    if(ownFamilyValue && ownFamilyValue>=1 && ownFamilyValue<=5){setOwn(ownFamilyValue);setSource('personal');setDefaultLoaded(true);setInitialLoading(false);return;}
    void loadDefaultStoryRating(movieId,session).then(result=>{
      if(version===generation.current){setOwn(result.own);setCommunity(result.community);setSource(result.source);setDefaultLoaded(true);}
    }).catch(e=>{if(version===generation.current)setMessage(e instanceof Error?e.message:'Could not load ratings.');})
      .finally(()=>{if(version===generation.current)setInitialLoading(false);});
    return()=>{generation.current++;};
  },[open,authLoading,authError,session?.user?.id,movieId]);
  useEffect(()=>{
    if(!open || initialLoading || !canvas.current)return;
    const version=++imageVersion.current;setFile(null);
    const target=canvas.current;
    async function prepare(){
      try{
        const selectedPath=artMode==='backdrop'?backdropPath:posterPath;
        const primary=storyImageUrl(selectedPath,artMode==='backdrop');
        const fallback=storyImageUrl(artMode==='backdrop'?posterPath:backdropPath,artMode!=='backdrop');
        const [primaryArt,reaction]=await Promise.all([loadStoryImage(primary),loadStoryImage(storyReaction(level)?.asset??null),document.fonts.ready]);
        const artwork=primaryArt??await loadStoryImage(fallback);
        if(version!==imageVersion.current)return;
        drawStoryCard(target,title,summary,movieId,warning,personal,artwork,{year,genres,reaction,accent:storyAccent(artwork),compactTitle,backdrop:primaryArt?artMode==='backdrop':artMode!=='backdrop'});
        if(!artwork && (primary||fallback))setMessage('Artwork unavailable. Your card can still be shared.');
        else if(level!==null&&!reaction)setMessage('Family illustration unavailable. Your rating can still be shared.');
        target.toBlob(blob=>{if(version===imageVersion.current){if(blob)setFile(new File([blob],`triggerboxd-${movieId}-story.png`,{type:'image/png'}));else setMessage('Image unavailable. Copy the movie link instead.');}},'image/png');
      }catch(e){if(version===imageVersion.current)setMessage(e instanceof Error?e.message:'Image unavailable.');}
    }
    void prepare();return()=>{imageVersion.current++;};
  },[open,title,posterPath,backdropPath,year,genres,artMode,compactTitle,source,community,own,movieId,warning,renderRevision,initialLoading]);
  async function selectRating(next:'personal'|'community'){
    const version=++generation.current;imageVersion.current++;setFile(null);setSource(next);setBusy(true);setMessage('');setRenderRevision(value=>value+1);
    try{
      if(next==='personal' && ownFamilyValue){setOwn(ownFamilyValue);return;}
      const auth=await refreshAuthSession();
      if(next==='personal'&&!auth.user)throw new Error('Sign in to use your saved family rating.');
      const response=next==='personal'?await fetch(`/api/v1/movies/${movieId}/family-vote`,{cache:'no-store'}):await fetch(`/api/v1/movies/${movieId}/family-summary`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken},body:JSON.stringify({check:true})});
      const result=await response.json();if(!response.ok)throw new Error(result?.error?.message??'Could not load ratings.');
      if(version===generation.current){if(next==='personal')setOwn(result.data.familyVote?.value??null);else setCommunity(result.data.familySummary);}
    }catch(e){if(version===generation.current)setMessage(e instanceof Error?e.message:'Could not load ratings.');}
    finally{if(version===generation.current)setBusy(false);}
  }
  function download(){
    if(!file)return;
    const url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    setMessage('PNG saved. In Instagram, create a Story and choose this image.');
  }
  async function share(){
    if(!file || busy || initialLoading)return;
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
  return <section className="mvp-story">{!defaultOpen?<button type="button" className="mvp-secondary" aria-expanded={open} onClick={()=>{generation.current++;imageVersion.current++;setBusy(false);setFile(null);setMessage('');setOpen(!open);}}>{warning?'Share my warning as a Story':'Share Story card'}</button>:null}{open?<div className="mvp-story-panel">
    <p className="fine">{warning?'Your saved warning, with spoiler protection preserved.':'A cinematic family movie report. Choose whose rating to share.'}</p>
    <canvas ref={canvas} className="mvp-story-preview" role="img" aria-label={`${title}. ${personal?'My':'Community'} awkwardness report. ${level??'Unknown'} of 5. ${storyCaption(summary,personal)} ${warning?'Includes my saved warning.':''}`}/>
    {defaultLoaded&&!initialLoading&&source==='community'&&!own?<p className="fine">No personal family-awkwardness vote is saved. Content warnings are separate; this card uses the available community family opinion.</p>:null}
    <div className="story-rating-source" role="group" aria-label="Rating source"><button type="button" className="mvp-secondary" aria-pressed={personal} disabled={busy||initialLoading} onClick={()=>void selectRating('personal')}>My rating</button><button type="button" className="mvp-secondary" aria-pressed={!personal} disabled={busy||initialLoading} onClick={()=>void selectRating('community')}>Community rating</button></div>
    {posterPath&&backdropPath?<label className="story-art-choice">Artwork<select value={artMode} onChange={e=>{imageVersion.current++;setFile(null);setMessage('');setArtMode(e.target.value as 'poster'|'backdrop');}}><option value="poster">Movie poster</option><option value="backdrop">Movie backdrop</option></select></label>:null}
    <label className="story-title-choice"><input type="checkbox" checked={compactTitle} onChange={e=>{imageVersion.current++;setFile(null);setCompactTitle(e.target.checked);}}/>Artwork already includes the title · use a compact heading</label>
    {!file?<p className="fine" role="status">{initialLoading?'Loading your saved rating…':'Preparing your card…'}</p>:null}
    <button type="button" className="button" disabled={busy||initialLoading||!file} onClick={()=>void share()}>Share Story card</button>
    <button type="button" className="mvp-secondary" disabled={busy||initialLoading||!file} onClick={download}>Save PNG</button>
    <p className="fine">Choose Instagram in your phone’s share menu. If it isn’t listed, save the PNG and add it to your Story.</p>
    <button type="button" className="mvp-secondary" onClick={()=>void copy()}>Copy movie link for Story sticker</button>
    <label className="story-link">Movie link<input type="text" readOnly value={link} onFocus={e=>e.currentTarget.select()}/></label>
    <a className="text-link" href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">Open Instagram ↗</a>
    <p className="fine">The image shows our domain. Add the copied movie link as an Instagram Link sticker to make it tappable.</p>
    {message?<p role="status">{message}</p>:null}
  </div>:null}</section>;
}
