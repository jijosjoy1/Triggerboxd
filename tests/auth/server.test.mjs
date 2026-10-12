import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from './load-typescript.mjs';

const { createRequestClient, authConfiguration } = loadTypeScript(fileURLToPath(new URL('../../src/lib/supabase/server.ts', import.meta.url)));
const { requireUser, requireActiveUser } = loadTypeScript(fileURLToPath(new URL('../../src/lib/auth.ts', import.meta.url)));
const { GET: getSession } = loadTypeScript(fileURLToPath(new URL('../../src/app/api/auth/session/route.ts', import.meta.url)));
const { POST: logout } = loadTypeScript(fileURLToPath(new URL('../../src/app/api/auth/logout/route.ts', import.meta.url)));
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'test@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z' };
const fakeClient = (current, account = { status: 'active', emailVerified: true }) => ({
  auth: { getUser: async () => current }, rpc: async () => ({ data: account, error: null }),
});

test('server identity validation rejects forged or anonymous sessions', async () => {
  await assert.rejects(requireUser(fakeClient({ data: {user:null}, error:{code:'bad_jwt'} })), /AUTH_REQUIRED/);
  await assert.rejects(requireUser(fakeClient({ data: {user:{...user,is_anonymous:true}}, error:null })), /AUTH_REQUIRED/);
  assert.equal((await requireUser(fakeClient({data:{user},error:null}))).id, user.id);
});

test('active contribution actor requires current DB status and confirmed email', async () => {
  await assert.rejects(requireActiveUser(fakeClient({data:{user},error:null},{status:'suspended',emailVerified:true})), /ACCOUNT_SUSPENDED/);
  await assert.rejects(requireActiveUser(fakeClient({data:{user},error:null},{status:'active',emailVerified:false})), /EMAIL_NOT_VERIFIED/);
  await assert.rejects(requireActiveUser(fakeClient({data:{user:{...user,email_confirmed_at:undefined}},error:null})), /EMAIL_NOT_VERIFIED/);
  assert.equal((await requireActiveUser(fakeClient({data:{user},error:null}))).id,user.id);
});

test('missing config session remains honest and issues no-store CSRF; password stays disabled', async () => {
  const saved = { ...process.env };
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.ENABLE_PASSWORD_AUTH = 'true';
    const response = await getSession(new Request('https://triggerboxd.com/api/auth/session/'));
    assert.equal(response.status,200);
    const body = await response.json();
    assert.equal(body.data.user,null);
    assert.equal(body.data.configured,false);
    assert.equal(body.data.passwordEnabled,false);
    assert.match(body.data.csrfToken,/^[a-f0-9]{48}$/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
  } finally { process.env = saved; }
});

test('installed SDK cookie writes and cache headers survive a consumed request body', async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.example.test';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
    delete process.env.ENABLE_PASSWORD_AUTH;
    assert.equal(authConfiguration().passwordEnabled,false);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const expires = Math.floor(Date.now()/1000)+3600;
    const token = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,exp:expires,aud:'authenticated'})}.signature`;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.origin,'https://auth.example.test');
      assert.equal(url.pathname,'/auth/v1/token');
      return Response.json({access_token:token,refresh_token:'refresh-token',token_type:'bearer',expires_in:3600,expires_at:expires,user});
    };
    const request = new Request('https://triggerboxd.com/api/auth/login/',{method:'POST',body:'{}'});
    await request.text();
    const scoped = createRequestClient(request);
    const result = await scoped.client.auth.signInWithPassword({email:user.email,password:'a-secret-password'});
    assert.equal(result.error,null);
    const response = scoped.applyCookies(Response.json({data:{ok:true}}));
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.some(value => value.startsWith('sb-auth-auth-token=')));
    assert.ok(cookies.every(value => /httponly/i.test(value) && /secure/i.test(value) && /samesite=lax/i.test(value)));
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(response.headers.get('pragma'),'no-cache');
    assert.equal(response.headers.get('expires'),'0');
  } finally { globalThis.fetch = originalFetch; process.env = saved; }
});

test('logout rejects missing CSRF before any provider request', async () => {
  const response = await logout(new Request('https://triggerboxd.com/api/auth/logout/',{method:'POST',headers:{origin:'https://triggerboxd.com','content-type':'application/json'},body:'{}'}));
  assert.equal(response.status,403);
  assert.equal((await response.json()).error.code,'FORBIDDEN');
});
