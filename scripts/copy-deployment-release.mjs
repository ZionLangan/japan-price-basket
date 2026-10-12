#!/usr/bin/env node
/** Add an immutable rendered release, then replace only the reviewed root selector. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.argv.length !== 4) throw new Error('Usage: node scripts/copy-deployment-release.mjs .local/deployment/render-directory ops/kubernetes/production');
const source = resolve(process.argv[2], 'production');
const destination = resolve(process.argv[3]);
if (destination !== resolve('ops/kubernetes/production')) throw new Error('Destination must be this repository ops/kubernetes/production directory');
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
for (const path of [resolve('ops'), resolve('ops/kubernetes'), destination, join(destination, 'releases')]) {
  if (await exists(path)) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Destination parent must be an ordinary directory: ${path}`);
  }
}
const releases = await readdir(join(source, 'releases'), { withFileTypes: true });
if (releases.length !== 1 || !releases[0].isDirectory() || !/^app-[a-f0-9]{40}$/.test(releases[0].name)) throw new Error('Render must contain exactly one ordinary immutable app release directory');
const name = releases[0].name;
const from = join(source, 'releases', name);
const to = join(destination, 'releases', name);
const descriptor = JSON.parse(await readFile(join(from, 'release.json'), 'utf8'));
if (descriptor.appRelease !== name || descriptor.sourceCommit !== name.slice(4) || !/^ghcr\.io\/zionlangan\/japan-price-basket@sha256:[a-f0-9]{64}$/.test(descriptor.image)) throw new Error('Rendered release identity mismatch');
async function inventory(root, relative = '', records = []) {
  for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) || entry.isSymbolicLink()) throw new Error(`Unsafe configuration path: ${path}`);
    if (entry.isDirectory()) await inventory(root, path, records);
    else if (entry.isFile()) {
      const bytes = await readFile(join(root, path));
      if (bytes.length > 256 * 1024 || records.length >= 100) throw new Error('Rendered configuration exceeds the bounded copy limit');
      records.push({ path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
    } else throw new Error(`Configuration must contain ordinary files: ${path}`);
  }
  return records;
}
const files = await inventory(from);
if (await exists(to)) {
  const stat = await lstat(to);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Existing release path must be an ordinary directory');
  const current = await inventory(to);
  if (JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 }))) !== JSON.stringify(current.map(({ path, sha256 }) => ({ path, sha256 })))) throw new Error('Refusing to replace different bytes in an immutable deployment release path');
  console.log(`Existing immutable release is identical: ${name}`);
} else {
  await mkdir(join(destination, 'releases'), { recursive: true });
  // Create each new path exclusively. A failed copy stays visible for inspection;
  // this helper deliberately never recursively deletes any operator directory.
  await mkdir(to);
  for (const file of files) {
    const pieces = file.path.split('/');
    await mkdir(join(to, ...pieces.slice(0, -1)), { recursive: true });
    await writeFile(join(to, file.path), file.bytes, { flag: 'wx' });
  }
  console.log(`Added immutable deployment release: ${name}`);
}
for (const file of ['kustomization.yaml', 'orchestration.yaml']) {
  const target = join(destination, file);
  if (await exists(target) && (await lstat(target)).isSymbolicLink()) throw new Error(`Mutable selector must not be a symlink: ${file}`);
  const bytes = await readFile(join(source, file));
  if (bytes.length > 128 * 1024) throw new Error('Selector exceeds copy bound');
  if (file === 'orchestration.yaml' && !bytes.toString('utf8').includes(`/releases/${name}/`)) throw new Error('Orchestration does not select this release');
  const temporary = `${target}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, target);
}
console.log('Root selector updated. Inspect git diff and create a reviewed promotion PR; nothing was deployed.');
