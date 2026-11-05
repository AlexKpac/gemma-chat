'use strict';

/**
 * Gemma Chat — минимальный сервер без зависимостей (Node.js 18+).
 * - отдаёт статический фронтенд из ./public
 * - вход по логину/паролю из переменных окружения, сессия в подписанной cookie
 * - проксирует запросы в OpenRouter (ключ никогда не попадает в браузер)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Мини-загрузчик .env (без зависимостей) ----------
// Значения из .env применяются, только если переменная не задана в окружении
try {
  const envFile = path.join(__dirname, '.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
} catch { /* .env необязателен */ }

// ---------- Настройки из переменных окружения ----------
// CLI-аргументы (--port/--host) переопределяют переменные окружения
function cliArg(name) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const PORT = Number(cliArg('port') || process.env.PORT) || 8080;
const HOST = cliArg('host') || process.env.HOST || '0.0.0.0';
const API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.MODEL || 'google/gemma-3-27b-it';
const MAX_TOKENS = 1000;
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const MAX_INPUT_CHARS = 8000;

// Пользователи: USERS="login1:pass1,login2:pass2" и/или AUTH_LOGIN + AUTH_PASSWORD
function loadUsers() {
  const users = new Map();
  const raw = process.env.USERS || '';
  for (const pair of raw.split(',')) {
    const i = pair.indexOf(':');
    if (i > 0) users.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  if (process.env.AUTH_LOGIN && process.env.AUTH_PASSWORD) {
    users.set(process.env.AUTH_LOGIN.trim(), process.env.AUTH_PASSWORD);
  }
  return users;
}
const USERS = loadUsers();

// Секрет для подписи cookie. Лучше задать SESSION_SECRET явно;
// иначе он выводится из ключа и списка пользователей (смена пароля = разлогин всех).
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('gemma-chat|' + API_KEY + '|' + JSON.stringify([...USERS])).digest('hex');

if (!API_KEY) console.warn('[warn] OPENROUTER_API_KEY не задан — чат работать не будет');
if (USERS.size === 0) console.warn('[warn] Пользователи не заданы (USERS или AUTH_LOGIN/AUTH_PASSWORD) — войти будет нельзя');

// ---------- Утилиты ----------
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url').toString('utf8');
const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function makeSessionCookie(req, login) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = b64u(login) + '.' + exp;
  const value = payload + '.' + sign(payload);
  return [
    `session=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
    isHttps(req) ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function clearSessionCookie() {
  return 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function getUser(req) {
  const v = parseCookies(req).session;
  if (!v) return null;
  const parts = v.split('.');
  if (parts.length !== 3) return null;
  const [l, exp, sig] = parts;
  if (!safeEqual(sig, sign(l + '.' + exp))) return null;
  if (Number(exp) < Date.now()) return null;
  const login = unb64u(l);
  return USERS.has(login) ? login : null; // пользователь удалён из env — сессия недействительна
}

function sendJSON(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

// Простая защита от перебора паролей: 10 попыток за 15 минут с одного IP
const attempts = new Map();
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.start > 15 * 60e3) { attempts.set(ip, { start: now, count: 0 }); return false; }
  return rec.count >= 10;
}
function registerFail(ip) { const r = attempts.get(ip); if (r) r.count++; }
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of attempts) if (now - r.start > 15 * 60e3) attempts.delete(ip);
}, 60e3).unref();

// ---------- Статика ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA-фолбэк
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(html);
      });
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

// ---------- OpenRouter ----------
function clean(s) {
  return typeof s === 'string' ? s.slice(0, MAX_INPUT_CHARS) : '';
}

async function askModel(message, previous, req) {
  const messages = [];
  // Память на одно сообщение: только предыдущая пара вопрос/ответ
  if (previous && clean(previous.user) && clean(previous.assistant)) {
    messages.push({ role: 'user', content: clean(previous.user) });
    messages.push({ role: 'assistant', content: clean(previous.assistant) });
  }
  messages.push({ role: 'user', content: message });

  const origin = (isHttps(req) ? 'https://' : 'http://') + (req.headers.host || 'localhost');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': origin,
      'X-Title': 'Gemma Chat',
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: MAX_TOKENS }),
    signal: AbortSignal.timeout(120e3),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const msg = (data.error && data.error.message) || `OpenRouter HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  const choice = data.choices && data.choices[0];
  return {
    reply: (choice && choice.message && choice.message.content) || '',
    finish_reason: choice && choice.finish_reason,
    usage: data.usage || null,
  };
}

// ---------- Роутинг ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    if (p === '/api/me' && req.method === 'GET') {
      const user = getUser(req);
      return sendJSON(res, 200, { user, model: MODEL, maxTokens: MAX_TOKENS });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (tooManyAttempts(ip)) return sendJSON(res, 429, { error: 'Слишком много попыток. Попробуйте через 15 минут.' });
      const body = await readBody(req);
      const login = String(body.login || '').trim();
      const password = String(body.password || '');
      const expected = USERS.get(login);
      // сравниваем всегда, чтобы время ответа не выдавало существование логина
      const ok = safeEqual(password, expected === undefined ? crypto.randomUUID() : expected) && expected !== undefined;
      if (!ok) { registerFail(ip); return sendJSON(res, 401, { error: 'Неверный логин или пароль' }); }
      return sendJSON(res, 200, { user: login }, { 'Set-Cookie': makeSessionCookie(req, login) });
    }

    if (p === '/api/logout' && req.method === 'POST') {
      return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    }

    if (p === '/api/chat' && req.method === 'POST') {
      if (!getUser(req)) return sendJSON(res, 401, { error: 'Требуется вход' });
      if (!API_KEY) return sendJSON(res, 500, { error: 'На сервере не задан OPENROUTER_API_KEY' });
      const body = await readBody(req);
      const message = clean(body.message).trim();
      if (!message) return sendJSON(res, 400, { error: 'Пустое сообщение' });
      try {
        const result = await askModel(message, body.previous, req);
        return sendJSON(res, 200, result);
      } catch (e) {
        console.error('[openrouter]', e.message);
        return sendJSON(res, 502, { error: 'Ошибка модели: ' + e.message });
      }
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'Not found' });

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);

    res.writeHead(405); res.end();
  } catch (e) {
    const status = e.message === 'too_large' ? 413 : e.message === 'bad_json' ? 400 : 500;
    if (status === 500) console.error(e);
    sendJSON(res, status, { error: status === 500 ? 'Внутренняя ошибка' : e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Gemma Chat: http://${HOST}:${PORT}  (model: ${MODEL}, users: ${USERS.size})`);
});
