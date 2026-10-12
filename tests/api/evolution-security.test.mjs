import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const root='src/app/api/v1/movies/[id]';
const context={params:Promise.resolve({id:'dcd83222-0705-49f8-9b7a-7f9ecc80f120'})};
test('reveal and new write routes reject cross-origin requests before database access',async()=>{
 process.env.APP_ORIGIN='https://triggerboxd.com';
 for(const [route,method] of [['reveal','POST'],['warnings','PATCH'],['family-vote','PUT']]){
  const handler=loadTypeScript(`${root}/${route}/route.ts`)[method];
  const response=await handler(new Request(`https://triggerboxd.com/api/v1/movies/id/${route}`,{method,headers:{origin:'https://attacker.invalid','content-type':'application/json'},body:'{}'}),context);
  assert.equal(response.status,403);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal((await response.json()).error.code,'FORBIDDEN');
 }
});
test('explicit reveal rejects missing gesture CSRF token even on same origin',async()=>{
 process.env.APP_ORIGIN='https://triggerboxd.com';
 const handler=loadTypeScript(`${root}/reveal/route.ts`).POST;
 const response=await handler(new Request('https://triggerboxd.com/api/v1/movies/id/reveal',{method:'POST',headers:{origin:'https://triggerboxd.com','content-type':'application/json'},body:'{"categories":["nudity"],"level":2}'}),context);
 assert.equal(response.status,403);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});
