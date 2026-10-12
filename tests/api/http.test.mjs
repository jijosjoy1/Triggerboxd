import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonBody, errorResponse, successResponse, validateMovieId, idempotencyKey } from '../../src/lib/api-http.ts';

test('bounds streamed bodies and rejects non-object JSON', async () => {
  await assert.rejects(readJsonBody(new Request('https://example.com', {method:'POST',headers:{'content-type':'application/json'},body:'"value"'})), /INVALID_REQUEST/);
  await assert.rejects(readJsonBody(new Request('https://example.com', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:'a'.repeat(8200)})})), /PAYLOAD_TOO_LARGE/);
  assert.deepEqual(await readJsonBody(new Request('https://example.com', {method:'POST',headers:{'content-type':'application/json'},body:'{"tmdbId":123}'})), {tmdbId:123});
});
test('unknown errors do not reveal database or provider internals', async () => {
  const response = errorResponse(new Error('postgres password secret'));
  assert.equal(response.status,503);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  const payload=await response.json();
  assert.equal(payload.error.code,'SERVICE_UNAVAILABLE');
  assert.ok(payload.error.requestId);
  assert.ok(!JSON.stringify(payload).includes('postgres'));
});
test('movie IDs and retry keys reject arbitrary values', () => {
  assert.throws(()=>validateMovieId('123'),/NOT_FOUND/);
  assert.equal(validateMovieId('00000000-0000-4000-8000-000000000001'),'00000000-0000-4000-8000-000000000001');
  assert.throws(()=>idempotencyKey(new Request('https://example.com')),/INVALID_REQUEST/);
  assert.equal(idempotencyKey(new Request('https://example.com',{headers:{'idempotency-key':'retry-123456'}})),'retry-123456');
});
test('responses are private and JSON envelopes', async()=>{
  const response=successResponse({count:0});
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{data:{count:0}});
});
