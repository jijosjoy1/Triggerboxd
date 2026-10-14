import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const c=loadTypeScript('src/lib/scene-contracts.ts');
const note={noteId:'dcd83222-0705-49f8-9b7a-7f9ecc80f120',expectedRevision:0,watched:true,category:'nudity',comment:'Brief non-sexual nudity.',startSeconds:null,endSeconds:null,version:null,spoilerLevel:0};
test('notes support optional timestamps or optional comment without accepting empty submissions',()=>{
 assert.equal(c.parseNoteInput(note).startSeconds,null);
 assert.equal(c.parseNoteInput({...note,comment:null,startSeconds:0}).comment,null);
 assert.throws(()=>c.parseNoteInput({...note,comment:null}));
 assert.throws(()=>c.parseNoteInput({...note,startSeconds:null,endSeconds:10}));
 assert.throws(()=>c.parseNoteInput({...note,startSeconds:20,endSeconds:19}));
});
test('note writes require watched, revision, known categories and bounded plain text',()=>{
 for(const change of [{watched:false},{expectedRevision:-1},{category:'unknown'},{spoilerLevel:3},{comment:'x'.repeat(281)},{version:'x'.repeat(81)},{startSeconds:86401},{html:true},{comment:'a\u0000b'}])assert.throws(()=>c.parseNoteInput({...note,...change}));
 assert.equal(c.parseNoteInput({...note,comment:'<script>alert(1)</script>'}).comment,'<script>alert(1)</script>');
});
test('notes accept independent horror and graphic violence severity through five',()=>{
 assert.equal(c.parseNoteInput({...note,category:'horror',severity:5}).severity,5);
 assert.equal(c.parseNoteInput({...note,category:'graphic_violence',severity:4}).severity,4);
 assert.throws(()=>c.parseNoteInput({...note,category:'horror',severity:6}));
});
test('timestamps round trip midnight and enforce hours minutes seconds',()=>{
 assert.equal(c.parseTimestamp('00:00:00'),0);assert.equal(c.formatTimestamp(0),'00:00:00');
 assert.equal(c.parseTimestamp('02:12:35'),7955);assert.equal(c.formatTimestamp(7955),'02:12:35');
 assert.equal(c.parseTimestamp(''),null);
 for(const value of ['1:2:3','00:60:00','00:00:60','25:00:00'])assert.throws(()=>c.parseTimestamp(value));
});
test('reveal accepts only one explicitly selected category and public queries cannot choose spoiler level',()=>{
 assert.equal(c.parseSceneQuery({categories:['animal_harm'],level:2,offset:0},true).level,2);
 for(const categories of [[],['nudity','animal_harm'],['nudity','nudity']])assert.throws(()=>c.parseSceneQuery({categories,level:2,offset:0},true));
 assert.throws(()=>c.parseSceneQuery({categories:[],level:2,offset:0}));
 assert.throws(()=>c.parseSceneQuery({categories:[],offset:10001}));
});
test('reports and delete require exact note revision with no undocumented fields',()=>{
 assert.equal(c.parseNoteDelete({noteId:note.noteId,expectedRevision:1}).expectedRevision,1);
 assert.throws(()=>c.parseNoteDelete({noteId:note.noteId,expectedRevision:0}));
 assert.equal(c.parseNoteReport({noteId:note.noteId,targetRevision:1,reason:'spoiler',correction:null}).correction,null);
 assert.throws(()=>c.parseNoteReport({noteId:note.noteId,targetRevision:1,reason:'other',correction:null}));
});
