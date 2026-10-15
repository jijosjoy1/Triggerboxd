import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from './load-typescript.mjs';
const load=p=>loadTypeScript(fileURLToPath(new URL('../../'+p,import.meta.url)));
test('Google callback asks for an unchosen nickname and preserves the film return path',async()=>{
 const server=load('src/lib/supabase/server.ts'),{GET}=load('src/app/auth/callback/route.ts');
 const old=[server.createRequestClient,server.authConfiguration];let chosen=false;let fail=false;
 server.authConfiguration=()=>({passwordEnabled:true});
 server.createRequestClient=()=>({client:{auth:{exchangeCodeForSession:async()=>({error:null})},rpc:async name=>{assert.equal(name,'get_my_account_status');return {data:{displayName:'Viewer',nicknameChosen:chosen},error:fail?new Error('outage'):null};}},applyCookies:r=>r});
 const next='/movies/film/#contribute',url='https://triggerboxd.com/auth/callback/?code=test-code&next='+encodeURIComponent(next);
 try{
  const response=await GET(new Request(url));assert.equal(response.status,303);
  const destination=new URL(response.headers.get('location'));assert.equal(destination.pathname,'/account/');assert.equal(destination.searchParams.get('setup'),'nickname');assert.equal(destination.searchParams.get('next'),next);
  chosen=true;assert.equal((await GET(new Request(url))).headers.get('location'),'https://triggerboxd.com/movies/film/#contribute');
  fail=true;const failure=await GET(new Request(url));assert.equal(new URL(failure.headers.get('location')).pathname,'/login/');
  const recovery=await GET(new Request(url+'&flow=recovery'));assert.equal(new URL(recovery.headers.get('location')).pathname,'/auth/reset-password/');
 }finally{[server.createRequestClient,server.authConfiguration]=old;}
});
