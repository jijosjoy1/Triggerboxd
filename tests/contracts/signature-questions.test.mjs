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

test('sexual violence verdicts are factual, distinct and humour-free at every severity', () => {
  const copy = [0, 1, 2, 3].map(severity => catalog.getSignatureVerdict('sexual-violence', severity, 0, false));
  assert.deepEqual(copy, ['No sexual violence reported.', 'Limited sexual violence content reported.', 'Moderate sexual violence content reported.', 'Severe sexual violence content reported.']);
  assert.equal(new Set(copy).size, 4);
  const merged = copy.join(' ');
  assert.doesNotMatch(merged, /biryani|John Wick|spoon|cab|hospital|grandma|remote|resign|Oscar|chat|joke|funny/i);
  // A reported absence is not the same message as "not yet rated".
  assert.notEqual(copy[0], catalog.UNRATED_VERDICT);
});

test('serious descriptors, not the question id, switch humour to factual copy', () => {
  const serious = {
    animal_harm: ['animal_death', 'animal_cruelty'],
    gore_graphic_violence: ['graphic_injury'],
    drugs: ['drug_addiction', 'overdose'],
    alcohol: ['alcohol_abuse'],
    physical_violence: ['torture', 'domestic_violence'],
    sexual_violence: ['rape', 'attempted_rape', 'sexual_coercion', 'graphic_sexual_violence'],
  };
  for (const [category, descriptors] of Object.entries(serious)) {
    assert.deepEqual([...(catalog.SERIOUS_HARM_DESCRIPTORS[category] ?? [])].sort(), [...descriptors].sort(), `${category} descriptor set`);
    for (const descriptor of descriptors) {
      assert.equal(catalog.isSeriousHarm(category, [descriptor]), true, `${category}/${descriptor} is serious`);
    }
  }
  assert.equal(catalog.isSeriousHarm('animal_harm', ['animal_distress', 'animal_injury']), false);
  assert.equal(catalog.isSeriousHarm('drugs', ['recreational_drug_use']), false);
  assert.equal(catalog.isSeriousHarm('physical_violence', ['physical_assault']), false);
  assert.equal(catalog.isSeriousHarm('nudity', ['male_nudity']), false);
  assert.equal(catalog.isSeriousHarm('animal_harm', []), false);
  assert.equal(catalog.isSeriousHarm('animal_harm', undefined), false);
});

test('serious harm switches every humorous verdict to factual intensity language', () => {
  const humour = /biryani|spoon|John Wick|John can relax|suit|drop in sight|drink or two|calling a cab|bartender|Sunday school|spicy words|subtitles|English teacher|walking away|bruises|hospital|questionable decisions|Reality has left the chat|responsible adult|Oscar|remote|WhatsApp|grandma/i;
  for (const question of catalog.signatureQuestions.slice(1)) {
    for (const severity of [1, 2, 3]) {
      const factual = catalog.getSignatureVerdict(question.id, severity, 0, true);
      assert.doesNotMatch(factual, humour);
      assert.ok(factual.length > 0);
    }
  }
});

test('ordinary reports keep the entertaining verdicts', () => {
  const playful = question => catalog.getSignatureVerdict(question, 0, 0, false);
  assert.equal(playful('biryani'), 'Eat peacefully — no graphic imagery reported.');
  assert.equal(playful('animal-harm'), 'John can relax — no animal harm reported.');
  assert.equal(playful('language'), 'Sunday school vocabulary — no profanity reported.');
  assert.equal(playful('physical-violence'), 'Everyone’s walking away — no physical violence reported.');
  assert.equal(catalog.getFamilyAwkwardnessVerdict(1, 0), 'Even grandma can join.');
  assert.equal(catalog.getSignatureVerdict('biryani', 3, 0, false), 'Even the biryani wants to leave.');
  assert.equal(catalog.getSignatureVerdict('biryani', 3, 0, true), 'Strong or sustained graphic imagery reported.');
});

test('animal severity copy describes intensity without asserting animal-death descriptors', () => {
  for (const severity of [0, 1, 2, 3]) {
    const verdict = catalog.getSignatureVerdict('animal-harm', severity, 0, false);
    assert.doesNotMatch(verdict, /death|dead|killed|fatal/i);
  }
});

test('every severity level maps to distinct four-level copy with no invented levels', () => {
  for (const question of catalog.signatureQuestions.filter(q => q.scale === 'content-severity')) {
    const playful = question.verdicts ?? question.factualVerdicts;
    const factual = question.factualVerdicts;
    assert.equal(playful?.length, 4, `${question.id} humour copy has one entry per severity`);
    assert.equal(factual?.length, 4, `${question.id} factual copy has one entry per severity`);
    assert.equal(new Set(playful).size, 4, `${question.id} severity copy is distinct per level`);
    assert.equal(new Set(factual).size, 4);
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

test('protected descriptors cannot cause jokes about possible addiction or victimisation',()=>{
  for(const category of ['drugs','alcohol','physical_violence']) {
    assert.equal(catalog.isSeriousHarm(category,[],2),true);
    assert.equal(catalog.isSeriousHarm(category,[],0),false);
  }
});
