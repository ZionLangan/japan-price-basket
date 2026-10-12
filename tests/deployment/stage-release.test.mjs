// Synthetic non-price release. Exercises disk staging, not a Docker runtime.
// On Windows pass JBP_BASH and JBP_JQ_DIR for Git Bash and an approved jq binary.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inventoryHash } from '../../scripts/prepare-release.mjs';

const scripts = fileURLToPath(new URL('../../ops/containers/', import.meta.url));
const bash = process.env.JBP_BASH ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const posix = (path) => process.platform === 'win32' ? '/' + path[0].toLowerCase() + path.slice(2).replaceAll('\\', '/') : path;
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
let canRun = true;
try {
  const path = process.env.JBP_JQ_DIR ? `export PATH=${quote(posix(process.env.JBP_JQ_DIR))}:$PATH; ` : '';
  execFileSync(bash, ['-c', path + 'command -v jq >/dev/null && jq --version'], { stdio: 'pipe' });
} catch { canRun = false; }

test('staging is exact, add-only, repeatable and refuses wrong images, corruption and stale locks', { skip: !canRun && 'bash plus jq required; use Linux CI or approved local tools' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jpb-stage-synthetic-'));
  const site = join(root, 'site');
  const store = join(root, 'store');
  const scratch = join(root, 'scratch');
  await mkdir(site); await mkdir(store); await mkdir(scratch);
  const sourceCommit = '1'.repeat(40);
  const appRelease = `app-${sourceCommit}`;
  const dataset = 'rps-2026-08-000000000000';
  const image = `ghcr.io/zionlangan/japan-price-basket@sha256:${'a'.repeat(64)}`;
  const payload = {
    'index.html': '<p>Synthetic non-price bytes</p>\n',
    'THIRD_PARTY_NOTICES.txt': 'Synthetic test fixture only.\n',
    'data/current.json': JSON.stringify({ releaseId: dataset }),
  };
  const files = [];
  for (const [path, text] of Object.entries(payload).sort(([a], [b]) => a < b ? -1 : 1)) {
    const full = join(site, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, text);
    files.push({ path, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) });
  }
  const metadata = { schemaVersion: 1, sourceCommit, appRelease, dataset, policyVersion: '1.2', sourceCutoff: '2026-08', payloadInventorySha256: inventoryHash(files), files };
  await writeFile(join(site, 'release-meta.json'), JSON.stringify(metadata));
  let common = (await readFile(join(scripts, 'release-common.sh'), 'utf8')).replace('INVENTORY=/tmp/', `INVENTORY=${posix(scratch)}/`);
  // Native Windows jq otherwise translates stdout to CRLF; Alpine jq uses LF.
  if (process.platform === 'win32') common = common.replaceAll('jq ', 'jq --binary ');
  const commonPath = join(root, 'release-common.sh');
  await writeFile(commonPath, common);
  let stage = (await readFile(join(scripts, 'stage-release.sh'), 'utf8'))
    .replace('. /usr/local/bin/release-common.sh', `. ${quote(posix(commonPath))}`)
    .replaceAll('/opt/site', posix(site)).replace('STORE=/srv/releases', `STORE=${quote(posix(store))}`);
  if (process.platform === 'win32') stage = stage.replaceAll('jq ', 'jq --binary ');
  const stagePath = join(root, 'stage-release.sh');
  await writeFile(stagePath, stage);
  let entrypoint = (await readFile(join(scripts, 'entrypoint.sh'), 'utf8'))
    .replace('. /usr/local/bin/release-common.sh', `. ${quote(posix(commonPath))}`)
    .replaceAll('/opt/site', posix(site)).replaceAll('/srv/releases', posix(store))
    .replaceAll('/tmp/ready', posix(join(scratch, 'ready')))
    .replaceAll('/tmp/release-root', posix(join(scratch, 'release-root')))
    .replaceAll('/tmp/release.json', posix(join(scratch, 'release.json')));
  if (process.platform === 'win32') entrypoint = entrypoint.replaceAll('jq ', 'jq --binary ');
  const entryPath = join(root, 'entrypoint.sh');
  await writeFile(entryPath, entrypoint);
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'nginx'), '#!/bin/sh\nprintf "Synthetic Nginx placeholder, not a runtime test.\\n"\n', { mode: 0o755 });
  const run = (extra = {}) => {
    const path = process.env.JBP_JQ_DIR ? `export PATH=${quote(posix(process.env.JBP_JQ_DIR))}:$PATH; ` : '';
    return execFileSync(bash, ['-c', path + `sh ${quote(posix(stagePath))}`], {
      env: { ...process.env, EXPECTED_APP_RELEASE: appRelease, EXPECTED_DATASET: dataset, EXPECTED_IMAGE: image, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  };
  const serve = (extra = {}) => {
    const toolPath = process.env.JBP_JQ_DIR ? `${quote(posix(process.env.JBP_JQ_DIR))}:` : '';
    return execFileSync(bash, ['-c', `export PATH=${quote(posix(bin))}:${toolPath}$PATH; sh ${quote(posix(entryPath))} serve-production`], {
      env: { ...process.env, EXPECTED_APP_RELEASE: appRelease, EXPECTED_DATASET: dataset, EXPECTED_IMAGE: image, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  };
  try {
    assert.throws(() => serve(), /Command failed/);
    assert.match(run(), /Staged exact release/);
    const receiptPath = join(store, 'receipts', `${appRelease}.json`);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.equal(receipt.image, image);
    assert.equal(receipt.payloadInventorySha256, metadata.payloadInventorySha256);
    assert.match(serve(), /Synthetic Nginx placeholder/);
    assert.equal(await readFile(join(scratch, 'ready'), 'utf8'), 'ready\n');
    assert.equal(JSON.parse(await readFile(join(scratch, 'release.json'), 'utf8')).image, image);
    // /tmp belongs to the Pod and can survive a container restart.
    if ((await lstat(join(scratch, 'release-root'))).isSymbolicLink()) {
      assert.match(serve(), /Synthetic Nginx placeholder/);
    } else {
      t.diagnostic('Git Bash emulates symlinks without Windows privilege; repeat-serving alias check deferred to Linux.');
    }
    assert.throws(() => serve({ EXPECTED_IMAGE: image.replace(/a{64}/, 'b'.repeat(64)) }), /Command failed/);
    await assert.rejects(readFile(join(scratch, 'ready'), 'utf8'), /ENOENT/);
    assert.match(run(), /Already staged and verified/);
    assert.throws(() => run({ EXPECTED_IMAGE: image.replace(/a{64}/, 'b'.repeat(64)) }), /Command failed/);
    assert.deepEqual(JSON.parse(await readFile(receiptPath, 'utf8')), receipt);
    for (const file of files) {
      assert.equal(await readFile(join(store, 'app-releases', appRelease, file.path), 'utf8'), payload[file.path]);
      assert.equal((await stat(join(store, '.blobs', file.sha256))).size, file.bytes);
    }
    await mkdir(join(store, '.stage-lock'));
    assert.throws(() => run(), /Command failed/);
    await rm(join(store, '.stage-lock'), { recursive: true });
    await writeFile(join(site, 'index.html'), 'Damaged source bytes');
    assert.throws(() => run(), /Command failed/);
    assert.deepEqual(JSON.parse(await readFile(receiptPath, 'utf8')), receipt);
  } finally {
    // Removing test-only read-only hardlinks can require force on Windows.
    await rm(root, { recursive: true, force: true });
  }
});
