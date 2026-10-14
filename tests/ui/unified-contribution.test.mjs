import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypeScript } from '../auth/load-typescript.mjs';

const { editRating, saveChangedCategories, PartialSaveError, RetryKeys } = loadTypeScript('src/lib/unified-contribution-save.ts');
const draft = (severity, descriptors = [], spoilerLevel = 0) => ({ severity, descriptors, spoilerLevel });

test('a new rating can be cleared and a saved rating can only be reset locally', () => {
  const newChoice = editRating({}, 'nudity', draft(0));
  assert.deepEqual(newChoice, { nudity: draft(0) });
  assert.deepEqual(editRating(newChoice, 'nudity', null), {});
  const saved = { category: 'nudity', severity: 2, descriptors: ['partial_nudity'], spoilerLevel: 1 };
  const changed = editRating({}, 'nudity', draft(3), saved);
  assert.deepEqual(editRating(changed, 'nudity', null, saved), {});
  assert.deepEqual(editRating(changed, 'nudity', draft(2, ['partial_nudity'], 1), saved), {});
  assert.deepEqual(saved, { category: 'nudity', severity: 2, descriptors: ['partial_nudity'], spoilerLevel: 1 });
});

test('changed categories PATCH sequentially with each returned revision and leave other metadata alone', async () => {
  const original = { revision: 7, watched: true, ratings: [
    { category: 'nudity', severity: 1, spoilerLevel: 2, descriptors: ['brief_nudity'] },
    { category: 'alcohol', severity: 3, spoilerLevel: 1, descriptors: ['alcohol_abuse'] },
  ] };
  const calls = []; const cleared = [];
  const result = await saveChangedCategories(['nudity', 'drugs', 'alcohol'], { nudity: draft(2, ['brief_nudity'], 2), drugs: draft(0) }, original,
    async (slug, change, revision) => {
      calls.push({ slug, change, revision });
      return { revision: revision + 13, watched: true, ratings: [
        ...original.ratings.filter(r => r.category !== slug), { category: slug, ...change },
      ] };
    }, (slug) => cleared.push(slug), () => true);
  assert.deepEqual(calls.map(c => [c.slug, c.revision]), [['nudity', 7], ['drugs', 20]]);
  assert.deepEqual(cleared, ['nudity', 'drugs']);
  assert.equal(result.completed, 2);
  assert.deepEqual(result.contribution.ratings.find(r => r.category === 'alcohol'), original.ratings[1]);
});

test('partial API failure reports completed changes and preserves the remaining draft', async () => {
  const drafts = { nudity: draft(1), drugs: draft(2), alcohol: draft(3) };
  const saved = []; let calls = 0;
  await assert.rejects(saveChangedCategories(['nudity', 'drugs', 'alcohol'], drafts, null,
    async (slug, change, revision) => {
      calls++;
      if (slug === 'drugs') throw new Error('Rate limit reached');
      return { revision: revision + 9, watched: true, ratings: [{ category: slug, ...change }] };
    }, slug => { saved.push(slug); delete drafts[slug]; }, () => true),
  error => error instanceof PartialSaveError && error.completed === 1 && /Rate limit/.test(error.message));
  assert.equal(calls, 2);
  assert.deepEqual(saved, ['nudity']);
  assert.deepEqual(Object.keys(drafts), ['drugs', 'alcohol']);
});

test('account or movie switch interrupts the remaining requests', async () => {
  let current = true; const calls = [];
  const result = await saveChangedCategories(['nudity', 'drugs'], { nudity: draft(1), drugs: draft(2) }, null,
    async slug => { calls.push(slug); current = false; return { revision: 3, watched: true, ratings: [] }; },
    () => assert.fail('stale response must not update visible state'), () => current);
  assert.equal(result.interrupted, true);
  assert.deepEqual(calls, ['nudity']);
});

test('an uncertain retry keeps its key for the exact body and a changed body gets a new key', () => {
  let issued = 0;
  const keys = new RetryKeys(() => `key-${++issued}`);
  const first = '/warnings:PATCH:{"expectedRevision":7,"category":"nudity"}';
  const changed = '/warnings:PATCH:{"expectedRevision":8,"category":"nudity"}';
  assert.equal(keys.get(first), 'key-1');
  assert.equal(keys.get(first), 'key-1');
  assert.equal(keys.get(changed), 'key-2');
  keys.confirmed(first);
  assert.equal(keys.get(first), 'key-3');
  keys.clear();
  assert.equal(keys.get(changed), 'key-4');
});
