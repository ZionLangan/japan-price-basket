#!/usr/bin/env node
// Package already-built static files; this does not import prices or run Vite.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';

const MAX_FILES = 10000;
const MAX_BYTES = 4 * 1024 ** 3;
const MAX_FILE_BYTES = 128 * 1024 ** 2;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
export function inventoryHash(files) {
  return createHash('sha256').update(files.map((f) => `${f.sha256}\t${f.bytes}\t${f.path}\n`).join('')).digest('hex');
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
export async function prepareRelease(root = process.cwd(), { compress = true } = {}) {
  root = resolve(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('Commit reviewed source and configuration first: Git must be clean.');
  const sourceCommit = git('rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Expected a full 40-character source commit');
  const appRelease = `app-${sourceCommit}`;
  const dist = join(root, 'dist');
  const pointer = JSON.parse(await readFile(join(dist, 'data/current.json'), 'utf8'));
  if (!/^rps-20\d{2}-(?:0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(pointer.releaseId) || pointer.manifest !== `${pointer.releaseId}/manifest.json`) throw new Error('Invalid reviewed dataset pointer');
  const manifest = JSON.parse(await readFile(join(dist, 'data', pointer.manifest), 'utf8'));
  if (manifest.releaseId !== pointer.releaseId || !/^\d+\.\d+$/.test(manifest.policyVersion) || !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(manifest.end)) throw new Error('Invalid dataset release metadata');
  const prefix = `/app-releases/${appRelease}/`;
  const index = await readFile(join(dist, 'index.html'), 'utf8');
  if (!index.includes(`${prefix}assets/`) || /(?:src|href)=["']\/assets\//.test(index)) throw new Error(`Rebuild with Vite --base=${prefix}; the index is not pinned to this commit.`);
  const source = await readFile(join(root, 'apps/web/src/App.tsx'), 'utf8');
  if ((source.match(/import\.meta\.env\.BASE_URL/g) ?? []).length < 3 || /fetch\(['"`]\/data\//.test(source)) throw new Error('Run wire-release-base.mjs, format and commit before building.');
  const found = [];
  async function walk(relative = '') {
    for (const entry of (await readdir(join(dist, relative), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (path.length > 240 || !SAFE_PATH.test(path) || path.split('/').some((p) => p === '.' || p === '..')) throw new Error(`Unsafe payload path: ${path}`);
      const stat = await lstat(join(dist, path));
      if (stat.isSymbolicLink()) throw new Error(`Payload symlinks are forbidden: ${path}`);
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile() && path !== 'release-meta.json') {
        if (stat.size > MAX_FILE_BYTES) throw new Error(`Payload file exceeds 128 MiB: ${path}`);
        found.push(path);
      } else if (!stat.isFile()) throw new Error(`Only ordinary files and directories belong in dist: ${path}`);
      if (found.length > MAX_FILES) throw new Error('Payload file count exceeds 10000');
    }
  }
  await walk();
  if (!found.includes('THIRD_PARTY_NOTICES.txt')) throw new Error('Run write_third_party_notices.mjs before packaging.');
  if (compress) {
    for (const path of found) {
      if (!/\.(?:json|js|css|svg|txt)$/.test(path) || (await lstat(join(dist, path))).size < 1024) continue;
      await pipeline(createReadStream(join(dist, path)), createGzip({ level: 6, mtime: 0 }), createWriteStream(join(dist, `${path}.gz`)));
    }
  }
  found.length = 0;
  await walk();
  found.sort();
  const files = [];
  let totalBytes = 0;
  for (const path of found) {
    const bytes = (await lstat(join(dist, path))).size;
    totalBytes += bytes;
    if (totalBytes > MAX_BYTES) throw new Error('Payload exceeds 4 GiB; review the release design.');
    files.push({ path, sha256: await sha256(join(dist, path)), bytes });
  }
  const metadata = { schemaVersion: 1, sourceCommit, appRelease, dataset: pointer.releaseId, policyVersion: manifest.policyVersion, sourceCutoff: manifest.end, payloadInventorySha256: inventoryHash(files), files };
  await writeFile(join(dist, 'release-meta.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ appRelease, dataset: metadata.dataset, sourceCommit, payloadInventorySha256: metadata.payloadInventorySha256, fileCount: files.length, totalBytes }, null, 2));
  return metadata;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await prepareRelease(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
