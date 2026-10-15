import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=()=>loadTypeScript(fileURLToPath(new URL('../../src/lib/admin-review.ts',import.meta.url)));
test('flagging requires a deliberate reason and the inspected review revision',()=>{
 const {parseReviewAction}=load();
 assert.deepEqual(parseReviewAction({action:'flag',expectedRevision:12,reason:'spam',note:' Repeated advertising '}),{action:'flag',expectedRevision:12,reason:'spam',note:'Repeated advertising'});
 assert.deepEqual(parseReviewAction({action:'resolve',expectedRevision:12}),{action:'resolve',expectedRevision:12,reason:null,note:null});
 for(const body of [{action:'flag',expectedRevision:12},{action:'flag',expectedRevision:12,reason:'different_opinion'},
  {action:'flag',expectedRevision:0,reason:'spam'},{action:'flag',expectedRevision:12,reason:'spam',owner:true},
  {action:'flag',expectedRevision:12,reason:'spam',note:'x'.repeat(281)},
  {action:'resolve',expectedRevision:12,note:'extra'},null])assert.throws(()=>parseReviewAction(body),/INVALID_REQUEST/);
});
