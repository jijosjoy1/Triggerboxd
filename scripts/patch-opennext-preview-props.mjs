import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const adapterPackage = join(dirname(require.resolve('@opennextjs/cloudflare')), '../../package.json');
const version = JSON.parse(readFileSync(adapterPackage, 'utf8')).version;
assert.equal(version, '1.20.9', 'Review/remove the compatibility patch when changing OpenNext');
const file = join(dirname(adapterPackage), 'dist/cli/build/patches/plugins/load-manifest.js');
const oldPattern = '**/{*-manifest,required-server-files,prefetch-hints}.json';
const newPattern = '**/{*-manifest,required-server-files,prefetch-hints,preview-props}.json';
const content = readFileSync(file, 'utf8');
if (content.includes(newPattern)) {
  console.log('OpenNext preview-props patch already applied');
} else {
  assert.equal(content.split(oldPattern).length, 2, 'Expected exactly one known adapter manifest glob');
  writeFileSync(file, content.replace(oldPattern, newPattern));
  console.log('Applied OpenNext 1.20.9 preview-props manifest compatibility patch');
}
