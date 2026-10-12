import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const v=loadTypeScript('src/lib/validation.ts');
const patch={expectedRevision:0,watched:true,category:'animal_harm',severity:0,spoilerLevel:2,descriptors:[]};
test('partial warning preserves explicit absence and spoiler level without requiring other ratings',()=>{
 assert.deepEqual(v.parsePatchWarningInput(patch),patch);
 for(const field of ['note','userId','representation'])assert.throws(()=>v.parsePatchWarningInput({...patch,[field]:null}));
});
test('partial warning rejects invalid spoiler levels, duplicate descriptors and unsupported categories',()=>{
 for(const spoilerLevel of [-1,3,'1',null])assert.throws(()=>v.parsePatchWarningInput({...patch,spoilerLevel}));
 assert.throws(()=>v.parsePatchWarningInput({...patch,descriptors:['animal_death','animal_death']}));
 assert.throws(()=>v.parsePatchWarningInput({...patch,category:'representation'}));
 assert.throws(()=>v.parsePatchWarningInput({...patch,severity:1,descriptors:['rape']}));
 assert.throws(()=>v.parsePatchWarningInput({...patch,severity:0,descriptors:['animal_death']}));
 assert.deepEqual(v.parsePatchWarningInput({...patch,severity:1,descriptors:['animal_death']}).descriptors,['animal_death']);
});
test('reveal requires selected supported unique categories and explicit disclosure level',()=>{
 assert.deepEqual(v.parseRevealWarningsInput({categories:['nudity','animal_harm'],level:1}),{categories:['nudity','animal_harm'],level:1});
 for(const categories of [[],['nudity','nudity'],['secret'],['nudity',null]])assert.throws(()=>v.parseRevealWarningsInput({categories,level:2}));
 for(const level of [0,3,'2'])assert.throws(()=>v.parseRevealWarningsInput({categories:['nudity'],level}));
 assert.throws(()=>v.parseRevealWarningsInput({categories:['nudity'],level:2,all:true}));
});
test('independent family scale requires watching, a revision and exact integer 1–5',()=>{
 assert.deepEqual(v.parseFamilyVoteInput({expectedRevision:4,watched:true,value:5}),{expectedRevision:4,watched:true,value:5});
 for(const value of [0,6,1.5,'1',null])assert.throws(()=>v.parseFamilyVoteInput({expectedRevision:0,watched:true,value}));
 assert.throws(()=>v.parseFamilyVoteInput({expectedRevision:0,watched:false,value:1}));
 assert.throws(()=>v.parseFamilyVoteInput({expectedRevision:0,watched:true,value:1,severity:0}));
});
