import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=()=>loadTypeScript(fileURLToPath(new URL('../../src/lib/avatar.ts',import.meta.url)));
// Small structural JPEG fixture: metadata, baseline frame, scan, escaped byte, EOI.
const frame=[255,192,0,11,8,1,0,1,0,1,1,17,0];
const scan=[255,218,0,8,1,1,0,0,63,0,12,255,0,23,255,217];
const jpeg=(extra=[])=>new Uint8Array([255,216,...extra,...frame,...scan]);
test('avatar sanitization removes EXIF, comments and trailing data',()=>{
 const {sanitizeAvatar}=load();
 const clean=sanitizeAvatar(jpeg([255,225,0,8,69,120,105,102,0,0,255,254,0,5,71,80,83]));
 assert.deepEqual([...clean],[...jpeg()]);
 assert.doesNotMatch(Buffer.from(clean).toString(),/Exif|GPS/);
 assert.throws(()=>sanitizeAvatar(new Uint8Array([...jpeg(),60,115,118,103,62])),/INVALID_REQUEST/);
});
test('avatar rejects unsupported, oversized, truncated and oversized-dimension uploads',()=>{
 const {sanitizeAvatar}=load();
 for(const bytes of [new TextEncoder().encode('<svg/>'),new Uint8Array(65537),jpeg().slice(0,-2),new Uint8Array([255,216,255,225,255,255,0])])assert.throws(()=>sanitizeAvatar(bytes));
 const wide=jpeg();wide[9]=2;assert.throws(()=>sanitizeAvatar(wide),/INVALID_REQUEST/);
 assert.throws(()=>sanitizeAvatar(new Uint8Array([255,216,...scan])),/INVALID_REQUEST/);
});
test('public avatar URLs accept only opaque image identifiers',()=>{
 const {avatarUrl}=load();
 assert.equal(avatarUrl('c0000000-0000-4000-8000-000000000001'),'/api/v1/avatars/c0000000-0000-4000-8000-000000000001/');
 for(const id of ['https://tracker.test/x','../secret',null,''])assert.equal(avatarUrl(id),null);
});
