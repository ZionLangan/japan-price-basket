#!/usr/bin/env node
/** Fail closed if the downloaded CI artifact differs from its tested inventory. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inventoryHash } from './prepare-release.mjs';

const root = resolve(process.argv[2] ?? 'dist');
const expectedCommit = process.argv[3];
const meta = JSON.parse(await readFile(join(root, 'release-meta.json'), 'utf8'));
if (meta.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(meta.sourceCommit) || meta.appRelease !== `app-${meta.sourceCommit}`) throw new Error('Invalid release identity');
if (expectedCommit && meta.sourceCommit !== expectedCommit) throw new Error('Artifact source commit mismatch');
if (!Array.isArray(meta.files) || meta.files.length > 10000 || inventoryHash(meta.files) !== meta.payloadInventorySha256) throw new Error('Invalid inventory checksum');
const expected = new Set(['release-meta.json']);
let total = 0;
for (const file of meta.files) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(file.path) || file.path.split('/').some((piece) => piece === '.' || piece === '..') || expected.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 128 * 1024 ** 2) throw new Error('Invalid inventory record');
  expected.add(file.path);
  const stat = await lstat(join(root, file.path));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes) throw new Error(`Artifact size/type mismatch: ${file.path}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(root, file.path))) hash.update(chunk);
  if (hash.digest('hex') !== file.sha256) throw new Error(`Artifact hash mismatch: ${file.path}`);
  total += stat.size;
  if (total > 4 * 1024 ** 3) throw new Error('Artifact exceeds 4 GiB');
}
async function walk(relative = '') {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(name);
    else if (!entry.isFile() || !expected.has(name)) throw new Error(`Unexpected artifact file/type: ${name}`);
  }
}
await walk();
console.log(JSON.stringify({ appRelease: meta.appRelease, dataset: meta.dataset, files: meta.files.length, totalBytes: total, inventorySha256: meta.payloadInventorySha256 }));
