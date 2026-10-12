import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import { loadTypeScript } from './load-typescript.mjs';

test('concurrent page and navigation auth reads share one cookie/token response',async()=>{
  const originalFetch=globalThis.fetch;
  const originalWindow=globalThis.window;
  globalThis.window=new EventTarget();
  let count=0;let release;
  const responseReady=new Promise(resolve=>{release=resolve;});
  globalThis.fetch=async()=>{count++;await responseReady;return Response.json({data:{user:null,configured:false,passwordEnabled:false,csrfToken:'a'.repeat(48)}});};
  try{
    const {refreshAuthSession}=loadTypeScript(fileURLToPath(new URL('../../src/lib/supabase/browser.ts',import.meta.url)));
    const header=refreshAuthSession();
    const movie=refreshAuthSession();
    release();
    const [first,second]=await Promise.all([header,movie]);
    assert.equal(count,1);
    assert.equal(first.csrfToken,second.csrfToken);
  }finally{globalThis.fetch=originalFetch;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}
});
