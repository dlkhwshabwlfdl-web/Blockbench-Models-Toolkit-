#!/usr/bin/env node
/**
 * Minimal static server for eyeballing generated output in a browser.
 *
 *   node scripts/serve.mjs [dir] [port]
 *
 * Serves `dir` (default: the package root) on 127.0.0.1:PORT (default 4180), so a preview
 * page can reference the PNGs the exporters wrote without any build tooling.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(HERE, '..'));
const port = Number(process.argv[3] ?? 4180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.bbmodel': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** An index page listing every PNG under a directory, so previews are one click away. */
function directoryIndex(dir, urlPath) {
  const images = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.png')) {
        images.push(path.relative(dir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(dir);
  const items = images
    .sort()
    .map((file) => {
      const href = `${urlPath === '/' ? '' : urlPath}/${file}`;
      return `<figure><a href="${href}"><img src="${href}" width="260" /></a><figcaption>${file}</figcaption></figure>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>aimodel output</title>
<style>:root{color-scheme:dark}body{margin:0;padding:24px;background:#14161c;color:#e6e8ee;
font:14px/1.5 system-ui,"Segoe UI",sans-serif}h1{font-size:17px;margin:0 0 16px}
figure{margin:0 0 20px}a{color:#9aa2b1}img{display:block;image-rendering:pixelated;border:1px solid #2a2e38;
border-radius:8px;background:#0e1015}figcaption{color:#9aa2b1;font-size:12px;margin-top:6px}
.grid{display:flex;flex-wrap:wrap;gap:20px}</style></head>
<body><h1>aimodel output — ${images.length} image(s) under ${urlPath}</h1><div class="grid">${items}</div></body></html>`;
}

const server = http.createServer((request, response) => {
  const url = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const target = path.join(root, url === '/' ? '/out' : url);
  if (!target.startsWith(root)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(target, (error, stats) => {
    if (error) {
      response.writeHead(404).end('not found');
      return;
    }
    if (stats.isDirectory()) {
      const clean = url === '/' ? '/' : url.replace(/\/+$/, '');
      response.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      response.end(directoryIndex(target, clean));
      return;
    }
    if (!stats.isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(target).pipe(response);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/`);
});
