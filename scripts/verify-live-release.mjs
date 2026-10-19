#!/usr/bin/env node
/** Check a candidate at its mounted HTTPS URL; never sends credentials. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyLiveRelease(appUrl, candidate, { fetchImpl = fetch } = {}) {
  const app = new URL(appUrl);
  if (app.username || app.password || app.search || app.hash || app.pathname !== '/japan-basket/' || (app.protocol !== 'https:' && !(app.protocol === 'http:' && app.hostname === '127.0.0.1'))) throw new Error('Use the HTTPS application URL ending /japan-basket/ or its loopback HTTP URL');
  if (!/^app-[a-f0-9]{40}$/.test(candidate.appRelease) || candidate.appRelease !== `app-${candidate.sourceCommit}` || !/^rps-20\d{2}-(?:0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(candidate.dataset) || !/^ghcr\.io\/zionlangan\/japan-price-basket@sha256:[a-f0-9]{64}$/.test(candidate.image)) throw new Error('Invalid reviewed candidate identity');
  async function get(path, status = 200, encoding = 'identity') {
    const response = await fetchImpl(new URL(path, app), { signal: AbortSignal.timeout(30000), cache: 'no-store', redirect: 'error', headers: { 'Accept-Encoding': encoding } });
    if (response.status !== status) throw new Error(`${path}: expected ${status}, got ${response.status}`);
    return response;
  }
  function mime(response, expected, path) {
    const actual = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!expected.includes(actual)) throw new Error(`${path}: unexpected MIME type ${actual}`);
  }
  function noCache(response, path) {
    const control = response.headers.get('cache-control') ?? '';
    if (!/(?:^|,)\s*no-cache(?:\s|,|$)/i.test(control) || /immutable/i.test(control)) throw new Error(`${path}: entry metadata must revalidate with no-cache`);
  }
  function immutable(response, path) {
    if (!/(?:^|,)\s*immutable(?:\s|,|$)/i.test(response.headers.get('cache-control') ?? '')) throw new Error(`Immutable cache header missing: ${path}`);
  }
  const liveResponse = await get('release.json');
  mime(liveResponse, ['application/json'], 'release.json');
  noCache(liveResponse, 'release.json');
  const live = await liveResponse.json();
  for (const key of ['appRelease', 'dataset', 'sourceCommit', 'image']) if (live[key] !== candidate[key]) throw new Error(`Serving release identity mismatch: ${key}`);
  const entryResponse = await get('');
  mime(entryResponse, ['text/html'], app.pathname);
  noCache(entryResponse, app.pathname);
  const html = await entryResponse.text();
  const base = `${app.pathname}app-releases/${candidate.appRelease}/`;
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]).filter((path) => /(?:^|\/)assets\//.test(path));
  if (!assets.length || assets.some((path) => !path.startsWith(`${base}assets/`))) throw new Error('HTML assets are not pinned to the promoted app release and application path');
  for (const path of assets) {
    const response = await get(path);
    immutable(response, path);
    if (path.endsWith('.js')) mime(response, ['application/javascript', 'text/javascript'], path);
    else if (path.endsWith('.css')) mime(response, ['text/css'], path);
    else if ((response.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`Asset was served as HTML: ${path}`);
    await response.arrayBuffer();
  }
  const pointerResponse = await get(`${base}data/current.json`);
  mime(pointerResponse, ['application/json'], 'data/current.json');
  immutable(pointerResponse, 'data/current.json');
  const pointer = await pointerResponse.json();
  if (pointer.releaseId !== candidate.dataset || pointer.manifest !== `${candidate.dataset}/manifest.json`) throw new Error('Pinned dataset pointer mismatch');
  const manifestResponse = await get(`${base}data/${pointer.manifest}`);
  mime(manifestResponse, ['application/json'], 'manifest.json');
  immutable(manifestResponse, 'manifest.json');
  const manifest = await manifestResponse.json();
  if (manifest.releaseId !== candidate.dataset) throw new Error('Manifest dataset mismatch');
  const city = manifest.cities.find((record) => record.id === '13100');
  if (!city || !/^cities\/[A-Za-z0-9_-]+\.json$/.test(city.file) || !/^[a-f0-9]{64}$/.test(city.sha256)) throw new Error('Tokyo city metadata unavailable or invalid');
  const cityPath = `${base}data/${candidate.dataset}/${city.file}`;
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  for (const encoding of ['identity', 'gzip']) {
    const response = await get(cityPath, 200, encoding);
    mime(response, ['application/json'], cityPath);
    immutable(response, cityPath);
    if (!(response.headers.get('vary') ?? '').toLowerCase().split(/\s*,\s*/).includes('accept-encoding')) throw new Error('Compression Vary header missing');
    const actualEncoding = response.headers.get('content-encoding');
    if (encoding === 'gzip' ? actualEncoding !== 'gzip' : actualEncoding !== null && actualEncoding !== 'identity') throw new Error(`City response did not honor ${encoding} negotiation`);
    // Fetch decodes gzip; both negotiated forms must reproduce the same native bytes.
    if (digest(Buffer.from(await response.arrayBuffer())) !== city.sha256) throw new Error('City bytes do not match the reviewed manifest');
  }
  await get('data/current.json', 404);
  await get(`${base}assets/missing-file.js`, 404);
  await get(`${base}data/${candidate.dataset}/cities/missing.json`, 404);
  return { checkedUtc: new Date().toISOString(), appUrl: app.href, appRelease: live.appRelease, dataset: live.dataset, image: live.image, verifiedCity: city.id, assetsChecked: assets.length, checks: 'identity, application path, pinned assets, city SHA-256, cache/MIME, gzip and identity negotiation, real 404' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/verify-live-release.mjs https://your-domain/japan-basket/ .local/candidate.json');
  const candidate = JSON.parse(await readFile(process.argv[3], 'utf8'));
  console.log(JSON.stringify(await verifyLiveRelease(process.argv[2], candidate), null, 2));
}
