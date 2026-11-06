/* AI-платформа — фронтовое демо. Данные — в localStorage, сеть не используется. */
'use strict';

const LS = 'ai-demo-state-v1';
const defaultState = {
  user: null,                     // { email, verified }
  verification: null,             // { email, code } — демо-«письмо»
  projects: [{ id: 'p1', name: 'default' }],
  keys: [],                       // { id, prefix, status, created, projectId }
  usage: [],                      // { date, project, model, status, ms, tin, tout, cost }
  secrets: {},                    // id → полный ключ (показ один раз)
};
function load() { try { return { ...structuredClone(defaultState), ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return structuredClone(defaultState); } }
function save() { localStorage.setItem(LS, JSON.stringify(state)); }
let state = load();

const MODELS = [
  { id: 'mock-mini-1', ctx: '8K', caps: 'чат, SSE', status: 'active', pin: '$0.00 / $0.00', note: 'Детерминированный mock-адаптер. Цена: source=manual.' },
  { id: 'mock-mini-1:slow', ctx: '8K', caps: 'чат', status: 'active', pin: '$0.00 / $0.00', note: 'Вариант с задержкой ~400 мс для тестов.' },
  { id: 'mock-disabled', ctx: '—', caps: '—', status: 'disabled', pin: '—', note: 'Выключена админом (демо).' },
];

const routes = {
  '/': landing,
  '/login': auth,
  '/overview': overview,
  '/models': models,
  '/playground': playground,
  '/keys': keys,
  '/usage': usage,
};

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return n.toLocaleString('ru-RU'); }

function nav() {
  const links = state.user
    ? [['/overview', 'Обзор'], ['/models', 'Модели'], ['/playground', 'Playground'], ['/keys', 'Ключи'], ['/usage', 'Использование']]
    : [['/', 'Продукт'], ['/login', 'Войти']];
  const hash = location.hash || '#/';
  document.getElementById('nav').innerHTML = links
    .map(([u, t]) => `<a href="#${u}" class="${hash === `#${u}` || (u === '/' && hash === '#/') ? 'active' : ''}">${t}</a>`).join('');
}

function render() {
  nav();
  const path = (location.hash || '#/').slice(1).split('?')[0];
  (routes[path] || landing)();
  window.scrollTo(0, 0);
}
function go(p) { location.hash = p; }

/* ---------- лендинг ---------- */
function landing() {
  const app = document.getElementById('app');
  app.innerHTML = `
  <div class="hero">
    <span class="pill">Один OpenAI-совместимый API — несколько моделей</span>
    <h1>Единый ключ, каталог моделей и учёт расходов</h1>
    <p class="lead">Демо кабинета AI-платформы: регистрация, workspace, API-ключи, playground и usage.
    Сейчас работает на mock-данных в вашем браузере; API-шлюз подключается тем же контрактом позже.</p>
    <div class="row">
      <button onclick="go('/login')">Создать аккаунт</button>
      <button class="ghost" onclick="go('/models')">Каталог моделей</button>
    </div>
  </div>
  <h2>Quickstart</h2>
  <div class="card">
    <div class="code"><span class="c"># 1. выпуск ключа — в разделе «Ключи»</span>
curl https://api.example/v1/chat/completions \\
  -H "Authorization: Bearer <span class="c">ВЫ_КЛЮЧ_ПЛАТФОРМЫ</span>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"mock-mini-1","messages":[{"role":"user","content":"Привет!"}]}'
<span class="c"># base_url и model подставляются из кабинета</span></div>
    <p class="lead" style="margin:10px 0 0">Endpoint и адреса в демо иллюстративные — до подключения реального шлюза.</p>
  </div>
  <h2>Что внутри</h2>
  <div class="grid">
    <div class="card"><strong>Каталог моделей</strong><br><span class="lead">Возможности, лимиты и цена — по каждой модели.</span></div>
    <div class="card"><strong>Playground</strong><br><span class="lead">Тестовый запрос без своего кода.</span></div>
    <div class="card"><strong>Ключи по проектам</strong><br><span class="lead">Выпуск, показ один раз, отзыв.</span></div>
    <div class="card"><strong>Usage</strong><br><span class="lead">Запросы, токены и стоимость — по датам.</span></div>
  </div>`;
}

/* ---------- auth ---------- */
function auth() {
  const app = document.getElementById('app');
  if (state.user) return go('/overview');
  app.innerHTML = `
  <div class="hero"><h1>Вход / регистрация</h1>
  <p class="lead">Демо: письмо с кодом «приходит» сюда же на экран. Пароль хранится только в localStorage.</p></div>
  <div class="card" style="max-width:460px">
    <label>Email</label><input id="email" type="email" placeholder="you@company.ru">
    <label>Пароль (мин. 10 символов)</label><input id="pass" type="password">
    <div class="row" style="margin-top:14px">
      <button onclick="doRegister()">Регистрация</button>
      <button class="ghost" onclick="doLogin()">Войти</button>
    </div>
    <div id="verify-box"></div>
    <p class="lead" style="margin-top:14px">В production: email-письмо с кодом, сессии в HttpOnly-cookie, Argon2id. См. AUTH_SECURITY канона.</p>
  </div>`;
}
function showVerify(email) {
  document.getElementById('verify-box').innerHTML = `
  <div class="key-reveal" style="margin-top:14px">
    <strong>«Письмо» отправлено</strong> на ${esc(email)}<br>Демо-код: <strong>${esc(state.verification.code)}</strong>
    <div class="row" style="margin-top:10px">
      <input id="code" placeholder="6-значный код" style="max-width:160px">
      <button onclick="doVerify('${esc(email)}')">Подтвердить</button>
    </div>
  </div>`;
}
function doRegister() {
  const email = document.getElementById('email').value.trim().toLowerCase();
  const pass = document.getElementById('pass').value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert('Некорректный email');
  if (pass.length < 10) return alert('Пароль: минимум 10 символов');
  state.user = { email, pass, verified: false };
  state.verification = { email, code: String(100000 + Math.floor(Math.random() * 900000)) };
  save(); showVerify(email);
}
function doLogin() {
  const email = document.getElementById('email').value.trim().toLowerCase();
  const pass = document.getElementById('pass').value;
  if (state.user && state.user.email === email && state.user.pass === pass && state.user.verified) return go('/overview');
  alert('Неверный email или пароль (или аккаунт не подтверждён). Зарегистрируйтесь заново.');
}
function doVerify(email) {
  const code = document.getElementById('code').value.trim();
  if (!state.verification || state.verification.email !== email || state.verification.code !== code) return alert('Неверный код');
  state.user.verified = true; state.verification = null; save();
  go('/overview');
}
function logout() { state.user = null; save(); go('/'); render(); }

/* ---------- кабинет ---------- */
function guard() {
  if (!state.user || !state.user.verified) { go('/login'); render(); return false; }
  return true;
}
function overview() {
  if (!guard()) return;
  const app = document.getElementById('app');
  const total = state.usage.length;
  const tokens = state.usage.reduce((s, u) => s + u.tin + u.tout, 0);
  const cost = state.usage.reduce((s, u) => s + u.cost, 0);
  const activeKeys = state.keys.filter((k) => k.status === 'active').length;
  app.innerHTML = `
  <h1>Обзор</h1>
  <p class="lead">Workspace: <strong>${esc(state.user.email)}</strong> (личный) · проект: default · <a href="#" onclick="logout();return false">выйти</a></p>
  <div class="grid">
    <div class="card stat"><div class="n">${fmt(total)}</div><div class="l">запросов</div></div>
    <div class="card stat"><div class="n">${fmt(tokens)}</div><div class="l">токенов всего</div></div>
    <div class="card stat"><div class="n">$${cost.toFixed(4)}</div><div class="l">стоимость (оценка)</div></div>
    <div class="card stat"><div class="n">${activeKeys}</div><div class="l">активных ключей</div></div>
  </div>
  <h2>Быстрые действия</h2>
  <div class="row">
    <button onclick="go('/keys')">Выпустить ключ</button>
    <button class="ghost" onclick="go('/playground')">Открыть playground</button>
  </div>
  <h2>Статус</h2>
  <div class="card"><span class="tag ok">mock-адаптер: active</span> &nbsp; <span class="tag warn">реальный inference: фаза 2</span>
  <p class="lead" style="margin:10px 0 0">Прототип обслуживает только mock-модели; выбор backend (ЦОД / Yandex Cloud) — за владельцем, см. issue R1.</p></div>`;
}

function models() {
  const app = document.getElementById('app');
  app.innerHTML = `
  <h1>Каталог моделей</h1>
  <p class="lead">Публичные id, возможности и цена (source=manual, DEC-E04). Таблица соответствует GET /v1/models.</p>
  <div class="card"><table>
    <tr><th>model</th><th>контекст</th><th>возможности</th><th>цена in/out / 1K</th><th>статус</th></tr>
    ${MODELS.map((m) => `<tr><td class="mono">${esc(m.id)}</td><td>${esc(m.ctx)}</td><td>${esc(m.caps)}</td><td>${esc(m.pin)}</td>
      <td><span class="tag ${m.status === 'active' ? 'ok' : 'warn'}">${m.status}</span></td></tr>`).join('')}
  </table></div>
  <div class="card"><strong>Примечания</strong>
  ${MODELS.map((m) => `<p class="lead" style="margin:8px 0 0">· <span class="mono">${esc(m.id)}</span> — ${esc(m.note)}</p>`).join('')}</div>`;
}

function playground() {
  if (!guard()) return;
  const app = document.getElementById('app');
  app.innerHTML = `
  <h1>Playground</h1>
  <p class="lead">Тестовый запрос к mock-адаптеру. Ответ детерминированный: эхо вашего сообщения + фиксированные поля контракта.</p>
  <div class="card">
    <label>Модель</label>
    <select id="model"><option>mock-mini-1</option><option>mock-mini-1:slow</option></select>
    <label>temperature</label><input id="temp" type="number" step="0.1" min="0" max="2" value="0.7">
    <label>max_tokens</label><input id="maxtok" type="number" min="1" max="512" value="128">
    <label>messages (user)</label>
    <textarea id="prompt">Скажи что-нибудь короткое.</textarea>
    <div class="row" style="margin-top:12px"><button onclick="sendPrompt()">Отправить</button>
    <span class="lead" id="pg-status"></span></div>
    <div id="pg-out"></div>
  </div>`;
}
function sendPrompt() {
  const model = document.getElementById('model').value;
  const prompt = document.getElementById('prompt').value;
  const out = document.getElementById('pg-out');
  const status = document.getElementById('pg-status');
  const key = state.keys.find((k) => k.status === 'active');
  if (!key) { out.innerHTML = `<div class="resp" style="margin-top:12px">{"error":"authentication_error","message":"Нет активного ключа — выпустите его в разделе «Ключи»"}</div>`; return; }
  const slow = model.includes('slow');
  status.textContent = 'mock-адаптер обрабатывает…';
  setTimeout(() => {
    const tin = Math.max(1, Math.ceil(prompt.length / 4));
    const tout = Math.max(1, Math.ceil((prompt.length + 24) / 4));
    const ms = slow ? 400 + Math.floor(Math.random() * 100) : 40 + Math.floor(Math.random() * 60);
    const resp = { id: 'chatcmpl-demo-' + Math.random().toString(36).slice(2, 8), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: `[mock] ${prompt}` }, finish_reason: 'stop' }], usage: { prompt_tokens: tin, completion_tokens: tout, total_tokens: tin + tout, source: 'estimated' } };
    out.innerHTML = `<div class="resp" style="margin-top:12px">${esc(JSON.stringify(resp, null, 2))}</div>`;
    status.textContent = `готово за ${ms} мс · request_id: req-${Math.random().toString(36).slice(2, 10)}`;
    state.usage.unshift({ date: new Date().toISOString().slice(0, 16).replace('T', ' '), project: 'default', model, status: 'ok', ms, tin, tout, cost: 0 });
    save(); nav();
  }, slow ? 450 : 80);
}

function keys() {
  if (!guard()) return;
  const app = document.getElementById('app');
  app.innerHTML = `
  <h1>API-ключи</h1>
  <p class="lead">Ключ привязан к проекту, показывается полностью один раз, в системе хранится hash + prefix. Отзыв — мгновенный.</p>
  <div class="row"><button onclick="createKey()">Выпустить ключ (проект default)</button></div>
  <div id="new-key"></div>
  ${state.keys.length ? `<div class="card"><table>
    <tr><th>prefix</th><th>проект</th><th>создан</th><th>статус</th><th></th></tr>
    ${state.keys.map((k) => `<tr><td class="mono">${esc(k.prefix)}…</td><td>${esc(k.projectId)}</td><td>${esc(k.created)}</td>
      <td><span class="tag ${k.status === 'active' ? 'ok' : 'warn'}">${k.status}</span></td>
      <td>${k.status === 'active' ? `<button class="danger" onclick="revokeKey('${k.id}')">Отозвать</button>` : ''}</td></tr>`).join('')}
  </table></div>` : `<div class="empty">Ключей пока нет</div>`}`;
}
function createKey() {
  const full = 'aip_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  const id = 'k' + Math.random().toString(36).slice(2, 8);
  state.keys.unshift({ id, prefix: full.slice(0, 12), status: 'active', created: new Date().toISOString().slice(0, 10), projectId: 'default' });
  state.secrets[id] = full; save();
  document.getElementById('new-key').innerHTML = `
  <div class="key-reveal"><strong>Ключ показывается один раз — скопируйте сейчас:</strong><br><span class="mono">${esc(full)}</span>
  <p class="lead" style="margin:8px 0 0">В production этот блок не восстановить: хранится только SHA-256 хеш.</p></div>`;
  render();
}
function revokeKey(id) {
  const k = state.keys.find((x) => x.id === id);
  if (!k || !confirm(`Отозвать ключ ${k.prefix}…?`)) return;
  k.status = 'revoked'; delete state.secrets[id]; save(); render();
}

function usage() {
  if (!guard()) return;
  const app = document.getElementById('app');
  app.innerHTML = `
  <h1>Использование</h1>
  <p class="lead">Usage-события прототипа: дата, проект, модель, статус, длительность, токены (source=estimated), стоимость-оценка.</p>
  ${state.usage.length ? `<div class="card"><table>
    <tr><th>дата</th><th>проект</th><th>модель</th><th>статус</th><th>мс</th><th>токены in</th><th>токены out</th><th>$ (оценка)</th></tr>
    ${state.usage.map((u) => `<tr><td>${esc(u.date)}</td><td>${esc(u.project)}</td><td class="mono">${esc(u.model)}</td>
      <td><span class="tag ${u.status === 'ok' ? 'ok' : 'warn'}">${esc(u.status)}</span></td><td>${u.ms}</td><td>${fmt(u.tin)}</td><td>${fmt(u.tout)}</td><td>${u.cost.toFixed(4)}</td></tr>`).join('')}
  </table></div>` : `<div class="empty">Пока нет запросов — отправьте первый в playground</div>`}`;
}

window.addEventListener('hashchange', render);
render();
