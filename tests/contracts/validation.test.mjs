import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use the repository's TypeScript compiler; no extra test dependency or package edit.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const build = mkdtempSync(path.join(tmpdir(), 'triggerboxd-contracts-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const name of ['contracts', 'validation']) {
  const source = readFileSync(path.join(root, 'src/lib', `${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  writeFileSync(path.join(build, `${name}.js`), compiled.outputText);
}
const v = require(path.join(build, 'validation.js'));
process.on('exit', () => rmSync(build, { recursive: true, force: true }));
const valid = { expectedRevision: 0, watched: true, ratings: [{ category: 'nudity', severity: 0 }] };

test('explicit zero persists and unanswered categories are absent', () => {
  assert.deepEqual(v.parseContributionInput(valid), valid);
});
test('notes and privilege fields are rejected even when null', () => {
  for (const field of ['note', 'userId', 'visibility', 'role']) {
    assert.throws(() => v.parseContributionInput({ ...valid, [field]: null }), v.ValidationError);
  }
});
test('replacement requires a nonempty bounded unique category set', () => {
  for (const ratings of [[], Array(7).fill(valid.ratings[0]), [valid.ratings[0], valid.ratings[0]], [{ category: 'unknown', severity: 0 }]]) {
    assert.throws(() => v.parseContributionInput({ ...valid, ratings }), v.ValidationError);
  }
});
test('severity is an integer, never a coerced string, boolean, null or fraction', () => {
  for (const severity of ['0', false, null, 1.5, -1, 4, NaN, Infinity]) {
    assert.throws(() => v.parseContributionInput({ ...valid, ratings: [{ category: 'nudity', severity }] }), v.ValidationError);
  }
});
test('watch confirmation is exact true', () => {
  for (const watched of [false, 'true', 1, null]) {
    assert.throws(() => v.parseContributionInput({ ...valid, watched }), error => error.code === 'WATCH_CONFIRMATION_REQUIRED');
  }
});
test('stale revision tokens cannot lose precision or accept coercion', () => {
  for (const expectedRevision of [-1, '1', 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => v.parseContributionInput({ ...valid, expectedRevision }), v.ValidationError);
  }
  assert.throws(() => v.parseDeleteContributionInput({ expectedRevision: 0 }), v.ValidationError);
});
test('import accepts only a positive safe TMDb ID', () => {
  assert.deepEqual(v.parseImportMovieInput({ tmdbId: 42 }), { tmdbId: 42 });
  for (const body of [{ tmdbId: 0 }, { tmdbId: '42' }, { tmdbId: 42, title: 'Spoof' }]) {
    assert.throws(() => v.parseImportMovieInput(body), v.ValidationError);
  }
});
test('idempotency keys are bounded and exclude whitespace or injection text', () => {
  assert.equal(v.parseIdempotencyKey('01234567-89ab-cdef'), '01234567-89ab-cdef');
  for (const key of ['', 'short', 'contains spaces', 'a'.repeat(129), 'key\n01234567', '0123456789\n']) {
    assert.throws(() => v.parseIdempotencyKey(key), v.ValidationError);
  }
});
test('Unicode search survives normalization and page depth stays bounded', () => {
  assert.deepEqual(v.parseSearchInput('  മലയാളം  സിനിമ  ', '2'), { query: 'മലയാളം സിനിമ', page: 2 });
  for (const page of ['0', '21', '1.0', '1e1', '01', '1\n', 1]) assert.throws(() => v.parseSearchInput('movie', page), v.ValidationError);
  assert.throws(() => v.parseSearchInput('x'), v.ValidationError);
});
