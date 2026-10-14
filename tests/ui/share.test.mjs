import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTypeScript } from '../auth/load-typescript.mjs';

const { MovieShare, movieShareUrl, whatsappShareUrl, redditShareUrl, SHARE_ORIGIN } = loadTypeScript(
  fileURLToPath(new URL('../../src/components/movie-share.tsx', import.meta.url)),
);
const css = readFileSync(fileURLToPath(new URL('../../src/app/mvp.css', import.meta.url)), 'utf8');

const ID = 'b43dd8a6-1e0f-4a6c-9a1f-0f4a8b0e2c11';
const CANONICAL = `https://triggerboxd.com/movies/${encodeURIComponent(ID)}/`;

test('canonical movie link keeps the trailing slash and is encoded', () => {
  assert.equal(movieShareUrl(ID), CANONICAL);
  assert.equal(movieShareUrl('odd value/../id'), `${SHARE_ORIGIN}/movies/odd%20value%2F..%2Fid/`);
  assert.equal(SHARE_ORIGIN, 'https://triggerboxd.com');
});

test('WhatsApp and Reddit targets carry only the title and the link', () => {
  const what = whatsappShareUrl(CANONICAL, 'Kayattam');
  const reddit = redditShareUrl(CANONICAL, 'Kayattam');
  assert.equal(what, `https://wa.me/?text=${encodeURIComponent(`Kayattam ${CANONICAL}`)}`);
  assert.equal(reddit, `https://www.reddit.com/submit?url=${encodeURIComponent(CANONICAL)}&title=${encodeURIComponent('Kayattam')}`);
  assert.match(what, /^https:\/\/wa\.me\/\?text=/);
  assert.match(reddit, /^https:\/\/www\.reddit\.com\/submit\?url=/);
  assert.doesNotMatch(what, /warning|severity|spoiler/i);
});

test('share markup is compact, labelled and keyboard reachable', () => {
  const html = renderToStaticMarkup(React.createElement(MovieShare, { movieId: ID, title: 'Kayattam' }));
  assert.match(html, /class="mvp-share-trigger"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /<button type="button"[^>]*>Share<\/button>/);
  assert.match(html, /<dialog/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  assert.match(html, /<h2[^>]*>Share this film<\/h2>/);
  assert.doesNotMatch(html, /<dialog[^>]*\sopen[\s>]/);
});

test('share payload exposes only the canonical link and the two targets', () => {
  const html = renderToStaticMarkup(React.createElement(MovieShare, { movieId: ID, title: 'Kayattam' }));
  assert.match(html, /Canonical film link/);
  assert.equal(html.match(/value="([^"]*)"/)?.[1], CANONICAL);
  const anchors = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
  assert.equal(anchors.length, 2);
  assert.equal(anchors[0], whatsappShareUrl(CANONICAL, 'Kayattam'));
  assert.equal(anchors[1], redditShareUrl(CANONICAL, 'Kayattam'));
  assert.equal((html.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
});

test('passing a movie object into props cannot leak content data', () => {
  const html = renderToStaticMarkup(React.createElement(MovieShare, {
    movieId: ID,
    title: 'Kayattam',
    warnings: [{ category: 'gore_graphic_violence', severity: 3, count: 9, descriptors: ['animal_death'] }],
    synopsis: 'A former thief buries a body.',
    contributorCount: 42,
    rating: 8.7,
  }));
  for (const leak of ['Severe', 'gore', 'animal', 'buries', 'contributor', '8.7', 'spoiler', 'Synopsis']) {
    assert.doesNotMatch(html, new RegExp(leak, 'i'), `Share output must not contain ${leak}`);
  }
  assert.doesNotMatch(html, /Instagram/i);
});

test('non-identifier movie ids are not shareable', () => {
  const html = renderToStaticMarkup(React.createElement(MovieShare, { movieId: 'not-a-uuid', title: 'Kayattam' }));
  assert.match(html, /<button type="button" class="mvp-share-trigger"[^>]*disabled/);
});

test('share styles never exceed a 320px viewport width', () => {
  for (const declaration of css.matchAll(/(?:^|[;}{])\s*(\.mvp-share[a-z-]*)[^{}]*\{([^}]*)\}/g)) {
    for (const rule of declaration[2].split(';')) {
      const width = /(?:^|[\s:])width\s*:\s*(\d+(?:\.\d+)?)px/.exec(rule);
      if (width) assert.ok(Number(width[1]) <= 320, `${declaration[1]} declares width:${width[1]}px which overflows 320px`);
    }
  }
  assert.match(css, /\.mvp-share\{[^}]*width:min\(360px,calc\(100vw - 32px\)\)/);
  assert.match(css, /\.mvp-share\{[^}]*overflow-x:hidden/);
  assert.match(css, /@media\(max-width:650px\)\{[^@]*\.mvp-share\{[^}]*bottom:0[^}]*width:100%[^}]*max-width:100%[^}]*max-height:calc\(100dvh - 24px\)/);
  assert.match(css, /@media\(max-width:650px\)\{[^@]*\.mvp-share-panel\{[^}]*border-radius:16px 16px 0 0/);
});

test('default Story preview has no separate make-card action and waits for saved rating',()=>{
 const {MovieStory}=loadTypeScript(fileURLToPath(new URL('../../src/components/movie-story.tsx',import.meta.url)));
 const html=renderToStaticMarkup(React.createElement(MovieStory,{movieId:ID,title:'Khalifa',defaultOpen:true}));
 assert.match(html,/<canvas/);assert.match(html,/Loading your saved rating/);
 assert.doesNotMatch(html,/Make an awkwardness|aria-expanded/);
 assert.match(html,/Share Story card/);
});
