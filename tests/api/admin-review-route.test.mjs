import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=p=>loadTypeScript(fileURLToPath(new URL('../../'+p,import.meta.url)));
test('review moderation verifies CSRF and authentication and never accepts an actor from the caller',async()=>{
 const server=load('src/lib/supabase/server.ts'),auth=load('src/lib/auth.ts');
 const {GET,POST}=load('src/app/api/v1/admin/reviews/[id]/route.ts');
 const old=[server.createRequestClient,auth.requireActiveUser];let authenticated=true;let owner=true;const calls=[];
 server.createRequestClient=()=>({client:{rpc:async(name,args)=>{calls.push([name,args]);return owner?{data:{id:'review'},error:null}:{data:null,error:{message:'FORBIDDEN'}};}},applyCookies:r=>r});
 auth.requireActiveUser=async()=>{if(!authenticated)throw new Error('AUTH_REQUIRED');return{id:'owner'};};
 const id='e2000000-0000-4000-8000-000000000001',ctx={params:Promise.resolve({id})},token='a'.repeat(48);
 const request=(body,csrf=token)=>new Request('https://triggerboxd.com/api/v1/admin/reviews/'+id+'/',{method:'POST',headers:{origin:'https://triggerboxd.com','content-type':'application/json',cookie:`tb-csrf=${token}`,'x-csrf-token':csrf},body:JSON.stringify(body)});
 try{
  const body={action:'flag',expectedRevision:1,reason:'spam',note:'Repeated promotion'};
  assert.equal((await POST(request(body,'bad'),ctx)).status,403);assert.equal(calls.length,0);
  authenticated=false;assert.equal((await POST(request(body),ctx)).status,401);assert.equal(calls.length,0);authenticated=true;
  assert.equal((await POST(request({...body,actor:'other'}),ctx)).status,400);assert.equal(calls.length,0);
  owner=false;assert.equal((await GET(new Request('https://triggerboxd.com'),ctx)).status,403);owner=true;calls.length=0;
  assert.equal((await POST(request(body),ctx)).status,200);
  assert.deepEqual(calls,[['set_admin_review_flag',{p_id:id,p_expected_revision:1,p_action:'flag',p_reason:'spam',p_note:'Repeated promotion'}]]);
  calls.length=0;assert.equal((await GET(new Request('https://triggerboxd.com'),ctx)).status,200);
  assert.deepEqual(calls,[['get_admin_review',{p_id:id}]]);
 }finally{[server.createRequestClient,auth.requireActiveUser]=old;}
});
