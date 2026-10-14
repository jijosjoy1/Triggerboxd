import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {loadDefaultStoryRating}=loadTypeScript(fileURLToPath(new URL('../../src/lib/story-default.ts',import.meta.url)));
test('Share automatically prefers the saved personal family vote without fetching community',async()=>{
 const calls=[];const result=await loadDefaultStoryRating('film',{user:{id:'me'},csrfToken:'csrf'},async(url,options)=>{calls.push([url,options]);return Response.json({data:{familyVote:{value:4}}});});
 assert.equal(result.source,'personal');assert.equal(result.own,4);assert.equal(calls.length,1);assert.match(calls[0][0],/family-vote$/);
});
test('missing family vote falls back to real community data, never converts warnings into votes',async()=>{
 const calls=[];const summary={value:null,count:0,provisional:true,distribution:[]};
 const result=await loadDefaultStoryRating('film',{user:{id:'me'},csrfToken:'csrf'},async(url,options)=>{calls.push([url,options]);return Response.json({data:url.endsWith('family-vote')?{familyVote:null,ratings:[{severity:3}]}:{familySummary:summary}});});
 assert.equal(result.source,'community');assert.equal(result.own,null);assert.deepEqual(result.community,summary);
 assert.equal(calls[1][1].headers['X-CSRF-Token'],'csrf');assert.equal(calls[1][1].method,'POST');
});
test('anonymous Share skips private vote and failed auth never silently substitutes a rating',async()=>{
 let calls=0;await loadDefaultStoryRating('film',{user:null,csrfToken:'csrf'},async url=>{calls++;assert.match(url,/family-summary$/);return Response.json({data:{familySummary:null}});});assert.equal(calls,1);
 await assert.rejects(()=>loadDefaultStoryRating('film',{user:{id:'me'},csrfToken:'csrf'},async()=>Response.json({error:{message:'Sign in again'}},{status:401})),/Sign in again/);
});
