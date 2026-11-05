'use strict';

/**
 * Gemma Chat — крошечный статический сервер без зависимостей (Node.js 18+).
 * Бэкенда больше нет: этот файл нужен только чтобы раздать ./public
 * (вход, хэши и запросы в OpenRouter теперь живут в браузере).
 * Можно заменить любым статическим хостингом или даже открыть public/index.html напрямую.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

function cliArg(name) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const PORT = Number(cliArg('port') || process.env.PORT) || 8080;
const HOST = cliArg('host') || process.env.HOST || '0.0.0.0';

const ROOT = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }

  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA-fallback не нужен, но на директорию отдаём её index.html
      const idx = path.join(file, 'index.html');
      if (fs.existsSync(idx)) file = idx;
      else { res.writeHead(404); return res.end('Not found'); }
      return fs.readFile(file, (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(d2);
      });
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Gemma Chat (static): http://${HOST}:${PORT}`);
});
