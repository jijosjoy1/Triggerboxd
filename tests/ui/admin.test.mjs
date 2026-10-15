import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTypeScript} from '../auth/load-typescript.mjs';
import robots from '../../src/app/robots.ts';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');
const {AdminDashboard, SEVERITY_WORDS} = loadTypeScript(fileURLToPath(new URL('src/components/admin-dashboard.tsx', root)));

test('the admin page is noindex and is excluded from crawler surfaces', () => {
  const page = read('src/app/admin/page.tsx');
  assert.match(page, /robots:\{index:false,follow:false\}/);
  assert.match(page, /export const dynamic='force-dynamic'/);
  const rules = robots().rules;
  const rule = Array.isArray(rules) ? rules[0] : rules;
  assert.ok([].concat(rule.disallow ?? []).includes('/admin/'));
  assert.doesNotMatch(read('src/app/sitemap.ts'), /admin/i);
  assert.match(page, /await requireActiveUser\(scoped\.client\)/);
  assert.match(page, /rpc\('get_admin_overview'/);
  assert.match(page, /if \(!authorised\) notFound\(\)/);
});

test('the dashboard does not render any data before the session resolves', () => {
  const html = renderToStaticMarkup(React.createElement(AdminDashboard));
  assert.match(html, /role="status"/);
  assert.match(html, /Loading the owner summary/);
  assert.doesNotMatch(html, /Registered accounts|severity|@/i);
});

test('the dashboard severity vocabulary matches the six-level database scale', () => {
  assert.deepEqual([...SEVERITY_WORDS], ['None', 'Mild', 'Moderate', 'Severe', 'Very severe', 'Extreme']);
});

test('owner data is tied to the current session and stale requests are cancelled', () => {
  const source = read('src/components/admin-dashboard.tsx');
  assert.match(source, /useAuthSession\(\)/);
  assert.match(source, /privacyBlocked/);
  assert.match(source, /triggerboxd:account-change/);
  assert.match(source, /setView\(null\)/);
  assert.match(source, /view\?\.key === requestKey/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /if \(active\) setView/);
});

test('the dashboard source publishes only allowlisted fields', () => {
  const source = read('src/components/admin-dashboard.tsx');
  for (const forbidden of ['email', 'avatar', 'photo', 'google', 'token', 'synopsis', 'display_name']) {
    assert.doesNotMatch(source, new RegExp(forbidden, 'i'), `dashboard must not reference ${forbidden}`);
  }
  assert.match(source, /overflow-wrap:anywhere|adm-primary/);
});

test('admin styles stay within a 320px viewport', () => {
  const css = read('src/app/film-ui.css');
  for (const rule of css.matchAll(/\.adm[a-z-]*[^{}]*\{([^}]*)\}/g)) {
    for (const declaration of rule[1].split(';')) {
      const width = /(?:^|[\s:])width\s*:\s*(\d+)px/.exec(declaration);
      if (width) assert.ok(Number(width[1]) <= 320, `admin rule declares width:${width[1]}px`);
    }
  }
  assert.match(css, /@media\(max-width:400px\)\{[^@]*\.adm-tiles\{grid-template-columns:1fr\}/);
});
