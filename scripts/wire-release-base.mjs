#!/usr/bin/env node
// Apply the three reviewed release-relative data URLs. Safe to run twice.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve('apps/web/src/App.tsx');
let text = await readFile(target, 'utf8');
const edits = [
  ["fetch('/data/current.json')", 'fetch(`${import.meta.env.BASE_URL}data/current.json`)'],
  ['fetch(`/data/${pointer.manifest}`)', 'fetch(`${import.meta.env.BASE_URL}data/${pointer.manifest}`)'],
  ['fetch(`/data/${release.releaseId}/${city.file}`, { signal })', 'fetch(`${import.meta.env.BASE_URL}data/${release.releaseId}/${city.file}`, { signal })'],
];
let changed = 0;
for (const [before, after] of edits) {
  const oldCount = text.split(before).length - 1;
  const newCount = text.split(after).length - 1;
  if (oldCount === 1 && newCount === 0) {
    text = text.replace(before, after);
    changed += 1;
  } else if (oldCount !== 0 || newCount !== 1) {
    throw new Error(`Expected exactly one reviewed data URL; inspect App.tsx instead of guessing: ${before}`);
  }
}
if (changed !== 0 && changed !== 3) throw new Error('Refusing a partially patched source file');
if (changed) await writeFile(target, text.replace(/\r\n/g, '\n'), 'utf8');
console.log(changed ? 'Updated all three data fetches. Run npm run format, inspect the diff and commit.' : 'All three release-relative data fetches already match.');
