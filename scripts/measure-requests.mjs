#!/usr/bin/env node
/** Bounded external request measurements. Does not assert permanent availability. */
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--url', '--seconds', '--output', '--interval-ms'].includes(key) || args[key] !== undefined || process.argv[i + 1] === undefined) throw new Error('Usage: node scripts/measure-requests.mjs --url https://your-domain/ --seconds 900 --output .local/rollout.csv [--interval-ms 1000]');
  args[key] = process.argv[i + 1];
}
const url = new URL(args['--url']);
const seconds = Number(args['--seconds'] ?? 900);
const interval = Number(args['--interval-ms'] ?? 1000);
if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Use public HTTPS or loopback HTTP, without credentials/query/fragment');
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600 || !Number.isInteger(interval) || interval < 100 || interval > 10000) throw new Error('Seconds must be 1..3600 and interval 100..10000 milliseconds');
if (!args['--output']) throw new Error('--output is required');
const output = resolve(args['--output']);
await mkdir(dirname(output), { recursive: true });
const log = await open(output, 'wx');
await log.write('utc,status,latency_ms,fetch_exit,error\n');
const started = Date.now();
let stopped = false, count = 0, failures = 0, maxLatency = 0;
process.on('SIGINT', () => { stopped = true; });
try {
  while (!stopped && Date.now() - started < seconds * 1000) {
    const before = Date.now();
    let status = 0, exit = 0, error = '';
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store', redirect: 'follow' });
      status = response.status;
      await response.arrayBuffer();
      if (status !== 200) failures++;
    } catch (problem) { exit = 1; failures++; error = problem.name ?? 'FetchError'; }
    const latency = Date.now() - before;
    maxLatency = Math.max(maxLatency, latency);
    count++;
    await log.write(`${new Date(before).toISOString()},${status},${latency},${exit},${error}\n`);
    const remaining = seconds * 1000 - (Date.now() - started);
    if (remaining > 0 && !stopped) await sleep(Math.max(0, Math.min(interval - latency, remaining)));
  }
} finally { await log.close(); }
const summary = { url: url.href, startedUtc: new Date(started).toISOString(), elapsedSeconds: (Date.now() - started) / 1000, samples: count, failures, failurePercent: count ? 100 * failures / count : null, maxLatencyMs: maxLatency, interrupted: stopped };
await writeFile(`${output}.summary.json`, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (failures) process.exitCode = 1;
