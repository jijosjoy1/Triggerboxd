import type {FamilySummaryResult} from './representation-contracts';
type Auth={user:{id:string}|null;csrfToken:string};
export async function loadDefaultStoryRating(movieId:string,auth:Auth,fetcher:typeof fetch=fetch){
  async function read(response:Response){const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Could not load your saved rating.');return body.data;}
  if(auth.user){
    const own=await read(await fetcher(`/api/v1/movies/${movieId}/family-vote`,{cache:'no-store'}));
    const value=own.familyVote?.value;
    if(Number.isInteger(value)&&value>=1&&value<=5)return {source:'personal' as const,own:value as number,community:null};
  }
  const community=await read(await fetcher(`/api/v1/movies/${movieId}/family-summary`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken},body:JSON.stringify({check:true})}));
  return {source:'community' as const,own:null,community:community.familySummary as FamilySummaryResult['familySummary']};
}
