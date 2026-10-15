import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTypeScript} from '../auth/load-typescript.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');
const {Wordmark} = loadTypeScript(fileURLToPath(new URL('src/components/wordmark.tsx', root)));

test('wordmark splits into a white "Trigger" and a brand-red "boxd"', () => {
  const html = renderToStaticMarkup(React.createElement(Wordmark));
  assert.equal(html, '<span class="wordmark-trigger">Trigger</span><span class="wordmark-boxd">boxd</span>');
  assert.equal(html.replace(/<[^>]+>/g, ''), 'Triggerboxd');
});

test('wordmark styles use the story-card colours without repainting the palette', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /\.wordmark-trigger\{color:#fff\}/);
  assert.match(css, /\.wordmark-boxd\{color:#EF233C\}/);
  // The rest of the visible palette is untouched.
  assert.match(css, /--accent:#b7a0ff/);
  assert.match(css, /--text:#f3efdf/);
});

test('header and footer keep the accessible name and links', () => {
  const layout = read('src/app/layout.tsx');
  assert.equal((layout.match(/aria-label="Triggerboxd home"/g) ?? []).length, 2);
  assert.equal((layout.match(/<Wordmark\/>/g) ?? []).length, 2);
  assert.match(layout, /<Link className="wordmark" href="\/" aria-label="Triggerboxd home"><Wordmark\/><\/Link>/);
  assert.match(layout, /<Link className="wordmark small" href="\/" aria-label="Triggerboxd home"><Wordmark\/><\/Link>/);
  assert.doesNotMatch(layout, />Triggerboxd</);
});

test('the story-card renderer keeps its own wordmark drawing untouched', () => {
  const card = read('src/lib/story-card.ts');
  assert.match(card, /ctx\.fillStyle='#FFFFFF';ctx\.fillText\('trigger'/);
  assert.match(card, /ctx\.fillStyle='#EF233C';ctx\.fillText\('boxd'/);
});
