/* BRIIX — демо помощников. UI-демо без бэкенда: ответы сценарные, данные в localStorage. */
'use strict';

/* ============ состояние ============ */
const LS = 'briix-assistants-demo-v1';
const defaultState = {
  profile: { name: '', defaultAsst: 'universal' },
  prefs: { theme: 'light', fontSize: 'normal', density: 'normal', enterSend: true, keepHistory: true, demoError: false },
  chats: [],            // { id, asst, title, created, msgs: [{role, text, ts, fav, rating}], fav }
  prompts: [],          // { id, text, asst, cat, fav }
  favorites: [],        // { kind: 'chat'|'msg'|'prompt', ref }
};
function load() {
  try { const raw = localStorage.getItem(LS); return raw ? { ...structuredClone(defaultState), ...JSON.parse(raw) } : structuredClone(defaultState); }
  catch { return structuredClone(defaultState); }
}
let storageOK = true;
try { localStorage.setItem('t', '1'); localStorage.removeItem('t'); } catch { storageOK = false; }
let state = load();
function save() { if (storageOK && state.prefs.keepHistory !== undefined) { try { localStorage.setItem(LS, JSON.stringify(state)); } catch {} } }

/* ============ помощники ============ */
const ASSISTANTS = {
  universal:   { ico: '✨', name: 'Универсальный',   desc: 'На любые вопросы',      cat: 'общее' },
  editor:      { ico: '✏️', name: 'Редактор',        desc: 'Тексты и правки',       cat: 'текст' },
  analyst:     { ico: '📊', name: 'Аналитик',        desc: 'Числа и выводы',        cat: 'данные' },
  developer:   { ico: '💻', name: 'Разработчик',     desc: 'Код и отладка',         cat: 'код' },
  marketer:    { ico: '📣', name: 'Маркетолог',      desc: 'Кампании и тексты',     cat: 'маркетинг' },
  mentor:      { ico: '🧭', name: 'Наставник',       desc: 'Учёба и план развития', cat: 'обучение' },
};
function asstId(a) { return ASSISTANTS[a] ? a : 'universal'; }

/* ============ библиотека промптов (18) ============ */
const PROMPT_LIB = [
  { text: 'Составь план поста для соцсетей о запуске нового продукта', asst: 'marketer', cat: 'маркетинг' },
  { text: 'Придумай 5 вариантов заголовка для статьи про экономию времени', asst: 'marketer', cat: 'маркетинг' },
  { text: 'Напиши email-приглашение на вебинар в 3 абзацах', asst: 'marketer', cat: 'маркетинг' },
  { text: 'Отредактируй этот текст: сделай короче и живее — «Наш сервис предоставляет возможность…»', asst: 'editor', cat: 'текст' },
  { text: 'Проверь грамматику и стиль: «мы делаем качественный продукт который нравится всем»', asst: 'editor', cat: 'текст' },
  { text: 'Перепиши формальное письмо в дружелюбный тон', asst: 'editor', cat: 'текст' },
  { text: 'Объясни разницу между MES и ETL простыми словами', asst: 'analyst', cat: 'данные' },
  { text: 'Какие метрики важны для SaaS на старте? Составь список из 7', asst: 'analyst', cat: 'данные' },
  { text: 'Помоги прочитать таблицу продаж: на что смотреть в первую очередь', asst: 'analyst', cat: 'данные' },
  { text: 'Напиши функцию debounce на JavaScript с комментариями', asst: 'developer', cat: 'код' },
  { text: 'Разбери ошибку «cannot read property of undefined» — типовые причины', asst: 'developer', cat: 'код' },
  { text: 'Составь чек-лист код-ревью для маленькой команды', asst: 'developer', cat: 'код' },
  { text: 'Составь план обучения React на 4 недели по 1 часу в день', asst: 'mentor', cat: 'обучение' },
  { text: 'Как готовиться к собеседованию на джуна: план на неделю', asst: 'mentor', cat: 'обучение' },
  { text: 'Помоги выбрать между двумя офферами — задай мне вопросы', asst: 'mentor', cat: 'обучение' },
  { text: 'Составь план дня из 5 задач: спорт, работа, учёба, отдых', asst: 'universal', cat: 'общее' },
  { text: 'Объясни тему рекурсии так, чтобы понял новичок', asst: 'universal', cat: 'общее' },
  { text: 'Помоги сформулировать цель на квартал по SMART', asst: 'universal', cat: 'общее' },
];

/* ============ утилиты ============ */
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid(p) { return p + Math.random().toString(36).slice(2, 9); }
function now() { return new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function $id(i) { return document.getElementById(i); }

/* ============ сценарные ответы ============ */
function scenarioReply(asst, userText) {
  const t = userText.toLowerCase();
  const common = (a, b) => `${a}\n\n${b}\n\n_Ответ сценарный (демо): нейросеть не подключена, формулировки иллюстративные._`;
  if (state.prefs.demoError && Math.random() < 0.5) return { error: true, text: '⚠️ Демонстрационная ошибка из настроек. Нажмите «Повторить».' };
  if (asst === 'developer' && /код|функци|script|debounce|ошибк/.test(t))
    return common('Разбираем. Типовой подход такой:\n\n```js\nfunction debounce(fn, ms) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n}\n```\nКлючевая идея: таймер сбрасывается на каждый вызов, функция сработает только после паузы.', 'Если пришлёте свой фрагмент — разберу конкретный случай.');
  if (asst === 'editor' && /редактир|короче|стил|граммат/.test(t))
    return common('Правки по тексту:\n\n1. Убрать канцелярит («предоставляет возможность» → «позволяет»);\n2. Разбить длинные предложения;\n3. Заменить пассив на активный залог.\n\nПришлите полный текст — верну отредактированную версию с пояснением каждой правки.', 'Формат правок можно менять: только итог / итог + пояснения.');
  if (asst === 'analyst' && /метрик|числ|таблиц|данн/.test(t))
    return common('Стартовый набор метрик для продукта:\n\n1. Activation — доля новых пользователей с первым успешным действием;\n2. Time-to-first-success;\n3. Retention 7/30;\n4. Конверсия в оплату;\n5. Средний чек;\n6. Стоимость привлечения (CAC);\n7. Валовая маржа.\n\nПо таблице продаж: смотрим выбросы по периодам, затем долю топ-3 позиций.', 'Демо: расчёты по вашим числам появятся с подключением модели.');
  if (asst === 'marketer' && /пост|заголов|кампан|email/.test(t))
    return common('Вариант поста:\n\n«Мы убрали рутину из вашей рабочей недели. Рассказываем, что изменилось и как это попробовать уже сегодня 👇»\n\nЗаголовки для статьи:\n1. Час работы — за 10 минут;\n2. Как перестать делать вручную то, что умеет делать машина;\n3. Экономия времени: цифры, а не лозунги;\n4. Ваш новый ассистент уже здесь;\n5. От рутины к результату.', 'Тон можно сдвинуть: строгий / разговорный / с юмором.');
  if (asst === 'mentor' && /план|обуч|собес|курс/.test(t))
    return common('План на 4 недели (по 1 часу в день):\n\n· Неделя 1 — основы, ежедневная практика по 20 минут теории + 40 минут упражнений;\n· Неделя 2 — мини-проект №1;\n· Неделя 3 — мини-проект №2 + разбор чужого кода;\n· Неделя 4 — повторение, портфолио, подготовка вопросов.\n\nЧтобы уточнить план: какой у вас текущий уровень и сколько часов в день реально есть?', 'Демо-наставник задаёт вопросы и ведёт по плану.');
  if (/привет|здравств|hello/.test(t)) return common('Привет! Я демо-помощник. Выберите сценарий из примеров или задайте свой вопрос — покажу, как устроен интерфейс: история, избранное, повтор, альтернативы.', '');
  return common(`Принял запрос: «${userText.slice(0, 80)}${userText.length > 80 ? '…' : ''}».\n\nВ демо-режиме у меня сценарные ответы: я показываю структуру и тон, характерные для роли «${ASSISTANTS[asst].name}». В продакшн-версии здесь будет ответ модели через API-шлюз платформы.`, 'Попробуйте другой помощник или пример из библиотеки.');
}
function altVariant(asst) {
  return commonAlt(`Альтернативный вариант (демо): более короткая формулировка в стиле «${ASSISTANTS[asst].name}», без списка — одним абзацем. Показывает, как в интерфейсе выглядит переключение между вариантами ответа.`);
}
function commonAlt(text) { return `${text}\n\n_Сценарный ответ (демо)._`; }

/* ============ роутинг ============ */
const routes = { '/': home, '/chat': chat, '/prompts': prompts, '/history': history, '/favorites': favorites, '/settings': settings, '/export': exportView };
function nav() {
  const links = [['/', 'Помощники'], ['/prompts', 'Промпты'], ['/history', 'История'], ['/favorites', '★ Избранное'], ['/settings', 'Настройки']];
  const h = location.hash || '#/';
  $id('nav').innerHTML = links.map(([u, t]) => `<a href="#${u}" class="${h === `#${u}` ? 'active' : ''}">${t}</a>`).join('');
}
function render() { nav(); applyPrefs(); const p = (location.hash || '#/').slice(1).split('?')[0]; (routes[p] || home)(); window.scrollTo(0, 0); }
function go(p) { location.hash = p; }
function applyPrefs() {
  document.body.classList.toggle('dark', state.prefs.theme === 'dark');
  document.body.classList.toggle('big-text', state.prefs.fontSize === 'big');
  document.body.classList.toggle('dense', state.prefs.density === 'dense');
}

/* ============ главный экран: выбор помощника ============ */
function home() {
  const name = state.profile.name ? state.profile.name : 'привет';
  $id('app').innerHTML = `
  <div class="hero"><span class="pill">UI-демо — прорабатываем пользовательский опыт</span>
  <h1>${esc(name)}, выберите помощника</h1>
  <p class="lead">Шесть ролей со своими сценариями ответов. Бэкенд не подключён: ответы сценарные, это видно в интерфейсе и в примечании под чатом.</p></div>
  <div class="asst-grid">
    ${Object.entries(ASSISTANTS).map(([id, a]) => `
      <button class="asst" onclick="openChat('${id}')"><div class="ico">${a.ico}</div><div class="nm">${a.name}</div><div class="ds">${a.desc}</div></button>`).join('')}
  </div>
  <h2>Популярные сценарии</h2>
  ${PROMPT_LIB.slice(0, 4).map((p) => `<div class="list-item"><span class="ttl" style="cursor:pointer" onclick="openChat('${p.asst}', '${esc(p.text).replace(/'/g, '&#39;')}')">${esc(p.text)}</span><div class="sub">${ASSISTANTS[p.asst].ico} ${ASSISTANTS[p.asst].name}</div></div>`).join('')}
  ${storageOK ? '' : '<div class="demo-note">localStorage недоступен — история и настройки не сохранятся между перезагрузками.</div>'}
  <div class="demo-note">Демо-режим: без бэкенда, без сети, данные — только в этом браузере. Дизайн-система: <a href="/site/">сайт BRIIX</a>.</div>`;
}
function openChat(asst, presetPrompt) {
  currentAsst = asstId(asst);
  currentChat = null;
  if (presetPrompt) pendingPrompt = presetPrompt; else pendingPrompt = null;
  go('/chat');
}

/* ============ чат ============ */
let currentAsst = 'universal';
let currentChat = null;
let pendingPrompt = null;
let abortFlag = false;

function chat() {
  if (!currentChat) {
    currentChat = { id: uid('c'), asst: currentAsst, title: 'Новый диалог', created: now(), msgs: [], fav: false };
  }
  const a = ASSISTANTS[currentAsst];
  $id('app').innerHTML = `
  <div class="chat-wrap">
    <div class="row" style="margin-bottom:8px"><a href="#/" style="text-decoration:none;color:var(--faint);font-size:14px">← помощники</a>
      <strong>${a.ico} ${a.name}</strong><span class="lead" style="margin:0">· ${esc(currentChat.title)}</span></div>
    <div class="chat-log" id="chat-log"></div>
    <div class="composer"><div class="box">
      <button class="ghost" style="border:none;font-size:18px;padding:4px 8px" title="Приложить файл (заглушка)" onclick="document.getElementById('file-in').click()">📎</button>
      <input type="file" id="file-in" style="display:none" onchange="attachFile(this)">
      <textarea id="msg-in" placeholder="Сообщение… ${state.prefs.enterSend ? '(Enter — отправить)' : '(Ctrl+Enter — отправить)'}"></textarea>
      <button id="send-btn" onclick="sendMsg()">➤</button>
    </div><div id="attach-zone"></div>
    <div class="demo-note" style="margin:8px 0 0">Сценарные ответы, нейросеть не подключена. Вложения-заглушки: имя файла видно, содержимое не читается и никуда не отправляется.</div></div>
  </div>`;
  $id('msg-in').addEventListener('keydown', (e) => {
    if ((state.prefs.enterSend && e.key === 'Enter' && !e.shiftKey) || (!state.prefs.enterSend && e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); sendMsg(); }
  });
  drawChat();
  if (pendingPrompt) { const p = pendingPrompt; pendingPrompt = null; $id('msg-in').value = p; sendMsg(); }
}
let attached = null;
function attachFile(inp) {
  const f = inp.files && inp.files[0];
  if (!f) return;
  attached = { name: f.name, size: f.size };
  $id('attach-zone').innerHTML = `<span class="attach-chip">📎 ${esc(f.name)} (${Math.ceil(f.size / 1024)} КБ) — заглушка, содержимое не читается <button class="meta" style="border:none;background:none;color:var(--danger);cursor:pointer" onclick="attached=null;document.getElementById('attach-zone').innerHTML=''">✕</button></span>`;
}
function drawChat() {
  const log = $id('chat-log'); if (!log) return;
  log.innerHTML = currentChat.msgs.map((m, i) => m.role === 'user'
    ? `<div class="msg user">${esc(m.text)}</div>`
    : `<div class="msg bot">${esc(m.text)}<div class="meta">
        <button onclick="favMsg(${i})" class="${m.fav ? 'on' : ''}" style="color:${m.fav ? 'var(--warn)' : 'var(--accent)'}">${m.fav ? '★ в избранном' : '☆ в избранное'}</button>
        <button onclick="copyMsg(${i})">копировать</button>
        <button onclick="retryMsg(${i})">повторить</button>
        <button onclick="altMsg(${i})">альтернатива</button>
        <span style="color:${m.rating === 1 ? 'var(--ok)' : 'inherit'};cursor:pointer" onclick="rateMsg(${i},1)">👍</span>
        <span style="color:${m.rating === -1 ? 'var(--danger)' : 'inherit'};cursor:pointer" onclick="rateMsg(${i},-1)">👎</span>
      </div></div>`).join('') +
    (currentChat.msgs.length === 0 ? `<div class="empty">Задайте вопрос или выберите пример.<br><br>${PROMPT_LIB.filter(p=>p.asst===currentAsst).slice(0,3).map(p=>`<button class="ghost" style="font-size:13px;margin:4px" onclick="document.getElementById('msg-in').value='${esc(p.text).replace(/'/g, '&#39;')}';sendMsg()">${esc(p.text)}</button>`).join('')}</div>` : '');
  log.scrollTop = log.scrollHeight;
}
function sendMsg() {
  const inp = $id('msg-in'); const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  currentChat.msgs.push({ role: 'user', text, ts: now() });
  if (currentChat.msgs.length === 1) { currentChat.title = text.slice(0, 40); currentChat.created = now(); }
  const reply = scenarioReply(currentAsst, text);
  drawChat();
  streamReply(reply);
}
function streamReply(reply) {
  const log = $id('chat-log');
  const typing = document.createElement('div'); typing.className = 'typing'; typing.textContent = 'печатает…'; log.appendChild(typing);
  abortFlag = false;
  const btn = $id('send-btn'); btn.textContent = '■ стоп'; btn.onclick = () => { abortFlag = true; };
  setTimeout(() => {
    typing.remove();
    if (abortFlag) {
      currentChat.msgs.push({ role: 'bot', text: '_Генерация остановлена._', ts: now(), stopped: true });
      btn.textContent = '➤'; btn.onclick = sendMsg; drawChat(); save(); return;
    }
    if (reply.error) {
      currentChat.msgs.push({ role: 'bot', text: reply.text, ts: now(), error: true });
      btn.textContent = '➤'; btn.onclick = sendMsg; drawChat(); save(); return;
    }
    const msg = { role: 'bot', text: '', ts: now() };
    currentChat.msgs.push(msg);
    const i = currentChat.msgs.length - 1;
    let pos = 0;
    const full = reply.text;
    const step = Math.max(2, Math.floor(full.length / 40));
    const timer = setInterval(() => {
      if (abortFlag) { clearInterval(timer); msg.text += full.slice(pos); btn.textContent = '➤'; btn.onclick = sendMsg; drawChat(); save(); return; }
      pos = Math.min(full.length, pos + step);
      msg.text = full.slice(0, pos);
      const botEls = log.querySelectorAll('.msg.bot'); const last = botEls[botEls.length - 1];
      if (last) { last.textContent = msg.text; }
      if (pos >= full.length) { clearInterval(timer); btn.textContent = '➤'; btn.onclick = sendMsg; drawChat(); save(); }
    }, 30);
  }, 300 + Math.random() * 500);
}
function retryMsg(i) {
  const prevUser = [...currentChat.msgs.slice(0, i)].reverse().find((m) => m.role === 'user');
  currentChat.msgs.splice(i, 1);
  drawChat();
  if (prevUser) streamReply(scenarioReply(currentAsst, prevUser.text));
}
function altMsg(i) {
  currentChat.msgs[i].text = altVariant(currentAsst);
  currentChat.msgs[i].rating = 0;
  drawChat(); save();
}
function favMsg(i) { const m = currentChat.msgs[i]; m.fav = !m.fav; if (m.fav) state.favorites.push({ kind: 'msg', ref: { chat: currentChat.id, idx: i, asst: currentChat.asst, text: m.text.slice(0, 120) } }); save(); drawChat(); }
function copyMsg(i) {
  const t = currentChat.msgs[i].text;
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => flash('Скопировано'), () => flash('Не удалось скопировать'));
  else flash('Копирование недоступно');
}
function rateMsg(i, r) { const m = currentChat.msgs[i]; m.rating = m.rating === r ? 0 : r; save(); drawChat(); }
function flash(text) { const b = document.createElement('div'); b.className = 'typing'; b.style.alignSelf = 'center'; b.textContent = text; $id('chat-log').appendChild(b); setTimeout(() => b.remove(), 1400); }

/* ============ библиотека промптов ============ */
let promptFilter = { cat: 'все', q: '' };
function ensurePrompts() { if (state.prompts.length === 0) state.prompts = PROMPT_LIB.map((p) => ({ id: uid('p'), ...p, fav: false })); }
function prompts() {
  ensurePrompts();
  const cats = ['все', ...new Set(state.prompts.map((p) => p.cat))];
  const list = state.prompts.filter((p) => (promptFilter.cat === 'все' || p.cat === promptFilter.cat) && (!promptFilter.q || p.text.toLowerCase().includes(promptFilter.q.toLowerCase())));
  $id('app').innerHTML = `
  <h1>Библиотека промптов</h1><p class="lead">${state.prompts.length} примеров. Нажмите — откроется чат с этим запросом. ★ — в избранное.</p>
  <div class="filters">${cats.map((c) => `<button class="${promptFilter.cat === c ? 'on' : ''}" onclick="promptFilter.cat='${c}';prompts()">${c}</button>`).join('')}</div>
  <div class="search"><input id="pq" placeholder="Поиск по промптам…" value="${esc(promptFilter.q)}" oninput="promptFilter.q=this.value;promptsSearch()"></div>
  <div id="plist">${list.map((p) => `<div class="list-item"><div class="row2"><span class="ttl" onclick="openChat('${p.asst}','${esc(p.text).replace(/'/g, '&#39;')}')">${esc(p.text)}</span>
    <span class="fav-btn ${p.fav ? 'on' : ''}" onclick="togglePromptFav('${p.id}')">★</span></div>
    <div class="sub">${ASSISTANTS[p.asst].ico} ${ASSISTANTS[p.asst].name} · ${p.cat}</div></div>`).join('') || '<div class="empty">Ничего не найдено</div>'}</div>`;
}
function promptsSearch() { promptFilter.q = $id('pq').value; const pos = $id('pq').selectionStart; prompts(); const el = $id('pq'); el.focus(); el.setSelectionRange(pos, pos); }
function togglePromptFav(id) { const p = state.prompts.find((x) => x.id === id); p.fav = !p.fav; if (p.fav) state.favorites.push({ kind: 'prompt', ref: { id, text: p.text, asst: p.asst } }); save(); }

/* ============ история ============ */
let historyQ = '';
function history() {
  const list = state.chats.filter((c) => !historyQ || c.title.toLowerCase().includes(historyQ.toLowerCase()) || c.msgs.some((m) => m.text.toLowerCase().includes(historyQ.toLowerCase())));
  $id('app').innerHTML = `
  <h1>История диалогов</h1><p class="lead">${state.chats.length} диалогов. Поиск — по заголовкам и содержимому.</p>
  <div class="search"><input id="hq" placeholder="Поиск по истории…" value="${esc(historyQ)}" oninput="historyQ=this.value;historySearch()"></div>
  ${list.map((c) => `<div class="list-item"><div class="row2">
    <span class="ttl" onclick="openChatById('${c.id}')">${ASSISTANTS[c.asst].ico} ${esc(c.title)}</span>
    <span><span class="fav-btn ${c.fav ? 'on' : ''}" onclick="toggleChatFav('${c.id}')">★</span>
    <button class="danger" style="padding:3px 10px;font-size:12px" onclick="delChat('${c.id}')">удалить</button></span></div>
    <div class="sub">${c.msgs.length} сообщений · ${esc(c.created)}${c.msgs.length ? ' · ' + esc(c.msgs[c.msgs.length - 1].text.slice(0, 60)) + '…' : ''}</div></div>`).join('') || '<div class="empty">Диалогов пока нет</div>'}
  <h2>Поиск по промптам</h2>
  <div class="search"><input placeholder="Найти промпт…" oninput="historyPromptQ=this.value;historyPromptSearch(this)"></div><div id="hp-res"></div>`;
}
let historyPromptQ = '';
function historySearch() { historyQ = $id('hq').value; const pos = $id('hq').selectionStart; history(); const el = $id('hq'); el.focus(); el.setSelectionRange(pos, pos); }
function historyPromptSearch(inp) { historyPromptQ = inp.value; const res = PROMPT_LIB.filter((p) => !historyPromptQ || p.text.toLowerCase().includes(historyPromptQ.toLowerCase())); $id('hp-res').innerHTML = res.map((p) => `<div class="list-item"><span class="ttl" onclick="openChat('${p.asst}','${esc(p.text).replace(/'/g, '&#39;')}')">${esc(p.text)}</span><div class="sub">${ASSISTANTS[p.asst].ico} ${ASSISTANTS[p.asst].name}</div></div>`).join('') || '<div class="empty">Ничего не найдено</div>'; }
function openChatById(id) { currentChat = state.chats.find((c) => c.id === id); currentAsst = currentChat ? currentChat.asst : 'universal'; go('/chat'); render(); }
function toggleChatFav(id) { const c = state.chats.find((x) => x.id === id); c.fav = !c.fav; if (c.fav) state.favorites.push({ kind: 'chat', ref: { id, title: c.title } }); save(); history(); }
function delChat(id) { if (!confirm('Удалить диалог?')) return; state.chats = state.chats.filter((c) => c.id !== id); if (currentChat && currentChat.id === id) currentChat = null; save(); history(); }

/* ============ избранное ============ */
function favorites() {
  const msgs = state.favorites.filter((f) => f.kind === 'msg');
  const promptsF = state.prompts.filter((p) => p.fav);
  $id('app').innerHTML = `
  <h1>★ Избранное</h1>
  <h2>Ответы (${msgs.length})</h2>
  ${msgs.map((f) => `<div class="list-item"><span class="ttl" onclick="openChatById('${f.ref.chat}')">${ASSISTANTS[f.ref.asst] ? ASSISTANTS[f.ref.asst].ico : ''} ${esc(f.ref.text)}…</span><div class="sub">${ASSISTANTS[f.ref.asst] ? ASSISTANTS[f.ref.asst].name : ''}</div></div>`).join('') || '<div class="empty">Пусто — отмечайте ответы ☆ в чате</div>'}
  <h2>Промпты (${promptsF.length})</h2>
  ${promptsF.map((p) => `<div class="list-item"><span class="ttl" onclick="openChat('${p.asst}','${esc(p.text).replace(/'/g, '&#39;')}')">${esc(p.text)}</span><div class="sub">${ASSISTANTS[p.asst].ico} ${ASSISTANTS[p.asst].name}</div></div>`).join('') || '<div class="empty">Пусто — отмечайте промпты ★ в библиотеке</div>'}`;
}

/* ============ настройки ============ */
function settings() {
  const p = state.prefs, pr = state.profile;
  $id('app').innerHTML = `
  <h1>Настройки</h1>
  <div class="card">
    <div class="set-row"><span>Тема</span><select onchange="state.prefs.theme=this.value;save();applyPrefs()"><option value="light" ${p.theme==='light'?'selected':''}>Светлая</option><option value="dark" ${p.theme==='dark'?'selected':''}>Тёмная</option></select></div>
    <div class="set-row"><span>Размер текста</span><select onchange="state.prefs.fontSize=this.value;save();applyPrefs()"><option value="normal" ${p.fontSize==='normal'?'selected':''}>Обычный</option><option value="big" ${p.fontSize==='big'?'selected':''}>Крупный</option></select></div>
    <div class="set-row"><span>Плотность сообщений</span><select onchange="state.prefs.density=this.value;save();applyPrefs()"><option value="normal" ${p.density==='normal'?'selected':''}>Обычная</option><option value="dense" ${p.density==='dense'?'selected':''}>Компактная</option></select></div>
    <div class="set-row"><span>Ваше имя (для приветствия)</span><input style="max-width:200px" value="${esc(pr.name)}" onchange="state.profile.name=this.value.trim();save()"></div>
    <div class="set-row"><span>Помощник по умолчанию</span><select onchange="state.profile.defaultAsst=this.value;save()">${Object.entries(ASSISTANTS).map(([id,a])=>`<option value="${id}" ${pr.defaultAsst===id?'selected':''}>${a.name}</option>`).join('')}</select></div>
    <div class="set-row"><span>Отправка по Enter</span><input type="checkbox" ${p.enterSend?'checked':''} onchange="state.prefs.enterSend=this.checked;save()"></div>
    <div class="set-row"><span>Сохранять историю</span><input type="checkbox" ${p.keepHistory?'checked':''} onchange="state.prefs.keepHistory=this.checked;save(); if(!this.checked) { state.chats=[]; }"></div>
    <div class="set-row"><span>Демонстрационная ошибка ответов</span><input type="checkbox" ${p.demoError?'checked':''} onchange="state.prefs.demoError=this.checked;save()"></div>
  </div>
  <div class="demo-note">Все настройки локальные. «История» off — диалоги не сохраняются и очищаются. «Демо-ошибка» — для проверки повтора после сбоя.</div>
  ${storageOK ? '' : '<div class="demo-note">localStorage недоступен в этом браузере — настройки не переживут перезагрузку.</div>'}`;
}

/* ============ экспорт / импорт ============ */
function exportView() {
  $id('app').innerHTML = `
  <h1>Экспорт и импорт</h1>
  <div class="card"><h2 style="margin-top:0">Диалог в Markdown</h2>
  <div class="row"><select id="exp-chat">${state.chats.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('') || '<option>нет диалогов</option>'}</select>
  <button class="ghost" onclick="exportMd()">Скачать .md</button></div></div>
  <div class="card"><h2 style="margin-top:0">Всё состояние (JSON)</h2>
  <div class="row"><button onclick="exportJson()">Скачать JSON</button>
  <label style="margin:0 12px 0 0">Импорт:</label><input type="file" id="imp-json" accept=".json" onchange="importJson(this)"></div>
  <p class="lead" style="margin-top:10px">Импорт заменяет текущее состояние. JSON содержит только локальные демо-данные.</p></div>`;
}
function chatToMd(c) {
  return `# ${c.title}\n_Помощник: ${ASSISTANTS[c.asst].name} · ${c.created}_\n\n` + c.msgs.map((m) => `**${m.role === 'user' ? 'Вы' : ASSISTANTS[c.asst].name}:**\n\n${m.text}`).join('\n\n---\n\n');
}
function download(name, content, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function exportMd() { const c = state.chats.find((x) => x.id === $id('exp-chat').value); if (c) download(`dialog-${c.id}.md`, chatToMd(c), 'text/markdown'); }
function exportJson() { download('briix-demo-state.json', JSON.stringify(state, null, 2), 'application/json'); }
function importJson(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { const d = JSON.parse(r.result); if (!d.chats || !d.prefs) throw new Error('bad'); state = { ...structuredClone(defaultState), ...d }; save(); go('/'); render(); flashImport('Импортировано'); } catch { alert('Файл не похож на экспорт демо'); } };
  r.readAsText(f);
}
function flashImport(t) { alert(t); }

/* ============ сохранение диалога в историю ============ */
const _origSave = save;
save = function () {
  if (state.prefs.keepHistory && currentChat && currentChat.msgs.length) {
    const idx = state.chats.findIndex((c) => c.id === currentChat.id);
    if (idx === -1) state.chats.unshift(currentChat); else state.chats[idx] = currentChat;
  }
  _origSave();
};
window.addEventListener('hashchange', render);
currentAsst = state.profile.defaultAsst || 'universal';
render();
