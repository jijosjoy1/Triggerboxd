import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {storyCaption,wrapStoryText,drawStoryCard,storyLevel,storyWarningText,storyArtworkBounds,storyReaction} = loadTypeScript(fileURLToPath(new URL('../../src/lib/story-card.ts',import.meta.url)));
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
  const ctx={createLinearGradient(){return {addColorStop(){}}},createRadialGradient(){return {addColorStop(){}}},roundRect(){},fill(){},save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fillRect(){},strokeRect(){},fillText(text){printed.push(text)},measureText:text=>({width:text.length*12})};
  const canvas={getContext:()=>ctx};
  drawStoryCard(canvas,'Test Film',null);
  assert.equal(canvas.width,1080); assert.equal(canvas.height,1920);
  assert.match(printed.join(' '),/jury is still out/); assert.match(printed.join(' '),/Not a safety guarantee/i);
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
test('story card leaves the movie URL for the Link sticker without publishing private descriptors',()=>{
  const printed=[];const ctx={createLinearGradient(){return {addColorStop(){}}},createRadialGradient(){return {addColorStop(){}}},roundRect(){},fill(){},save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fillRect(){},strokeRect(){},fillText(text){printed.push(text)},measureText:text=>({width:text.length*10})};
  const id='dcd83222-0705-49f8-9b7a-7f9ecc80f120';
  drawStoryCard({getContext:()=>ctx},'Film',{value:4,count:1,provisional:false},id,{category:'sexual_violence',severity:3,spoilerLevel:2,descriptors:['rape']},true);
  assert.doesNotMatch(printed.join(' '),new RegExp(id));
  assert.match(printed.join(' '),/triggerboxd\.com/);
  assert.match(printed.join(' '),/ceiling fan/);
  assert.doesNotMatch(printed.join(' '),/rape|sexual violence|Severe/);
});

test('story card splits the brand in both positions and keeps a long title to two safe lines',()=>{
  const printed=[];const gradient={addColorStop(){}};
  const ctx={createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,save(){},restore(){},beginPath(){},roundRect(){},fill(){},stroke(){},fillRect(){},fillText(text,x,y){printed.push({text,x,y,color:this.fillStyle})},measureText:text=>({width:text.length*18})};
  drawStoryCard({getContext:()=>ctx},'An extraordinarily long film title that needs to fit safely',null);
  const brand=printed.filter(item=>/^(trigger|boxd|TRIGGER|BOXD)$/.test(item.text));
  assert.deepEqual(brand.map(item=>[item.text,item.color]),[['trigger','#FFFFFF'],['boxd','#EF233C'],['TRIGGER','#FFFFFF'],['BOXD','#EF233C']]);
  const title=printed.filter(item=>item.y>=590&&item.y<=710);
  assert.ok(title.length>=1&&title.length<=2);
  assert.ok(title.every(item=>item.x>=70&&item.x<=1010));
});

test('caption wraps at words while unusually long titles stay bounded',()=>{
  const ctx={measureText:text=>({width:text.length*10})};
  assert.deepEqual(wrapStoryText(ctx,'WhatsApp looks interesting.',150,4),['WhatsApp looks','interesting.']);
});

 test('poster is included proportionally without cropping and warnings stay protected',()=>{
  const images=[],printed=[];
  const ctx={createLinearGradient(){return {addColorStop(){}}},createRadialGradient(){return {addColorStop(){}}},roundRect(){},fill(){},save(){},restore(){},translate(){},scale(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fillRect(){},strokeRect(){},drawImage(...args){images.push(args)},fillText(text){printed.push(text)},measureText:text=>({width:text.length*10})};
  const poster={naturalWidth:600,naturalHeight:900};
  drawStoryCard({getContext:()=>ctx},'Film',null,undefined,{category:'sexual_violence',severity:3,spoilerLevel:2},false,poster);
  assert.equal(images.length,1);assert.equal(images[0][0],poster);
  assert.equal(images[0].length,5);assert.equal(images[0][4],1620);assert.equal(images[0][3],1080);
  assert.ok(Math.abs(images[0][3]/images[0][4]-2/3)<0.0001);
  assert.doesNotMatch(printed.join(' '),/sexual violence|Severe/);
  images.length=0;
  drawStoryCard({getContext:()=>ctx},'Film',null,undefined,undefined,false,{naturalWidth:0,naturalHeight:0});
  assert.equal(images.length,0);
  const reaction={naturalWidth:600,naturalHeight:200};images.length=0;
  drawStoryCard({getContext:()=>ctx},'Film',{value:2,count:1,provisional:false},undefined,undefined,true,null,{reaction});
  assert.equal(images.length,1);assert.equal(images[0][0],reaction);
  assert.equal(images[0][3]/images[0][4],3);
 });

test('cinematic artwork and reaction mapping stay proportional and centralised',()=>{
  assert.deepEqual(storyArtworkBounds(600,900),{x:0,y:0,width:1080,height:1620});
  const backdrop=storyArtworkBounds(1920,1080,true);
  assert.equal(backdrop.height,1050);assert.ok(Math.abs(backdrop.width/backdrop.height-1920/1080)<1e-10);
  for(let i=1;i<=5;i++){assert.match(storyReaction(i).asset,new RegExp(`level-${i}-`));assert.match(storyReaction(i).color,/^#[0-9A-F]{6}$/);}
  assert.equal(storyReaction(null),null);assert.equal(storyReaction(6),null);
});
test('critical text is in story safe area and personal/early community labels are truthful',()=>{
  const printed=[];const gradient={addColorStop(){}};
  const ctx={createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},roundRect(){},fill(){},stroke(){},fillRect(){},fillText(text,x,y){printed.push({text,x,y})},measureText:text=>({width:text.length*10})};
  drawStoryCard({getContext:()=>ctx},'Long movie title '.repeat(30),{value:2,count:1,provisional:false},undefined,undefined,true);
  assert.ok(printed.every(item=>item.x>=72&&item.x<=1008&&item.y>=220&&item.y<=1670));
  assert.match(printed.map(item=>item.text).join(' '),/MY VERDICT/);
  assert.match(printed.map(item=>item.text).join(' '),/2\/5/);
  printed.length=0;drawStoryCard({getContext:()=>ctx},'Film',{value:2,count:1,provisional:true});
  assert.doesNotMatch(printed.map(item=>item.text).join(' '),/2\/5|awkward silences/);
  assert.match(printed.map(item=>item.text).join(' '),/Early votes/);
});
