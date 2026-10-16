import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=p=>loadTypeScript(fileURLToPath(new URL('../../'+p,import.meta.url)));
const id='aa100000-0000-4000-8000-000000000001';
test('worker endpoint authenticates before database access and rejects raw subtitle payloads',async()=>{
 const db=load('src/lib/movie-api.ts'),{POST}=load('src/app/api/internal/subtitle-jobs/route.ts');
 const previous=db.serviceDatabase,oldToken=process.env.TRIGGERBOXD_PIPELINE_TOKEN;process.env.TRIGGERBOXD_PIPELINE_TOKEN='s'.repeat(48);const calls=[];
 db.serviceDatabase=()=>({rpc:async(name,args)=>{calls.push([name,args]);return{data:null,error:null};}});
 const request=(body,token='s'.repeat(48))=>new Request('https://triggerboxd.com/api/internal/subtitle-jobs/',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 try {
  assert.equal((await POST(request({action:'claim'},'bad'))).status,403);assert.equal(calls.length,0);
  assert.equal((await POST(request({action:'claim'}))).status,200);assert.deepEqual(calls,[['claim_subtitle_job',undefined]]);calls.length=0;
  const result={rating:3,verdict:'x',factors:{mildProfanityCues:1,strongProfanityCues:8,slurCues:0,sexualContentCues:0,sexualViolenceReferenceCues:0},rulesVersion:'v1',scorerVersion:'v1',subtitleLanguage:'EN',subtitleHash:'a'.repeat(64),cueCount:100};
  assert.equal((await POST(request({action:'complete',id,leaseToken:id,result:{...result,subtitleText:'private'}}))).status,400);assert.equal(calls.length,0);
  assert.equal((await POST(request({action:'complete',id,leaseToken:id,result}))).status,200);
  assert.equal(calls[0][0],'finish_subtitle_job');assert.equal(calls[0][1].p_result.verdict,'Suddenly, WhatsApp looks interesting.');
  calls.length=0;assert.equal((await POST(request({action:'fail',id,leaseToken:id,reason:'secret error https://key'}))).status,400);assert.equal(calls.length,0);
 }finally {db.serviceDatabase=previous;if(oldToken===undefined)delete process.env.TRIGGERBOXD_PIPELINE_TOKEN;else process.env.TRIGGERBOXD_PIPELINE_TOKEN=oldToken;}
});
test('admin analysis requires CSRF and active account; latest revision is forwarded to owner-checked RPC',async()=>{
 const server=load('src/lib/supabase/server.ts'),auth=load('src/lib/auth.ts'),{POST,GET}=load('src/app/api/v1/admin/subtitle-jobs/route.ts');
 const old=[server.createRequestClient,auth.requireActiveUser];const calls=[];let authenticated=true;
 server.createRequestClient=()=>({client:{rpc:async(name,args)=>{calls.push([name,args]);return{data:{jobs:[],movies:[]},error:null};}},applyCookies:r=>r});
 auth.requireActiveUser=async()=>{if(!authenticated)throw new Error('AUTH_REQUIRED');return{id:'owner'};};
 const token='a'.repeat(48),body={action:'approve',id,expectedRevision:3,rating:3,watched:true};
 const request=(payload,csrf=token)=>new Request('https://triggerboxd.com/api/v1/admin/subtitle-jobs/',{method:'POST',headers:{origin:'https://triggerboxd.com','content-type':'application/json',cookie:`tb-csrf=${token}`,'x-csrf-token':csrf},body:JSON.stringify(payload)});
 try {
  assert.equal((await POST(request(body,'wrong'))).status,403);assert.equal(calls.length,0);
  authenticated=false;assert.equal((await POST(request(body))).status,401);assert.equal(calls.length,0);authenticated=true;
  assert.equal((await POST(request({...body,actor:'other'}))).status,400);assert.equal(calls.length,0);
  assert.equal((await POST(request(body))).status,200);
  assert.deepEqual(calls,[['admin_subtitle_action',{p_action:'approve',p_id:id,p_expected_revision:3,p_note:null,p_rating:3,p_watched:true}]]);
  calls.length=0;assert.equal((await GET(new Request('https://triggerboxd.com/?q='+ 'x'.repeat(101)))).status,400);assert.equal(calls.length,0);
 }finally{[server.createRequestClient,auth.requireActiveUser]=old;}
});
test('public estimate reads only approved public projection and never queues work',async()=>{
 const db=load('src/lib/movie-api.ts'),{GET}=load('src/app/api/v1/movies/[id]/subtitle-estimate/route.ts');
 const old=db.publicDatabase,calls=[];
 db.publicDatabase=()=>({rpc:async(name,args)=>{calls.push([name,args]);return{data:null,error:null};}});
 try{const response=await GET(new Request('https://triggerboxd.com/'),{params:Promise.resolve({id})});assert.equal(response.status,200);assert.equal((await response.json()).data,null);assert.deepEqual(calls,[['get_subtitle_estimate',{p_movie_id:id}]]);}finally{db.publicDatabase=old;}
});
