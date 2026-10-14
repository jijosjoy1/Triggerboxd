import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=path=>loadTypeScript(fileURLToPath(new URL('../../'+path,import.meta.url)));
const auth=load('src/lib/auth.ts'),server=load('src/lib/supabase/server.ts');
const {GET}=load('src/app/api/v1/me/contributions/route.ts');
test('history requires authentication, scopes to the verified user, bounds pagination and excludes warning payloads',async()=>{
  const savedAuth=auth.requireActiveUser,savedClient=server.createRequestClient;
  let allowed=false,calls=[],rows=Array.from({length:25},()=>({updated_at:'2026-10-14T00:00:00Z',visibility:'active',movies:{id:'film',title:'Film'}}));
  const query={select(value){calls.push(['select',value]);return this},eq(...args){calls.push(['eq',...args]);return this},order(){return this},async range(...args){calls.push(['range',...args]);return {data:rows,error:null}}};
  try{
    auth.requireActiveUser=async()=>{if(!allowed)throw new Error('AUTH_REQUIRED');return {id:'verified-user'}};
    server.createRequestClient=()=>({client:{from(table){calls.push(['from',table]);return query}},applyCookies:r=>{r.headers.set('Vary','Cookie');return r}});
    const request=page=>new Request(`https://triggerboxd.com/api/v1/me/contributions?page=${page}`);
    assert.equal((await GET(request(1))).status,401);assert.equal(calls.length,0);
    allowed=true;
    const response=await GET(request(2)),body=await response.json();
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal(body.data.results.length,24);assert.equal(body.data.hasMore,true);
    assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]==='verified-user'));
    assert.ok(calls.some(c=>c[0]==='range'&&c[1]===24&&c[2]===48));
    assert.doesNotMatch(calls.find(c=>c[0]==='select')[1],/severity|descriptor|note/);
    calls=[];assert.equal((await GET(request('-1'))).status,400);assert.equal(calls.length,0);
    rows=[];assert.equal((await (await GET(request(1))).json()).data.hasMore,false);
  }finally{auth.requireActiveUser=savedAuth;server.createRequestClient=savedClient;}
});
