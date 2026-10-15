import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=p=>loadTypeScript(fileURLToPath(new URL('../../'+p,import.meta.url)));
test('public picture endpoint returns only image bytes with safe headers and honors removal',async()=>{
 const db=load('src/lib/movie-api.ts'),{GET}=load('src/app/api/v1/avatars/[id]/route.ts');
 const old=db.publicDatabase;let stored=true;let calls=0;
 db.publicDatabase=()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'get_profile_picture');assert.deepEqual(args,{p_id:'c0000000-0000-4000-8000-000000000001'});return {data:stored?'/9j/2Q==':null,error:null};}});
 const context=id=>({params:Promise.resolve({id})});
 try{
  assert.equal((await GET(new Request('https://triggerboxd.com'),context('bad'))).status,404);assert.equal(calls,0);
  const response=await GET(new Request('https://triggerboxd.com'),context('c0000000-0000-4000-8000-000000000001'));
  assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[255,216,255,217]);
  stored=false;assert.equal((await GET(new Request('https://triggerboxd.com'),context('c0000000-0000-4000-8000-000000000001'))).status,404);
 }finally{db.publicDatabase=old;}
});
test('picture writes require CSRF and active authentication, derive the owner and sanitize bytes',async()=>{
 const server=load('src/lib/supabase/server.ts'),auth=load('src/lib/auth.ts'),db=load('src/lib/movie-api.ts');
 const {POST,DELETE}=load('src/app/api/v1/me/picture/route.ts');
 const old=[server.createRequestClient,auth.requireActiveUser,db.serviceDatabase];
 const calls=[];let signedIn=true;
 server.createRequestClient=()=>({client:{},applyCookies:r=>r});
 auth.requireActiveUser=async()=>{if(!signedIn)throw new Error('AUTH_REQUIRED');return {id:'verified-owner'};};
 db.serviceDatabase=()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{avatarId:'c0000000-0000-4000-8000-000000000001'},error:null};}});
 const token='a'.repeat(48),request=(body,csrf=token,method='POST')=>new Request('https://triggerboxd.com/api/v1/me/picture/',{method,headers:{origin:'https://triggerboxd.com','content-type':'application/json',cookie:`tb-csrf=${token}`,'x-csrf-token':csrf},body:JSON.stringify(body)});
 try{
  assert.equal((await POST(request({},'bad'))).status,403);assert.equal(calls.length,0);
  signedIn=false;assert.equal((await POST(request({}))).status,401);signedIn=true;
  assert.equal((await POST(request({image:'PHN2Zy8+'}))).status,400);
  assert.equal((await POST(request({image:'abc',userId:'other'}))).status,400);
  const jpg=Buffer.from([255,216,255,225,0,5,71,80,83,255,192,0,11,8,1,0,1,0,1,1,17,0,255,218,0,8,1,1,0,0,63,0,9,255,217]);
  assert.equal((await POST(request({image:jpg.toString('base64')}))).status,200);
  assert.equal(calls[0].args.p_actor,'verified-owner');assert.equal(Buffer.from(calls[0].args.p_image,'base64').includes('GPS'),false);
  assert.equal((await DELETE(request({},token,'DELETE'))).status,200);assert.equal(calls[1].args.p_image,null);
 }finally{[server.createRequestClient,auth.requireActiveUser,db.serviceDatabase]=old;}
});
