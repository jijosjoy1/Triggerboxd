import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=()=>loadTypeScript(fileURLToPath(new URL('../../src/lib/subtitle-estimates.ts',import.meta.url)));
const id='f1000000-0000-4000-8000-000000000001';
const result={rating:3,verdict:'Private text',factors:{mildProfanityCues:1,strongProfanityCues:8,slurCues:0,sexualContentCues:2,sexualViolenceReferenceCues:0},rulesVersion:'2026-10-16.2',scorerVersion:'family-1',subtitleLanguage:'EN',subtitleHash:'a'.repeat(64),cueCount:100};
test('subtitle result accepts only compact bounded provenance, never raw evidence or secrets',()=>{
 const {parseSubtitleResult}=load();
 assert.equal(parseSubtitleResult(result).rating,3);
 for(const value of [{...result,subtitleText:'private'}, {...result,rating:6}, {...result,subtitleHash:'wrong'}, {...result,factors:{...result.factors,strongProfanityCues:101}}, {...result,downloadUrl:'https://bad.example/key'}, {...result,subtitleLanguage:'../en'}, {...result,cueCount:0}]) assert.throws(()=>parseSubtitleResult(value),/INVALID_REQUEST/);
});
test('review requires latest revision, watched confirmation, and reasons for overrides or reopening',()=>{
 const {parseSubtitleAction}=load();
 assert.equal(parseSubtitleAction({action:'approve',id,expectedRevision:2,watched:true,rating:4,note:'Sexual dialogue understated'}).rating,4);
 for(const value of [{action:'approve',id,expectedRevision:2,watched:false,rating:3}, {action:'approve',id,expectedRevision:0,watched:true,rating:3}, {action:'reject',id,expectedRevision:2}, {action:'reopen',id,expectedRevision:2,note:''}, {action:'enqueue',tmdbId:5,owner:true}]) assert.throws(()=>parseSubtitleAction(value),/INVALID_REQUEST/);
});
