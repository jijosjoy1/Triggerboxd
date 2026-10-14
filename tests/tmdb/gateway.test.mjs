import test from "node:test";
import assert from "node:assert/strict";
import { createTmdbGateway, TmdbError, tmdbPosterUrl } from "../../src/lib/tmdb.ts";

const searchResponse = (overrides = {}) => new Response(JSON.stringify({
  page: 1,
  total_pages: 2,
  results: [{
    id: 123,
    title: "Kantara",
    original_title: "ಕಾಂತಾರ",
    release_date: "2022-09-30",
    original_language: "kn",
    poster_path: "/poster.jpg",
  }],
  ...overrides,
}), { status: 200, headers: { "content-type": "application/json" } });

test('explicit adult search results are excluded even if upstream filtering fails',async()=>{
  const gateway=createTmdbGateway({accessToken:'test-token',fetchImpl:async()=>searchResponse({results:[{id:7,title:'Excluded',original_title:'Excluded',adult:true}]})});
  assert.deepEqual((await gateway.searchMovies({query:'Film'})).results,[]);
});

test('movie details must match the selected authoritative ID',async()=>{
  const gateway=createTmdbGateway({accessToken:'test-token',fetchImpl:async()=>Response.json({id:8,title:'Other film',original_title:'Other film',adult:false})});
  await assert.rejects(gateway.getMovieDetails(7),error=>error.code==='UPSTREAM_ERROR');
});

test("search validates bounds and sends Unicode, adult exclusion, page, and bearer token", async () => {
  let requested;
  const gateway = createTmdbGateway({
    accessToken: "server-token",
    fetchImpl: async (url, init) => { requested = { url: new URL(url), init }; return searchResponse(); },
  });

  const page = await gateway.searchMovies({ query: "  ಕಾಂತಾರ  ", page: 1 });
  assert.equal(requested.url.origin, "https://api.themoviedb.org");
  assert.equal(requested.url.pathname, "/3/search/movie");
  assert.equal(requested.url.searchParams.get("query"), "ಕಾಂತಾರ");
  assert.equal(requested.url.searchParams.get("page"), "1");
  assert.equal(requested.url.searchParams.get("include_adult"), "false");
  assert.equal(requested.init.headers.Authorization, "Bearer server-token");
  assert.deepEqual(page.results[0], {
    tmdbId: 123, title: "Kantara", originalTitle: "ಕಾಂತಾರ", year: 2022, language: "kn", posterPath: "/poster.jpg",
  });
  assert.equal(page.hasMore, true);

  await assert.rejects(gateway.searchMovies({ query: "x" }), (error) => error.code === "INVALID_REQUEST");
  await assert.rejects(gateway.searchMovies({ query: "valid", page: 21 }), (error) => error.code === "INVALID_REQUEST");
});

test("poster URLs use the fixed HTTPS image host and reject unsafe paths", () => {
  assert.equal(tmdbPosterUrl("/abc.jpg"), "https://image.tmdb.org/t/p/w342/abc.jpg");
  assert.equal(tmdbPosterUrl(null), null);
  assert.equal(tmdbPosterUrl("//attacker.example/a.jpg"), null);
  assert.equal(tmdbPosterUrl("/../secret"), null);
});

test("details are authoritative, and adult entries are rejected", async () => {
  let payload = {
    id: 7, title: "Film", original_title: "Film Original", release_date: "2020-01-01",
    original_language: "en", poster_path: null, adult: false, overview: "Synopsis",
    production_countries: [{ iso_3166_1: "IN", name: "India" }],
  };
  const gateway = createTmdbGateway({
    accessToken: "token",
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/3/movie/7");
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  assert.deepEqual(await gateway.getMovieDetails(7), {
    tmdbId: 7, title: "Film", originalTitle: "Film Original", year: 2020, language: "en", posterPath: null,
    adult: false, releaseDate: "2020-01-01", overview: "Synopsis", productionCountries: ["IN"],
  });
  payload = { ...payload, adult: true };
  await assert.rejects(gateway.getMovieDetails(7), (error) => error.code === "MOVIE_NOT_SUPPORTED");
});

test("404 and 429 map to safe errors, exposing retry timing without sleeping", async () => {
  const notFound = createTmdbGateway({ accessToken: "token", fetchImpl: async () => new Response("private upstream text", { status: 404 }) });
  await assert.rejects(notFound.getMovieDetails(9), (error) => error.code === "NOT_FOUND" && !error.message.includes("private"));

  let calls = 0;
  const limited = createTmdbGateway({
    accessToken: "token",
    fetchImpl: async () => { calls += 1; return new Response("", { status: 429, headers: { "Retry-After": "17" } }); },
  });
  await assert.rejects(limited.searchMovies({ query: "film" }), (error) => error.code === "RATE_LIMITED" && error.retryAfterSeconds === 17);
  assert.equal(calls, 1);
});

test("retries one transient failure, then stops", async () => {
  let calls = 0;
  const gateway = createTmdbGateway({
    accessToken: "token",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 503 }) : searchResponse();
    },
  });
  assert.equal((await gateway.searchMovies({ query: "film" })).results.length, 1);
  assert.equal(calls, 2);

  calls = 0;
  const failed = createTmdbGateway({ accessToken: "token", fetchImpl: async () => { calls += 1; return new Response("", { status: 503 }); } });
  await assert.rejects(failed.searchMovies({ query: "film" }), (error) => error.code === "UPSTREAM_ERROR");
  assert.equal(calls, 2);
});

test("optional cache is bounded and expires after its TTL", async () => {
  let now = 100;
  let calls = 0;
  const gateway = createTmdbGateway({
    accessToken: "token", now: () => now, searchCache: { enabled: true, maxEntries: 1, ttlMs: 10 },
    fetchImpl: async () => { calls += 1; return searchResponse(); },
  });
  await gateway.searchMovies({ query: "one" });
  await gateway.searchMovies({ query: "one" });
  assert.equal(calls, 1);
  await gateway.searchMovies({ query: "two" });
  await gateway.searchMovies({ query: "one" });
  assert.equal(calls, 3);
  now += 11;
  await gateway.searchMovies({ query: "one" });
  assert.equal(calls, 4);
});

test("aborted upstream requests become timeout errors", async () => {
  const gateway = createTmdbGateway({
    accessToken: "token", timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(gateway.searchMovies({ query: "film" }), (error) => error instanceof TmdbError && error.code === "UPSTREAM_TIMEOUT");
});

test('recent releases use bounded Indian discovery and discard future, adult and invalid artwork records',async()=>{
  let url;
  const base={id:1,title:'Recent',original_title:'Recent',adult:false,release_date:'2026-10-01',original_language:'ml',poster_path:'/poster.jpg'};
  const gateway=createTmdbGateway({accessToken:'token',now:()=>Date.UTC(2026,9,14),fetchImpl:async input=>{url=new URL(input);return Response.json({results:[base,base,{...base,id:2,adult:true},{...base,id:3,release_date:'2027-01-01'},{...base,id:4,release_date:'2020-01-01'},{...base,id:5,poster_path:'//evil.example/img'}]});}});
  const films=await gateway.getRecentMovies();
  assert.equal(url.pathname,'/3/discover/movie');
  assert.equal(url.searchParams.get('with_origin_country'),'IN');
  assert.equal(url.searchParams.get('primary_release_date.lte'),'2026-10-14');
  assert.equal(url.searchParams.get('include_adult'),'false');
  assert.equal(films.length,1);
  assert.equal(films[0].tmdbId,1);
  assert.equal('overview' in films[0],false);
});
