/** Include installed runtime dependency licenses in the static deployment artifact. */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packages = new Map();

function collect(name, parent) {
  const require = createRequire(parent);
  const path = require.resolve(`${name}/package.json`);
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  const key = `${metadata.name}@${metadata.version}`;
  if (packages.has(key)) return;
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING']
    .map((file) => join(dirname(path), file))
    .find(existsSync);
  if (!license) throw new Error(`Missing runtime license text: ${key}`);
  packages.set(key, readFileSync(license, 'utf8'));
  for (const dependency of Object.keys(metadata.dependencies ?? {})) collect(dependency, path);
}

for (const name of Object.keys(app.dependencies)) collect(name, join(root, 'package.json'));
const sections = [...packages.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([key, license]) => `${key}\n${'='.repeat(key.length)}\n\n${license}`);
writeFileSync(
  join(root, 'dist/THIRD_PARTY_NOTICES.txt'),
  `Runtime dependency licenses for Japan Inflation\n\n${sections.join('\n\n')}\n`,
  'utf8',
);
console.log(`Included license texts for ${packages.size} runtime packages.`);
