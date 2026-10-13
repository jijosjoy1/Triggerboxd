import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const root='src/app/api/v1/movies/[id]';const id='dcd83222-0705-49f8-9b7a-7f9ecc80f120';
const context={params:Promise.resolve({id})};
test('all scene mutations including explicit reveal reject cross-origin and missing CSRF before provider calls',async()=>{
 process.env.APP_ORIGIN='https://triggerboxd.com';
 for(const [route,method] of [['scenes','POST'],['scenes','PUT'],['scenes','DELETE'],['reports','POST']]){
  const handler=loadTypeScript(`${root}/${route}/route.ts`)[method];
  for(const origin of ['https://attacker.invalid','https://triggerboxd.com']){
   const response=await handler(new Request(`https://triggerboxd.com/api/v1/movies/${id}/${route}`,{method,headers:{origin,'content-type':'application/json'},body:'{}'}),context);
   assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
 }
});
test('scene list fixes spoiler level zero and selective reveal passes only selected category',async()=>{
 const api=loadTypeScript('src/lib/movie-api.ts');const original=api.publicDatabase;const calls=[];
 api.publicDatabase=()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{notes:[],nextOffset:null},error:null};}});
 try{
  const handlers=loadTypeScript(`${root}/scenes/route.ts`);
  let response=await handlers.GET(new Request(`https://triggerboxd.com/api/v1/movies/${id}/scenes/?category=nudity`),context);
  assert.equal(response.status,200);assert.equal(calls[0].args.p_level,0);assert.deepEqual(calls[0].args.p_categories,['nudity']);
  const token='a'.repeat(48);
  response=await handlers.POST(new Request(`https://triggerboxd.com/api/v1/movies/${id}/scenes/`,{method:'POST',headers:{origin:'https://triggerboxd.com','content-type':'application/json',cookie:`tb-csrf=${token}`,'x-csrf-token':token},body:JSON.stringify({categories:['animal_harm'],level:2,offset:0})}),context);
  assert.equal(response.status,200);assert.deepEqual(calls[1].args.p_categories,['animal_harm']);assert.equal(calls[1].args.p_level,2);
  response=await handlers.GET(new Request(`https://triggerboxd.com/api/v1/movies/${id}/scenes/?level=2`),context);
  assert.equal(response.status,400);assert.equal(calls.length,2);
 }finally{api.publicDatabase=original;}
});
test('note mutations validate active account and pass revisions/idempotency while preserving refreshed cookies on errors',async()=>{
 const api=loadTypeScript('src/lib/movie-api.ts');const server=loadTypeScript('src/lib/supabase/server.ts');const auth=loadTypeScript('src/lib/auth.ts');
 const old=[api.publicDatabase,server.createRequestClient,auth.requireActiveUser];const calls=[];let checks=0;
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:null,error:{message:'REVISION_CONFLICT'}};}};
 api.publicDatabase=()=>client;
 server.createRequestClient=()=>({client,applyCookies:response=>{response.headers.set('x-test-cookie-refresh','yes');return response;}});
 auth.requireActiveUser=async()=>{checks++;};
 try{
  const handler=loadTypeScript(`${root}/scenes/route.ts`).PUT;const token='a'.repeat(48);
  const response=await handler(new Request(`https://triggerboxd.com/api/v1/movies/${id}/scenes/`,{method:'PUT',headers:{origin:'https://triggerboxd.com','content-type':'application/json',cookie:`tb-csrf=${token}`,'x-csrf-token':token,'idempotency-key':'stable_retry_key'},body:JSON.stringify({noteId:id,expectedRevision:4,watched:true,category:'nudity',comment:'A brief scene.',startSeconds:null,endSeconds:null,version:null,spoilerLevel:1,severity:0})}),context);
  assert.equal(checks,1);assert.equal(response.status,409);assert.equal(response.headers.get('x-test-cookie-refresh'),'yes');
  assert.equal(calls[0].name,'put_movie_note');assert.equal(calls[0].args.p_expected_revision,4);assert.equal(calls[0].args.p_idempotency_key,'stable_retry_key');assert.equal(calls[0].args.p_severity,0);
 }finally{[api.publicDatabase,server.createRequestClient,auth.requireActiveUser]=old;}
});
test('own raw notes require active account and never fall back to public list',async()=>{
 const api=loadTypeScript('src/lib/movie-api.ts');const server=loadTypeScript('src/lib/supabase/server.ts');const auth=loadTypeScript('src/lib/auth.ts');
 const old=[api.publicDatabase,server.createRequestClient,auth.requireActiveUser];let rpc=false;
 const client={rpc:async()=>{rpc=true;return {data:{notes:[]},error:null};}};
 api.publicDatabase=()=>client;server.createRequestClient=()=>({client,applyCookies:r=>r});auth.requireActiveUser=async()=>{throw new Error('AUTH_REQUIRED');};
 try{const response=await loadTypeScript(`${root}/scenes/own/route.ts`).GET(new Request(`https://triggerboxd.com/api/v1/movies/${id}/scenes/own/`),context);assert.equal(response.status,401);assert.equal(rpc,false);assert.equal(response.headers.get('cache-control'),'private, no-store');}
 finally{[api.publicDatabase,server.createRequestClient,auth.requireActiveUser]=old;}
});
