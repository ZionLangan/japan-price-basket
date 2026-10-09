// Deterministic offline publication; never calls the upstream API.
import { readFile, mkdir, writeFile, readdir, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readApprovedFixture } from './read_approved_fixture.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const raw = await readFile(path.join(root, 'data/fixtures/recent-approved.json.gz'));
const approval = JSON.parse(
  await readFile(path.join(root, 'data/fixtures/recent-approved.manifest.json'), 'utf8'),
);
const { series, ...metadata } = readApprovedFixture(raw, approval);
const releaseId = `rps-${metadata.end}-${approval.sha256.slice(0, 12)}`;
const destination = path.join(root, 'apps/web/public/data', releaseId);
await mkdir(path.join(destination, 'cities'), { recursive: true });
const cities = [];
for (const city of metadata.cities) {
  const bytes = JSON.stringify({
    schemaVersion: 1,
    releaseId,
    cityId: city.id,
    scopeId: city.id,
    series: series[city.id],
  });
  const file = `cities/${city.id}.json`;
  await writeFile(path.join(destination, file), bytes);
  cities.push({ ...city, file, sha256: hash(bytes) });
}
await writeFile(
  path.join(destination, 'manifest.json'),
  JSON.stringify({ ...metadata, releaseId, cities }),
);
await writeFile(
  path.join(root, 'apps/web/public/data/current.json'),
  JSON.stringify({
    releaseId,
    manifest: `${releaseId}/manifest.json`,
  }),
);
console.log(
  `Published ${cities.length} cities, ${metadata.products.length} products: ${releaseId}`,
);
// This is a generated local build folder. Retain rollback artifacts separately;
// remove only older generator-owned directories after the new pointer is written.
const dataRoot = await realpath(path.join(root, 'apps/web/public/data'));
for (const entry of await readdir(dataRoot, { withFileTypes: true })) {
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    entry.name === releaseId ||
    !/^rps-20\d{2}-\d{2}-[a-f0-9]{12}$/.test(entry.name)
  )
    continue;
  const candidate = await realpath(path.join(dataRoot, entry.name));
  if (!candidate.startsWith(dataRoot + path.sep)) throw new Error('Unsafe generated directory');
  await rm(candidate, { recursive: true });
}
