'use client';
import { useEffect, useState } from 'react';
import { ESTIMATE_VERDICTS } from '../lib/subtitle-estimates';
type Estimate={rating:number;subtitleLanguage:string;reviewedAt:string};
export function MovieSubtitleEstimate({movieId}:{movieId:string}) {
  const [view,setView]=useState<{id:string;estimate:Estimate}|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    // Optional lookup: never holds up the movie or community guide.
    void fetch(`/api/v1/movies/${movieId}/subtitle-estimate/`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{if(!response.ok)return;const result=await response.json();if(!controller.signal.aborted&&result.data&&Number.isInteger(result.data.rating)&&result.data.rating>=1&&result.data.rating<=5)setView({id:movieId,estimate:result.data});})
      .catch(()=>{});
    return()=>controller.abort();
  },[movieId]);
  if(view?.id!==movieId)return null;
  const estimate=view.estimate;
  return <aside className="subtitle-estimate" aria-label="Triggerboxd Thinks: family awkwardness estimate">
    <div className="subtitle-estimate-title"><h3>Triggerboxd Thinks</h3><strong>{estimate.rating}/5</strong></div>
    <p>{estimate.rating===1?'Low dialogue awkwardness detected.':ESTIMATE_VERDICTS[estimate.rating]}</p>
    <details><summary>About this estimate <span aria-hidden="true">ⓘ</span></summary><p className="fine">Experimental estimate from {estimate.subtitleLanguage==='EN'?'English':estimate.subtitleLanguage} subtitles, checked and approved by a moderator who confirmed watching the film. It considers dialogue; visual content such as nudity, intimate scenes and gore is unassessed by the script. Community votes are independent. A low score is not a suitability guarantee.</p></details>
  </aside>;
}
