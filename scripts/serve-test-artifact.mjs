/** Test-only aliases for the existing root-path regression suite. Never serve this on Lightsail. */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit');
const prefix = `/japan-basket/app-releases/app-${sourceCommit}/`;
const root = resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

createServer((request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    let pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:4173').pathname);
    if (pathname.startsWith(prefix)) pathname = pathname.slice(prefix.length);
    else if (pathname === '/' || pathname === '/japan-basket/') pathname = 'index.html';
    else if (pathname.startsWith('/data/')) pathname = pathname.slice(1);
    else { response.writeHead(404).end(); return; }
    if (!pathname || pathname.endsWith('/')) pathname += 'index.html';
    const path = resolve(root, pathname);
    if (!path.startsWith(root + sep) || !existsSync(path) || !statSync(path).isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') response.end(); else createReadStream(path).pipe(response);
  } catch { response.writeHead(400).end(); }
}).listen(4173, '127.0.0.1', () => console.log(`Test-only artifact server: http://127.0.0.1:4173; production base ${prefix}`));
