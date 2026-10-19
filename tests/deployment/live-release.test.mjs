// Synthetic non-price responses only. No fixture represents observations.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { verifyLiveRelease } from '../../scripts/verify-live-release.mjs';

async function fixture(fault = '') {
  const sourceCommit = '1'.repeat(40);
  const candidate = { sourceCommit, appRelease: `app-${sourceCommit}`, dataset: 'rps-2026-08-000000000000', image: `ghcr.io/zionlangan/japan-price-basket@sha256:${'a'.repeat(64)}` };
  const base = `/japan-basket/app-releases/${candidate.appRelease}/`;
  const city = JSON.stringify({ synthetic: true, note: 'Synthetic non-price response, not survey data.' });
  const manifest = { releaseId: candidate.dataset, cities: [{ id: '13100', file: 'cities/13100.json', sha256: createHash('sha256').update(city).digest('hex') }] };
  const html = `<script src="${base}assets/synthetic.js"></script><link href="${base}assets/synthetic.css" rel="stylesheet">` + (fault === 'root-asset' ? '<script src="/assets/leaked.js"></script>' : '');
  const routes = new Map([
    ['/japan-basket/', { body: html, type: 'text/html', cache: 'no-cache' }],
    ['/japan-basket/release.json', { body: JSON.stringify(candidate), type: 'application/json', cache: fault === 'cached-metadata' ? 'public, max-age=31536000, immutable' : 'no-cache' }],
    [`${base}assets/synthetic.js`, { body: '/* Synthetic non-price script. */', type: fault === 'wrong-mime' ? 'application/octet-stream' : 'text/javascript' }],
    [`${base}assets/synthetic.css`, { body: '/* Synthetic non-price CSS. */', type: 'text/css' }],
    [`${base}data/current.json`, { body: JSON.stringify({ releaseId: candidate.dataset, manifest: `${candidate.dataset}/manifest.json` }), type: 'application/json' }],
    [`${base}data/${candidate.dataset}/manifest.json`, { body: JSON.stringify(manifest), type: 'application/json' }],
    [`${base}data/${candidate.dataset}/cities/13100.json`, { body: fault === 'damaged-city' ? city + ' ' : city, type: 'application/json', city: true }],
  ]);
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, encoding: request.headers['accept-encoding'] });
    const route = routes.get(request.url);
    if (!route) { response.writeHead(404).end(); return; }
    const headers = { 'Content-Type': route.type, 'Cache-Control': route.cache ?? 'public, max-age=31536000, immutable' };
    let bytes = Buffer.from(route.body);
    if (route.city) {
      headers.Vary = 'Accept-Encoding';
      if (request.headers['accept-encoding'] === 'gzip' && fault !== 'no-gzip') {
        bytes = gzipSync(bytes);
        headers['Content-Encoding'] = 'gzip';
      }
    }
    response.writeHead(200, headers).end(bytes);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { candidate, requests, url: `http://127.0.0.1:${server.address().port}/japan-basket/`, close: () => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}

test('mounted live verification checks gzip and identity bytes without requesting another application or internal health endpoints', async () => {
  const f = await fixture();
  try {
    const result = await verifyLiveRelease(f.url, f.candidate);
    assert.equal(result.appUrl, f.url);
    assert.equal(result.verifiedCity, '13100');
    assert.equal(result.assetsChecked, 2);
    assert.ok(f.requests.every((request) => request.path.startsWith('/japan-basket/')));
    const cityRequests = f.requests.filter((request) => request.path.endsWith('/cities/13100.json'));
    assert.deepEqual(cityRequests.map((request) => request.encoding), ['identity', 'gzip']);
  } finally { await f.close(); }
});

test('live verification rejects invalid app mounts, unsafe URLs and inconsistent candidate identities before making requests', async () => {
  const failFetch = () => { throw new Error('No request should be made'); };
  const f = await fixture();
  try {
    for (const url of ['https://example.invalid/', 'https://example.invalid/japan-basket', 'https://user:password@example.invalid/japan-basket/', 'http://example.invalid/japan-basket/', 'https://example.invalid/japan-basket/?key=private']) {
      await assert.rejects(verifyLiveRelease(url, f.candidate, { fetchImpl: failFetch }), /application URL/);
    }
    await assert.rejects(verifyLiveRelease(f.url, { ...f.candidate, sourceCommit: '2'.repeat(40) }, { fetchImpl: failFetch }), /candidate identity/);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

for (const [fault, error] of [
  ['cached-metadata', /must revalidate/],
  ['root-asset', /application path/],
  ['wrong-mime', /unexpected MIME/],
  ['damaged-city', /City bytes/],
  ['no-gzip', /honor gzip/],
]) {
  test(`live verification rejects ${fault}`, async () => {
    const f = await fixture(fault);
    try { await assert.rejects(verifyLiveRelease(f.url, f.candidate), error); }
    finally { await f.close(); }
  });
}
