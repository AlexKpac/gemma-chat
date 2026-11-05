'use strict';

const $ = (id) => document.getElementById(id);

// Память на одно сообщение: последняя пара вопрос/ответ
let previous = null;
let busy = false;

// ---------- API ----------
async function api(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// ---------- Экраны ----------
function showLogin() {
  $('chat-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
  $('login').focus();
}
function showChat(me) {
  $('login-view').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
  $('meta').textContent = `${me.user} · до ${me.maxTokens} токенов`;
  $('input').focus();
}

async function init() {
  try {
    const me = await api('/api/me');
    me.user ? showChat(me) : showLogin();
  } catch {
    showLogin();
  }
}

// ---------- Вход / выход ----------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  try {
    await api('/api/login', { login: $('login').value, password: $('password').value });
    $('password').value = '';
    showChat(await api('/api/me'));
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    $('login-btn').disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', {}).catch(() => {});
  resetChat();
  showLogin();
});

$('new-chat').addEventListener('click', resetChat);

function resetChat() {
  previous = null;
  $('messages').querySelectorAll('.msg').forEach((n) => n.remove());
  $('empty').classList.remove('hidden');
}

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
  wrap.appendChild(bubble);
  $('messages').appendChild(wrap);
  $('messages').scrollTop = $('messages').scrollHeight;
  return wrap;
}

function addTyping() {
  const el = addMessage('assistant', '');
  el.querySelector('.bubble').innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  return el;
}

// ---------- Отправка ----------
async function send() {
  const input = $('input');
  const message = input.value.trim();
  if (!message || busy) return;

  busy = true;
  $('send').disabled = true;
  input.value = '';
  autosize();

  addMessage('user', message);
  const typing = addTyping();

  try {
    const res = await api('/api/chat', { message, previous });
    typing.remove();
    const note = res.finish_reason === 'length' ? 'Ответ обрезан: достигнут лимит 1000 токенов' : '';
    addMessage('assistant', res.reply || '(пустой ответ)', note);
    previous = { user: message, assistant: res.reply || '' };
  } catch (err) {
    typing.remove();
    if (err.status === 401) { showLogin(); return; }
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
