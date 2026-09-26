// Serves the dashboard UI from public/ and proxies API calls to the backend,
// so the browser only ever talks to one origin (locally and on Railway).
//
//   BACKEND_URL  backend base URL (default: the production Railway API)
//   PORT / UI_PORT  default 3000

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT ?? process.env.UI_PORT ?? 3000);
const backend = new URL(process.env.BACKEND_URL ?? 'https://api-production-2ace4.up.railway.app');
const PROXIED = /^\/(api\/|log$|entries(\/|$)|submit$|sync(\/|$))/;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function proxy(request, response) {
  const target = new URL(request.url, backend);
  const client = target.protocol === 'https:' ? https : http;
  const upstream = client.request(target, {
    method: request.method,
    headers: { ...request.headers, host: target.host },
  }, (res) => {
    response.writeHead(res.statusCode ?? 502, res.headers);
    res.pipe(response); // streams SSE (/api/events) as well as JSON
  });
  upstream.on('error', (error) => {
    console.error(`Proxy error for ${request.url}: ${error.message}`);
    if (!response.headersSent) {
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: `Backend unreachable at ${backend.origin}` }));
    } else {
      response.destroy();
    }
  });
  // Stop the upstream request if the browser goes away (e.g. closes the SSE
  // stream). request 'close' fires once the body is read, so use response.
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
}

http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (PROXIED.test(pathname)) {
    proxy(request, response);
    return;
  }

  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filename = path.resolve(root, requested);
  if (!filename.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await fs.readFile(filename);
    response.writeHead(200, {
      'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(body);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(error);
    try {
      const body = await fs.readFile(path.join(root, 'index.html'));
      response.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-cache' });
      response.end(body);
    } catch {
      response.writeHead(500).end('Could not load the dashboard');
    }
  }
}).listen(port, () => console.log(`Soma UI on http://localhost:${port} (API → ${backend.origin})`));
