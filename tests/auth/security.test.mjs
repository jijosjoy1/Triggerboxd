import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath, validateMutation, issueCsrf, requestOrigin, AuthError } from '../../src/lib/request-security.ts';

test('return paths preserve a movie and refuse external or encoded redirects', () => {
  assert.equal(safeReturnPath('/movies/42/?draft=1'), '/movies/42/?draft=1');
  for (const path of ['https://evil.test/', '//evil.test/', '/\\evil.test/', '/%2f%2fevil.test/', '/%5cevil.test/', '/%0d%0aLocation:evil', '/auth/callback/', '/x/..//evil.test/', '/%2e%2e//evil.test/', '/movies/../auth/callback/']) {
    assert.equal(safeReturnPath(path), '/search/');
  }
});

test('mutations require exact origin, JSON and the matching CSRF secret', () => {
  const secret = 'a'.repeat(48);
  const make = (extra = {}) => new Request('https://triggerboxd.com/api/auth/logout', {
    method: 'POST', headers: { origin: 'https://triggerboxd.com', 'content-type': 'application/json', cookie: `tb-csrf=${secret}`, 'x-csrf-token': secret, ...extra }, body: '{}',
  });
  assert.doesNotThrow(() => validateMutation(make()));
  for (const headers of [{origin:'https://evil.test'}, {origin:'https://triggerboxd.com.evil.test'}, {'x-csrf-token':'b'.repeat(48)}, {'x-csrf-token':''}, {'content-type':'text/plain'}]) {
    assert.throws(() => validateMutation(make(headers)), AuthError);
  }
  const absent = make(); absent.headers.delete('origin');
  assert.throws(() => validateMutation(absent), AuthError);
});

test('CSRF issuance uses an HttpOnly secure host cookie and reuses a valid token', () => {
  const writes = [];
  const response = { cookies: { set: (...args) => writes.push(args) }, headers: new Headers() };
  const token = issueCsrf(new Request('https://triggerboxd.com/api/auth/session'), response);
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.equal(writes[0][2].httpOnly, true);
  assert.equal(writes[0][2].secure, true);
  assert.equal(writes[0][2].sameSite, 'lax');
  assert.equal(writes[0][2].domain, undefined);
  assert.equal(issueCsrf(new Request('https://triggerboxd.com/api/auth/session', { headers: { cookie: `tb-csrf=${token}` } }), response), token);
});

test('Next local hostname normalization does not reject a valid loopback Origin',()=>{
  const previous=process.env.NODE_ENV;
  process.env.NODE_ENV='development';
  try{
    const token='c'.repeat(48);
    const request=new Request('http://localhost:4327/api/auth/google/',{method:'POST',headers:{host:'127.0.0.1:4327',origin:'http://127.0.0.1:4327','content-type':'application/json',cookie:`tb-csrf=${token}`,'x-csrf-token':token},body:'{}'});
    assert.equal(requestOrigin(request),'http://127.0.0.1:4327');
    assert.doesNotThrow(()=>validateMutation(request));
    request.headers.set('host','evil.test');
    assert.throws(()=>validateMutation(request),AuthError);
  }finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
