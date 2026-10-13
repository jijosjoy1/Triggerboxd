import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=path=>loadTypeScript(fileURLToPath(new URL('../../'+path,import.meta.url)));
const auth=load('src/lib/auth.ts');
const server=load('src/lib/supabase/server.ts');
const api=load('src/lib/movie-api.ts');
const security=load('src/lib/request-security.ts');
const route=load('src/app/api/v1/movies/import/route.ts');
const token='a'.repeat(48);
function request(body={tmdbId:575351},origin='https://triggerboxd.com'){
 return new Request('https://triggerboxd.com/api/v1/movies/import',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:`tb-csrf=${token}`,'X-CSRF-Token':token,'Idempotency-Key':'import-test-key'},body:JSON.stringify(body)});
}
test('public import checks quota before authoritative metadata, keeps auth path gated and rejects spoofed bodies',async()=>{
 const saved={active:auth.requireActiveUser,context:server.createRequestClient,db:api.serviceDatabase,tmdb:api.tmdbGateway,subject:api.searchSubject,origin:process.env.APP_ORIGIN};
 process.env.APP_ORIGIN='https://triggerboxd.com';
 let calls=[];let quotaError=null;let authMode='anonymous';
 try{
  server.createRequestClient=()=>({client:{},applyCookies:r=>r});
  auth.requireActiveUser=async()=>{if(authMode==='anonymous')throw new security.AuthError(401,'AUTH_REQUIRED');if(authMode==='suspended')throw new security.AuthError(403,'ACCOUNT_SUSPENDED');return {id:'verified-user'};};
  api.searchSubject=async()=> 'b'.repeat(64);
  api.serviceDatabase=()=>({rpc:async(name,args)=>{calls.push([name,args]);return name==='consume_public_import_quota'?{error:quotaError}:{data:{id:'dcd83222-0705-49f8-9b7a-7f9ecc80f120',tmdbId:575351,created:true},error:null};}});
  api.tmdbGateway=()=>({getMovieDetails:async id=>{calls.push(['tmdb',id]);return {tmdbId:id,title:'Authoritative',originalTitle:'Authoritative',releaseDate:null,language:'ml',productionCountries:['IN'],posterPath:null,overview:null};}});
  let response=await route.POST(request());assert.equal(response.status,201);
  assert.deepEqual(calls.map(c=>c[0]),['consume_public_import_quota','tmdb','import_public_movie']);
  assert.equal(calls[2][1].p_metadata.title,'Authoritative');assert.equal('p_actor_id' in calls[2][1],false);
  calls=[];quotaError={message:'RATE_LIMITED'};response=await route.POST(request());assert.equal(response.status,429);assert.deepEqual(calls.map(c=>c[0]),['consume_public_import_quota']);
  calls=[];quotaError=null;response=await route.POST(request({tmdbId:575351,metadata:{title:'Spoofed'}}));assert.equal(response.status,400);assert.equal(calls.length,0);
  response=await route.POST(request(undefined,'https://evil.example'));assert.equal(response.status,403);assert.equal(calls.length,0);
  authMode='suspended';response=await route.POST(request());assert.equal(response.status,403);assert.equal(calls.length,0);
  authMode='active';response=await route.POST(request());assert.equal(response.status,201);assert.deepEqual(calls.map(c=>c[0]),['tmdb','import_movie']);assert.equal(calls[1][1].p_actor_id,'verified-user');
 }finally{auth.requireActiveUser=saved.active;server.createRequestClient=saved.context;api.serviceDatabase=saved.db;api.tmdbGateway=saved.tmdb;api.searchSubject=saved.subject;if(saved.origin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=saved.origin;}
});
