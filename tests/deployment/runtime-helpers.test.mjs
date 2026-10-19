// Synthetic non-price bytes only. These fixtures never represent observations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { prepareRelease, inventoryHash } from '../../scripts/prepare-release.mjs';

const wireScript = fileURLToPath(new URL('../../scripts/wire-release-base.mjs', import.meta.url));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jpb-release-synthetic-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Synthetic test');
  git('config', 'user.email', 'synthetic@example.invalid');
  await writeFile(join(root, '.gitignore'), 'dist/\n', 'utf8');
  await mkdir(join(root, 'apps/web/src'), { recursive: true });
  await writeFile(join(root, 'apps/web/src/App.tsx'), "fetch(`${import.meta.env.BASE_URL}data/current.json`);\nfetch(`${import.meta.env.BASE_URL}data/${pointer.manifest}`);\nfetch(`${import.meta.env.BASE_URL}data/${release.releaseId}/${city.file}`, { signal });\n", 'utf8');
  git('add', '.');
  git('commit', '-qm', 'Synthetic non-price fixture');
  const commit = git('rev-parse', 'HEAD');
  const dataset = 'rps-2026-08-000000000000';
  await mkdir(join(root, 'dist/data', dataset), { recursive: true });
  await mkdir(join(root, 'dist/assets'), { recursive: true });
  await writeFile(join(root, 'dist/index.html'), `<script src="/japan-basket/app-releases/app-${commit}/assets/synthetic.js"></script>\n`);
  await writeFile(join(root, 'dist/assets/synthetic.js'), '/* Synthetic non-price test bytes. */\n');
  await writeFile(join(root, 'dist/THIRD_PARTY_NOTICES.txt'), 'Synthetic fixture, not a distributable application.\n');
  await writeFile(join(root, 'dist/data/current.json'), JSON.stringify({ releaseId: dataset, manifest: `${dataset}/manifest.json` }));
  await writeFile(join(root, 'dist/data', dataset, 'manifest.json'), JSON.stringify({ releaseId: dataset, policyVersion: '1.2', end: '2026-08' }));
  return { root, git, commit, dataset };
}
test('prepared release pins clean commit, inventory hashes and dataset identity', async () => {
  const f = await fixture();
  try {
    const first = await prepareRelease(f.root, { compress: false });
    assert.equal(first.appRelease, `app-${f.commit}`);
    assert.equal(first.dataset, f.dataset);
    assert.equal(first.payloadInventorySha256, inventoryHash(first.files));
    assert.ok(first.files.some((entry) => entry.path === 'index.html'));
    assert.ok(first.files.every((entry) => entry.path !== 'release-meta.json'));
    assert.deepEqual(await prepareRelease(f.root, { compress: false }), first);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('rejects an index built for another commit instead of mislabeling it', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'dist/index.html'), '<script src="/assets/synthetic.js"></script>');
    await assert.rejects(prepareRelease(f.root), /Rebuild with Vite/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('rejects a legacy root mount or mixed root asset URLs even for the correct commit', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'dist/index.html'), `<script src="/app-releases/app-${f.commit}/assets/synthetic.js"></script>`);
    await assert.rejects(prepareRelease(f.root), /application path/);
    await writeFile(join(f.root, 'dist/index.html'), `<script src="/japan-basket/app-releases/app-${f.commit}/assets/synthetic.js"></script><link href="/assets/leaked.css" rel="stylesheet">`);
    await assert.rejects(prepareRelease(f.root), /application path/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('gzip companions retain exact decoded bytes and deterministic inventory', async () => {
  const f = await fixture();
  try {
    const original = '/* Synthetic non-price test bytes. */\n'.repeat(100);
    await writeFile(join(f.root, 'dist/assets/synthetic.js'), original);
    const first = await prepareRelease(f.root);
    const compressed = await readFile(join(f.root, 'dist/assets/synthetic.js.gz'));
    assert.equal(gunzipSync(compressed).toString('utf8'), original);
    assert.ok(first.files.some((entry) => entry.path === 'assets/synthetic.js.gz'));
    assert.deepEqual(await prepareRelease(f.root), first);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('rejects a dirty source tree', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'apps/web/src/App.tsx'), '// Changed source');
    await assert.rejects(prepareRelease(f.root), /Git must be clean/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('rejects a pointer that traverses outside its dataset', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'dist/data/current.json'), JSON.stringify({ releaseId: f.dataset, manifest: '../../private.json' }));
    await assert.rejects(prepareRelease(f.root), /Invalid reviewed dataset pointer/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('rejects payload symlinks where the platform permits creating them', async (t) => {
  const f = await fixture();
  try {
    try { await symlink(join(f.root, '.gitignore'), join(f.root, 'dist/link.txt')); }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Windows symlink privilege unavailable'); throw error; }
    await assert.rejects(prepareRelease(f.root), /symlinks are forbidden/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('wiring is idempotent and refuses a partially patched source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jpb-wire-synthetic-'));
  try {
    await mkdir(join(root, 'apps/web/src'), { recursive: true });
    const file = join(root, 'apps/web/src/App.tsx');
    const original = "fetch('/data/current.json');\nfetch(`/data/${pointer.manifest}`);\nfetch(`/data/${release.releaseId}/${city.file}`, { signal });\n";
    await writeFile(file, original);
    execFileSync(process.execPath, [wireScript], { cwd: root });
    const first = await readFile(file, 'utf8');
    assert.equal((first.match(/BASE_URL/g) ?? []).length, 3);
    execFileSync(process.execPath, [wireScript], { cwd: root });
    assert.equal(await readFile(file, 'utf8'), first);
    await writeFile(file, original.replace("fetch('/data/current.json')", 'fetch(`${import.meta.env.BASE_URL}data/current.json`)'));
    assert.throws(() => execFileSync(process.execPath, [wireScript], { cwd: root, stdio: 'pipe' }), /Command failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
