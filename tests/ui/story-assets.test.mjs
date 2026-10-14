import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {loadStoryImage,storyImageUrl,storyAccent}=loadTypeScript(fileURLToPath(new URL('../../src/lib/story-assets.ts',import.meta.url)));
test('story images are restricted to validated TMDb paths',()=>{
 assert.equal(storyImageUrl('//evil.test/image.jpg'),null);assert.equal(storyImageUrl('/../secret.jpg'),null);
 assert.equal(storyImageUrl('/poster.jpg'),'https://image.tmdb.org/t/p/w780/poster.jpg');
 assert.equal(storyImageUrl('/backdrop.jpg',true),'https://image.tmdb.org/t/p/w1280/backdrop.jpg');
 assert.equal(storyAccent(null),'#D5B875');
});
test('image readiness uses CORS before src, shares loads, and safely retries failed assets',async()=>{
 const original=globalThis.Image,instances=[];
 try{
  globalThis.Image=class {naturalWidth=600;naturalHeight=900;set src(value){assert.equal(this.crossOrigin,'anonymous');this.url=value;instances.push(this)}};
  const first=loadStoryImage('/test-reaction.svg'),second=loadStoryImage('/test-reaction.svg');assert.equal(first,second);
  instances[0].onload();assert.equal(await first,instances[0]);
  const failed=loadStoryImage('/failed.svg');instances[1].onerror();assert.equal(await failed,null);
  const retry=loadStoryImage('/failed.svg');assert.equal(instances.length,3);instances[2].onload();assert.ok(await retry);
  assert.equal(await loadStoryImage(null),null);
 }finally{globalThis.Image=original;}
});

test('timed-out images resolve safely and detach late handlers',async t=>{
 const original=globalThis.Image;let instance;
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  globalThis.Image=class {set src(value){instance=this}};
  const promise=loadStoryImage('/timeout-fixture.svg');
  t.mock.timers.tick(8000);assert.equal(await promise,null);
  assert.equal(instance.onload,null);assert.equal(instance.onerror,null);
 }finally{globalThis.Image=original;t.mock.timers.reset();}
});
