import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {storyCaption,wrapStoryText,drawStoryCard} = loadTypeScript(fileURLToPath(new URL('../../src/lib/story-card.ts',import.meta.url)));
test('unknown and early votes cannot claim grandma-safe viewing',()=>{
  assert.match(storyCaption(null),/jury is still out/);
  assert.equal(storyCaption({value:1,count:0,provisional:false}),storyCaption(null));
  assert.match(storyCaption({value:1,count:1,provisional:true}),/Early votes/);
  assert.match(storyCaption({value:2,count:10,provisional:false}),/less awkward/);
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
  const ctx={fillRect(){},strokeRect(){},fillText(text){printed.push(text)},measureText:text=>({width:text.length*12})};
  const canvas={getContext:()=>ctx};
  drawStoryCard(canvas,'Test Film',null);
  assert.equal(canvas.width,1080); assert.equal(canvas.height,1920);
  assert.match(printed.join(' '),/unknown/); assert.match(printed.join(' '),/Not a safety guarantee/i);
  assert.throws(()=>drawStoryCard({getContext:()=>null},'Film',null),/could not create/);
});
