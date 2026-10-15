import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=p=>loadTypeScript(fileURLToPath(new URL('../../'+p,import.meta.url)));
test('public family GET reads only independent family opinions and needs no sign-in',async()=>{
 const db=load('src/lib/movie-api.ts'),{GET}=load('src/app/api/v1/movies/[id]/family-summary/route.ts');
 const previous=db.publicDatabase;const calls=[];
 const summary={familySummary:{value:null,count:0,distribution:[0,0,0,0,0],provisional:false}};
 db.publicDatabase=()=>({rpc:async(name,args)=>{calls.push([name,args]);return{data:summary,error:null};}});
 const id='dcd83222-0705-49f8-9b7a-7f9ecc80f120',context={params:Promise.resolve({id})};
 try{
  const result=await GET(new Request('https://triggerboxd.com/api/v1/movies/'+id+'/family-summary/'),context);
  assert.equal(result.status,200);assert.deepEqual((await result.json()).data,summary);
  assert.deepEqual(calls,[['get_family_summary',{p_movie_id:id}]]);
  assert.equal((await GET(new Request('https://triggerboxd.com/?severity=5'),context)).status,400);
  assert.equal((await GET(new Request('https://triggerboxd.com/'),{params:Promise.resolve({id:'bad'})})).status,404);
  assert.equal(calls.length,1);
 }finally{db.publicDatabase=previous;}
});
