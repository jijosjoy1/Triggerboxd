import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.MVP_BASE_URL??'http://127.0.0.1:4328';
const searchReady=process.env.MVP_EXPECT_SEARCH==='ready';

for(const path of ['/','/search/','/login/','/demo/','/privacy/','/about/','/moon-lagoon.png','/robots.txt','/sitemap.xml']){
  test(`local runtime serves ${path}`,async()=>{
    const response=await fetch(base+path);
    assert.equal(response.status,200);
    assert.ok((await response.arrayBuffer()).byteLength>0);
  });
}
test('auth configuration is honest, private and supplies an HttpOnly CSRF token',async()=>{
  const response=await fetch(base+'/api/auth/session/');
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control')??'',/private.*no-store/);
  const body=await response.json();
  assert.equal(typeof body.data.configured,'boolean');
  assert.equal(body.data.user,null);
  assert.equal(typeof body.data.passwordEnabled,'boolean');
  assert.match(body.data.csrfToken,/^[a-f0-9]{48}$/);
  assert.match(response.headers.get('set-cookie')??'',/HttpOnly/i);
  const rejected=await fetch(base+'/api/auth/google/',{method:'POST',headers:{'content-type':'application/json',origin:base},body:'{}'});
  assert.equal(rejected.status,403);
  const notConfigured=await fetch(base+'/api/auth/google/',{method:'POST',headers:{'content-type':'application/json',origin:base,cookie:`tb-csrf=${body.data.csrfToken}`,'x-csrf-token':body.data.csrfToken},body:'{}'});
  if(body.data.configured&&body.data.googleEnabled!==false){
    assert.equal(notConfigured.status,200);
    const next=await notConfigured.json();
    const oauth=new URL(next.data.url);
    assert.equal(oauth.protocol,'https:');
    assert.equal(new URL(oauth.searchParams.get('redirect_to')).origin,base);
  }else assert.equal(notConfigured.status,503);
});
test('movie endpoints fail explicitly rather than inventing warning data',async()=>{
  const invalid=await fetch(base+'/api/v1/movies/search/?q=a');assert.equal(invalid.status,400);
  const search=await fetch(base+'/api/v1/movies/search/?q=Kumbalangi%20Nights');
  const result=await search.json();
  if(searchReady){assert.equal(search.status,200);assert.ok(Array.isArray(result.data.results));assert.ok(result.data.results.some(movie=>movie.title==='Kumbalangi Nights'));}
  else{assert.equal(search.status,503);assert.equal(result.error.code,'SERVICE_UNAVAILABLE');assert.ok(result.error.requestId);}
  const movie=await fetch(base+'/movies/00000000-0000-4000-8000-000000000001/');
  assert.equal(movie.status,200);const html=await movie.text();assert.match(html,/noindex/);
});
test('unknown routes return 404',async()=>{
  assert.equal((await fetch(base+'/missing-mvp-page/')).status,404);
});
