import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
test('dashboard dates always use IST including midnight rollover',()=>{
 const {formatIstTime}=loadTypeScript(fileURLToPath(new URL('../../src/lib/ist-time.ts',import.meta.url)));
 const previous=process.env.TZ;
 try{
  for(const zone of ['UTC','America/New_York']){
   process.env.TZ=zone;
   assert.equal(formatIstTime('2026-10-15T20:00:00Z'),'16 Oct 2026, 01:30 IST');
   assert.equal(formatIstTime('2026-10-15T00:00:00Z'),'15 Oct 2026, 05:30 IST');
  }
  assert.equal(formatIstTime('invalid'),'Unknown time');
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
