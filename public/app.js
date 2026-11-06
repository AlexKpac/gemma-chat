'use strict';

const $ = (id) => document.getElementById(id);

let busy = false;

const LS_THEME = 'gemma_chat_theme';
const MAX_INPUT_CHARS = 8000;

// ---------- Ключ ----------
// Приоритет: ключ хостинга (env.js → CONFIG.apiKey), затем встроенный в репозиторий
// обфусцированный ключ (config.js → CONFIG.apiKeyEnc). В интерфейсе ключа нет.
function decodeKey(enc) {
  try {
    return [...atob(enc)].map((c) => String.fromCharCode(c.charCodeAt(0) ^ 0x5A)).join('');
  } catch { return ''; }
}
const getKey = () => CONFIG.apiKey || decodeKey(CONFIG.apiKeyEnc || '');

// ---------- Тема ----------
const ICON_SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(LS_THEME, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0f1216' : '#f6f7f9';
  const btn = $('theme-toggle');
  btn.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
  btn.title = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
}

function initTheme() {
  const stored = localStorage.getItem(LS_THEME);
  const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(stored || system);
  $('theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

// ---------- Инициализация ----------
function init() {
  initTheme();
  $('meta').textContent = `до ${CONFIG.maxTokens} токенов · без истории`;
  $('input').focus();
}

$('clear-history').addEventListener('click', () => {
  $('messages').querySelectorAll('.msg').forEach((n) => n.remove());
  $('empty').classList.remove('hidden');
});

// ---------- Рендер ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Мини-Markdown: код-блоки, инлайн-код, жирный, курсив, заголовки, списки. HTML всегда экранируется.
function renderMarkdown(src) {
  const blocks = [];
  let text = src.replace(/```[\w+-]*\n?([\s\S]*?)(```|$)/g, (_, code) => {
    blocks.push('<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
    return `\u0000${blocks.length - 1}\u0000`;
  });
  text = escapeHtml(text);

  const inline = (s) => s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  const out = [];
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const line of text.split('\n')) {
    let m;
    if (/^\u0000\d+\u0000$/.test(line.trim())) { flushPara(); closeList(); out.push(line.trim()); continue; }
    if ((m = line.match(/^\s*#{1,6}\s+(.*)$/))) { flushPara(); closeList(); out.push('<h4>' + inline(m[1]) + '</h4>'); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + inline(m[1]) + '</li>'); continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara(); if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + inline(m[1]) + '</li>'); continue;
    }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    closeList(); para.push(line);
  }
  flushPara(); closeList();

  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

function addMessage(role, text, note) {
  $('empty').classList.add('hidden');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'assistant') bubble.innerHTML = renderMarkdown(text);
  else bubble.textContent = text;
  if (note) {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = note;
    bubble.appendChild(n);
  }
  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.src = 'logo.jpg';
    avatar.alt = 'G';
    wrap.appendChild(avatar);
  }
  wrap.appendChild(bubble);
  $('messages').appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function scrollToBottom() {
  const box = $('messages');
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

function addTyping() {
  const el = addMessage('assistant', '');
  el.querySelector('.bubble').innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  return el;
}

// ---------- OpenRouter (напрямую из браузера) ----------
async function askModel(message) {
  // Без истории: модель видит только текущее сообщение
  const messages = [{ role: 'user', content: message }];

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: CONFIG.model, max_tokens: CONFIG.maxTokens, messages }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || `HTTP ${r.status}`;
    const err = new Error(r.status === 401 ? 'Ключ OpenRouter отклонён' : `Ошибка модели: ${msg}`);
    err.status = r.status;
    throw err;
  }
  const choice = data.choices && data.choices[0];
  return { reply: (choice?.message?.content || '').trim(), finish_reason: choice?.finish_reason || '' };
}

// ---------- Отправка ----------
async function send() {
  const input = $('input');
  const message = input.value.trim().slice(0, MAX_INPUT_CHARS);
  if (!message || busy) return;

  if (!getKey()) {
    addMessage('error', 'Ключ API не задан: впишите его в public/config.js или сгенерируйте public/env.js при деплое (см. README)');
    return;
  }

  busy = true;
  $('send').disabled = true;
  input.value = '';
  autosize();

  addMessage('user', message);
  const typing = addTyping();

  try {
    const res = await askModel(message);
    typing.remove();
    const note = res.finish_reason === 'length' ? `Ответ обрезан: достигнут лимит ${CONFIG.maxTokens} токенов` : '';
    addMessage('assistant', res.reply || '(пустой ответ)', note);
  } catch (err) {
    typing.remove();
    addMessage('error', err.message);
  } finally {
    busy = false;
    $('send').disabled = false;
    input.focus();
  }
}

$('chat-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });

$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});

function autosize() {
  const t = $('input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 200) + 'px';
}
$('input').addEventListener('input', autosize);

init();
