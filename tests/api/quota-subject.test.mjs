import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {searchSubject}=loadTypeScript(fileURLToPath(new URL('../../src/lib/movie-api.ts',import.meta.url)));

test('configured local Worker can identify a quota subject without an edge IP header',async()=>{
  const previous={NODE_ENV:process.env.NODE_ENV,APP_ORIGIN:process.env.APP_ORIGIN,REQUEST_HASH_SECRET:process.env.REQUEST_HASH_SECRET};
  process.env.NODE_ENV='production';process.env.APP_ORIGIN='http://127.0.0.1:4328';process.env.REQUEST_HASH_SECRET='local-test-only-secret-not-a-credential';
  try{
    assert.match(await searchSubject(new Request('http://127.0.0.1:4328/api/v1/movies/search/')),/^[0-9a-f]{64}$/);
    process.env.APP_ORIGIN='https://triggerboxd.com';
    await assert.rejects(searchSubject(new Request('https://triggerboxd.com/api/v1/movies/search/',{headers:{'x-forwarded-for':'1.2.3.4'}})),/SERVICE_UNAVAILABLE/);
  }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
