import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from './load-typescript.mjs';

const load = path => loadTypeScript(fileURLToPath(new URL('../../' + path, import.meta.url)));

test('nickname accepts a chosen public alias without storing contact details', () => {
  const { parseNickname } = load('src/lib/nickname.ts');
  assert.equal(parseNickname('  Cinema Fan  '), 'Cinema Fan');
  for (const value of ['', '   ', 'a@b.com', 'https://example.com', 'x'.repeat(61), 12]) {
    assert.throws(() => parseNickname(value), /INVALID_REQUEST/);
  }
});

test('session returns only safe profile fields and nickname setup state, never provider identity', async () => {
  const server = load('src/lib/supabase/server.ts');
  const { GET } = load('src/app/api/auth/session/route.ts');
  const savedConfig = server.authConfiguration, savedClient = server.createRequestClient;
  try {
    server.authConfiguration = () => ({ configured: true, passwordEnabled: false, googleEnabled: true });
    server.createRequestClient = () => ({
      client: {
        auth: { getUser: async () => ({ data: { user: { id: 'actor', email: 'private@example.com', user_metadata: { full_name: 'Real Name' } } }, error: null }) },
        rpc: async () => ({ data: { displayName: 'Cinema Fan' }, error: null }),
      },
      applyCookies: value => value,
    });
    const response = await GET(new Request('https://triggerboxd.com/api/auth/session/'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.user, { id: 'actor', nickname: 'Cinema Fan', needsNickname: true });
    assert.doesNotMatch(JSON.stringify(body), /private@example.com|Real Name/);
  } finally { server.authConfiguration = savedConfig; server.createRequestClient = savedClient; }
});

test('nickname mutation requires verified CSRF, validates input and updates only current account', async () => {
  const server = load('src/lib/supabase/server.ts');
  const { POST } = load('src/app/api/v1/me/nickname/route.ts');
  const savedClient = server.createRequestClient;
  const calls = [];
  let signedIn = true;
  try {
    server.createRequestClient = () => ({
      client: {
        auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'verified-user', is_anonymous: false } : null }, error: null }) },
        from: table => { calls.push(['from', table]); return {
          update: value => { calls.push(['update', value]); return {
            eq: (column, value) => { calls.push(['eq', column, value]); return {
              select: () => ({ single: async () => ({ data: { display_name: 'Cinema Fan' }, error: null }) }),
            }; },
          }; },
        }; },
      }, applyCookies: value => value,
    });
    const request = (nickname, csrf = 'a'.repeat(48), extras = {}) => new Request('https://triggerboxd.com/api/v1/me/nickname/', {
      method: 'POST', headers: { origin: 'https://triggerboxd.com', 'content-type': 'application/json', cookie: `tb-csrf=${csrf}`, 'x-csrf-token': csrf }, body: JSON.stringify({ nickname, ...extras }),
    });
    assert.equal((await POST(request('Cinema Fan', 'bad'))).status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await POST(request('me@example.com'))).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await POST(request('Cinema Fan', undefined, { user_id: 'other-user' }))).status, 400);
    assert.equal(calls.length, 0);
    signedIn = false;
    assert.equal((await POST(request('Cinema Fan'))).status, 401);
    assert.equal(calls.length, 0);
    signedIn = true;
    const response = await POST(request('  Cinema Fan  '));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { nickname: 'Cinema Fan' });
    assert.deepEqual(calls, [['from', 'profiles'], ['update', { display_name: 'Cinema Fan', nickname_set: true }], ['eq', 'user_id', 'verified-user']]);
  } finally { server.createRequestClient = savedClient; }
});
