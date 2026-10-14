import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {storyCaption,wrapStoryText,drawStoryCard,storyLevel,storyWarningText} = loadTypeScript(fileURLToPath(new URL('../../src/lib/story-card.ts',import.meta.url)));
test('unknown and early votes cannot claim grandma-safe viewing',()=>{
  assert.match(storyCaption(null),/jury is still out/);
  assert.equal(storyCaption({value:1,count:0,provisional:false}),storyCaption(null));
  assert.match(storyCaption({value:1,count:1,provisional:true}),/Early votes/);
  assert.match(storyCaption({value:2,count:10,provisional:false}),/awkward silences/);
  assert.match(storyCaption({value:5,count:10,provisional:false}),/remote/);
});
test('long and unbroken titles fit bounded text area',()=>{
  const ctx={measureText:text=>({width:Array.from(text).length*10})};
  const lines=wrapStoryText(ctx,'Movie'.repeat(100),100,4);
  assert.equal(lines.length,4); assert.ok(lines.every(line=>ctx.measureText(line).width<=100));
  assert.ok(lines[3].endsWith('…'));
});
test('PNG renderer uses original artwork and never reads hidden payloads',()=>{
  const printed=[];
  const ctx={save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fillRect(){},strokeRect(){},fillText(text){printed.push(text)},measureText:text=>({width:text.length*12})};
  const canvas={getContext:()=>ctx};
  drawStoryCard(canvas,'Test Film',null);
  assert.equal(canvas.width,1080); assert.equal(canvas.height,1920);
  assert.match(printed.join(' '),/unknown/); assert.match(printed.join(' '),/Not a safety guarantee/i);
  assert.throws(()=>drawStoryCard({getContext:()=>null},'Film',null),/could not create/);
});

test('personal reports use the actual own vote and protected warnings remain concealed',()=>{
  assert.equal(storyLevel({value:4,count:1,provisional:false},true),4);
  assert.equal(storyLevel({value:4,count:1,provisional:false}),null);
  assert.equal(storyLevel({value:4,count:2,provisional:false}),null);
  const protectedText=storyWarningText({category:'sexual_violence',severity:3,spoilerLevel:2,descriptors:['rape']});
  assert.doesNotMatch(protectedText,/sexual|Severe|rape/i);
  assert.match(storyWarningText({category:'gore_graphic_violence',severity:2,spoilerLevel:0}),/Moderate/);
});
test('story card includes the canonical movie URL without publishing private descriptors',()=>{
  const printed=[];const ctx={save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fillRect(){},strokeRect(){},fillText(text){printed.push(text)},measureText:text=>({width:text.length*10})};
  const id='dcd83222-0705-49f8-9b7a-7f9ecc80f120';
  drawStoryCard({getContext:()=>ctx},'Film',{value:4,count:1,provisional:false},id,{category:'sexual_violence',severity:3,spoilerLevel:2,descriptors:['rape']},true);
  assert.match(printed.join(' '),new RegExp(id));
  assert.match(printed.join(' '),/ceiling fan/);
  assert.doesNotMatch(printed.join(' '),/rape|sexual violence|Severe/);
});

test('caption wraps at words while unusually long titles stay bounded',()=>{
  const ctx={measureText:text=>({width:text.length*10})};
  assert.deepEqual(wrapStoryText(ctx,'WhatsApp looks interesting.',150,4),['WhatsApp looks','interesting.']);
});
