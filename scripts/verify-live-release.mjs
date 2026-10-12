#!/usr/bin/env node
/** Check a candidate over HTTPS after deployment; never sends credentials. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (process.argv.length !== 4) throw new Error('Usage: node scripts/verify-live-release.mjs https://your-domain/ .local/candidate.json');
const origin = new URL(process.argv[2]);
if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1'))) throw new Error('Use an HTTPS origin or loopback HTTP origin');
const candidate = JSON.parse(await readFile(process.argv[3], 'utf8'));
if (!/^app-[a-f0-9]{40}$/.test(candidate.appRelease) || !/^rps-20\d{2}-\d{2}-[a-f0-9]{12}$/.test(candidate.dataset) || !/^ghcr\.io\/zionlangan\/japan-price-basket@sha256:[a-f0-9]{64}$/.test(candidate.image)) throw new Error('Invalid reviewed candidate identity');
async function get(path, status = 200) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (response.status !== status) throw new Error(`${path}: expected ${status}, got ${response.status}`);
  return response;
}
const live = await (await get('/release.json')).json();
for (const key of ['appRelease', 'dataset', 'sourceCommit', 'image']) if (live[key] !== candidate[key]) throw new Error(`Serving release identity mismatch: ${key}`);
const html = await (await get('/')).text();
const base = `/app-releases/${candidate.appRelease}/`;
if (!html.includes(`${base}assets/`)) throw new Error('HTML is not pinned to the promoted app release');
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((path) => path.startsWith(`${base}assets/`));
if (!assets.length) throw new Error('HTML contains no release assets');
for (const path of assets) {
  const response = await get(path);
  if (!(response.headers.get('cache-control') ?? '').includes('immutable')) throw new Error(`Immutable cache header missing: ${path}`);
  if ((response.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`Asset was served as HTML: ${path}`);
  await response.arrayBuffer();
}
const pointer = await (await get(`${base}data/current.json`)).json();
if (pointer.releaseId !== candidate.dataset || pointer.manifest !== `${candidate.dataset}/manifest.json`) throw new Error('Pinned dataset pointer mismatch');
const manifest = await (await get(`${base}data/${pointer.manifest}`)).json();
const city = manifest.cities.find((record) => record.id === '13100');
if (!city) throw new Error('Tokyo city metadata unavailable');
const cityResponse = await get(`${base}data/${candidate.dataset}/${city.file}`);
if (!(cityResponse.headers.get('content-type') ?? '').includes('application/json')) throw new Error('City MIME type is not JSON');
if (!(cityResponse.headers.get('vary') ?? '').toLowerCase().includes('accept-encoding')) throw new Error('Compression Vary header missing');
const bytes = Buffer.from(await cityResponse.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== city.sha256) throw new Error('City bytes do not match the reviewed manifest');
await get('/data/current.json', 404);
await get(`${base}assets/missing-file.js`, 404);
await get(`${base}data/${candidate.dataset}/cities/missing.json`, 404);
await get('/readyz');
console.log(JSON.stringify({ checkedUtc: new Date().toISOString(), origin: origin.origin, appRelease: live.appRelease, dataset: live.dataset, image: live.image, verifiedCity: city.id, assetsChecked: assets.length, checks: 'identity, pinned paths, assets, city SHA-256, cache/MIME/gzip Vary, real 404, readiness' }, null, 2));
