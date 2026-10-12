import test from 'node:test';
import assert from 'node:assert/strict';
import { createTmdbGateway } from '../../src/lib/tmdb.ts';

test('certifications use India only, deduplicate labels and preserve different cuts', async () => {
  const gateway = createTmdbGateway({accessToken:'test',fetchImpl:async url=>{
    assert.equal(new URL(url).pathname,'/3/movie/123/release_dates');
    return Response.json({results:[
      {iso_3166_1:'US',release_dates:[{certification:'R'}]},
      {iso_3166_1:'IN',release_dates:[{certification:' UA '},{certification:'UA'},{certification:'A'},{certification:''}]},
    ]});
  }});
  assert.deepEqual(await gateway.getIndianCertifications(123),['A','UA']);
});

test('missing Indian certification stays unavailable, never inferred from another country', async () => {
  const gateway = createTmdbGateway({accessToken:'test',fetchImpl:async()=>Response.json({results:[{iso_3166_1:'US',release_dates:[{certification:'PG'}]}]})});
  assert.deepEqual(await gateway.getIndianCertifications(123),[]);
});
