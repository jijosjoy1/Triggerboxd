import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const build = mkdtempSync(path.join(tmpdir(), 'triggerboxd-signature-questions-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'src/lib/signature-questions.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
writeFileSync(path.join(build, 'signature-questions.js'), compiled.outputText);
const catalog = require(path.join(build, 'signature-questions.js'));
process.on('exit', () => rmSync(build, { recursive: true, force: true }));

test('catalog has eight questions with the first five visible', () => {
  assert.equal(catalog.signatureQuestions.length, 8);
  assert.deepEqual(catalog.signatureQuestions.map(question => question.initiallyVisible), [true, true, true, true, true, false, false, false]);
  assert.equal(new Set(catalog.signatureQuestions.map(question => question.id)).size, 8);
});

test('content severity is a four-level scale and family awkwardness is a separate five-level scale', () => {
  assert.deepEqual(catalog.CONTENT_SEVERITIES, ['None', 'Mild', 'Moderate', 'Severe']);
  assert.deepEqual(catalog.FAMILY_AWKWARDNESS_LEVELS, [1, 2, 3, 4, 5]);
  assert.equal(catalog.signatureQuestions[0].scale, 'family-awkwardness');
  assert.ok(catalog.signatureQuestions.slice(1).every(question => question.scale === 'content-severity'));
});

test('missing assessments always produce neutral unrated text', () => {
  for (const question of catalog.signatureQuestions) {
    assert.equal(catalog.getSignatureVerdict(question.id, null, 0, false), 'Not yet rated');
  }
  assert.equal(catalog.getFamilyAwkwardnessVerdict(null, 0), 'Not yet rated');
});

test('family awkwardness has five independent labels and never derives from content severity', () => {
  const labels = [1, 2, 3, 4, 5].map(level => catalog.getFamilyAwkwardnessVerdict(level, 0));
  assert.equal(new Set(labels).size, 5);
  assert.equal(catalog.getSignatureVerdict('parents', 3, 0, false), 'Not yet rated');
  assert.equal(catalog.getFamilyAwkwardnessVerdict(5, 0, true), 'Community family-awkwardness rating: 5 of 5.');
});

test('category spoilers return the same neutral placeholder before any content mapping', () => {
  const expected = 'Additional spoiler-sensitive information available.';
  for (const question of catalog.signatureQuestions) {
    assert.equal(catalog.getSignatureVerdict(question.id, 3, 2, true), expected);
  }
  assert.equal(catalog.getFamilyAwkwardnessVerdict(5, 2), expected);
});

test('description spoilers hide the verdict text', () => {
  assert.equal(catalog.getSignatureVerdict('gore', 3, 1, false), 'Details hidden to avoid spoilers.');
});

test('sexual violence verdicts are factual at every severity', () => {
  for (const severity of [0, 1, 2, 3]) {
    const verdict = catalog.getSignatureVerdict('sexual-violence', severity, 0, false);
    assert.match(verdict, /reported|limited|moderate|high/i);
    assert.doesNotMatch(verdict, /Oscar|remote|chat|joke|funny/i);
  }
});

test('serious harm switches every humorous verdict to factual intensity language', () => {
  for (const question of catalog.signatureQuestions.slice(1)) {
    for (const severity of [1, 2, 3]) {
      const factual = catalog.getSignatureVerdict(question.id, severity, 0, true);
      assert.doesNotMatch(factual, /Oscar|biryani|chat|resign|remote|English teacher|dinner/i);
    }
  }
});

test('animal severity copy describes intensity without asserting animal-death descriptors', () => {
  for (const severity of [0, 1, 2, 3]) {
    const verdict = catalog.getSignatureVerdict('animal-harm', severity, 0, false);
    assert.doesNotMatch(verdict, /death|dead|killed|fatal/i);
  }
});

test('invalid IDs, severity values and spoiler levels fail closed', () => {
  assert.equal(catalog.getSignatureVerdict('not-a-question', 3, 0, false), 'Not yet rated');
  for (const severity of [-1, 4, 1.5, '3']) {
    assert.equal(catalog.getSignatureVerdict('gore', severity, 0, false), 'Not yet rated');
  }
  for (const level of [-1, 3, 1.5]) {
    assert.equal(catalog.getSignatureVerdict('gore', 3, level, false), 'Additional spoiler-sensitive information available.');
  }
  assert.equal(catalog.getFamilyAwkwardnessVerdict(6, 0), 'Not yet rated');
});
