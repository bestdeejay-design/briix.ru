/* BRIIX Studio v2 — composer-first standalone screen: chat / photo / music.
 * Own minimal transport (pattern of bus-live.js, no shared code). No secrets in git.
 * Chat: SSE stream from /v1/chat/completions. Photo/Music: POST /jobs + polling.
 * "Улучшить": few-shot from assets/data/creative-base.json (owner's own style base).
 */
(() => {
  'use strict';

  const DEFAULT_SERVER = 'http://127.0.0.1:8300';
  const SERVER_KEY = 'briix-media-live-server';
  const TOKEN_KEY = 'briix-media-live-token';
  const MUSIC_MODELS = { flash: 'ace-step-flash', pro: 'ace-step-pro' };
  const MODEL_LABELS = { flash: 'Flash', pro: 'Pro' };
  // Длительность — пресеты (владелец: не жёсткие секунды, дефолт не 5 минут).
  const DUR_PRESETS = [
    { key: 'short', label: 'Короткая', sub: '~30 с', sec: 30 },
    { key: 'std', label: 'Стандарт', sub: '~1,5 мин', sec: 90 },
    { key: 'full', label: 'Полная', sub: '~3–5 мин', sec: 300 },
  ];
  const durationSec = () => (DUR_PRESETS.find(p => p.key === durKey) || DUR_PRESETS[1]).sec;
  const MODE_LABELS = { chat: 'Чат', photo: 'Фото', music: 'Музыка' };
  const SEND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  const PLACEHOLDERS = {
    chat: 'Что создаём?',
    photo: 'Что рисуем? Опишите изображение…',
    music: 'Опиши трек…'
  };

  const ASSISTANTS = {
    chat: [
      { id: 'mentor', name: 'Наставник (общий)', system: 'Ты «Наставник» — дружелюбный универсальный собеседник студии BRIIX. Отвечай по-русски, по делу и кратко: 2–6 абзацев максимум. Если вопрос про музыку, фото или промпты — помоги практическим советом и предложи, какой режим студии (чат/фото/музыка) удобнее для следующего шага.' },
      { id: 'universal', name: 'Универсальный', system: 'Ты «Универсальный» помощник BRIIX. Для повседневных задач: разложи мысль по полочкам, предложи идеи и наметь следующий шаг. Отвечай по-русски, просто и структурировано (шаги/списки), без канцелярита. Если задача сложная — сначала короткий план, потом детали.' },
      { id: 'editor', name: 'Редактор', system: 'Ты «Редактор» BRIIX. Делай текст точнее и живее: убирай воду и канцелярит, усиливай глаголы, чини ритм предложений. Сначала дай исправленную версию целиком, потом 2–4 пункта «что изменил и почему» по-русски. Стиль автора сохраняй.' },
      { id: 'analyst', name: 'Аналитик', system: 'Ты «Аналитик» BRIIX. Видишь главное в данных и текстах: структурируй факты, выделяй 3–5 ключевых выводов, отделяй факты от предположений, указывай, чего не хватает для уверенного вывода. Отвечай по-русски, таблицы/списки приветствуются.' },
      { id: 'developer', name: 'Разработчик', system: 'Ты «Разработчик» BRIIX. От логики до рабочего кода: уточни требования одним коротким вопросом, если неясно; давай рабочее решение с краткими комментариями; предупреждай о крайних случаях и ошибках. Языки — по задаче. Пояснения по-русски.' },
      { id: 'marketer', name: 'Маркетолог', system: 'Ты «Маркетолог» BRIIX. Попадаешь в потребность аудитории: формулируй офферы, заголовки, тексты объявлений и постов; объясняй, на какой триггер опирается каждый вариант. Давай 2–3 варианта на выбор. По-русски, живым языком.' },
      { id: 'mentor2', name: 'Наставник (обучение)', system: 'Ты «Наставник (обучение)» BRIIX. Цель — понять, а не просто запомнить: объясняй от простого к сложному, на примерах из жизни, с аналогиями; проверяй понимание короткими вопросами; по-русски.' }
    ],
    photo: [
      { id: 'art-dir', name: 'Арт-директор (FLUX)', system: 'Ты «Арт-директор» — улучшаешь промпты для генерации изображений (FLUX). Преврати идею пользователя в детальный англоязычный промпт: субъект, композиция, свет, палитра, стиль, объектив/ракурс, атмосфера. Без воды — только готовый промпт и одно короткое пояснение по-русски.' },
      { id: 'visual-designer', name: 'Визуальный дизайнер', system: 'Ты «Визуальный дизайнер» BRIIX (фото/кадр/свет/стиль). Помогай придумать визуальную концепцию: сюжет, настроение, палитру, свет, ракурс, стиль референса — и собирай из этого готовый англоязычный промпт для FLUX. Пояснения по-русски.' }
    ],
    music: [
      { id: 'producer', name: 'Продюсер', system: 'Ты «Продюсер» — помогаешь довести музыкальный промпт для ACE-Step. Работай с англоязычным описанием стиля: жанр, BPM, вокал, инструменты, продакшн, структура, негативные указания. Отвечай по-русски кратко и конкретно, сам промпт — по-английски одной строкой.' },
      { id: 'lyricist', name: 'Лирик', system: 'Ты «Лирик» — поэт-песенник. Помогай доработать лирику: образность, ритм, рифма, структура (куплет/припев/бридж), характер вокала в ремарках. Пиши по-русски (или в языке пользователя), держи строку пропеваемой, избегай штампов. Предлагай правки точечно, не переписывая всё без нужды.' },
      { id: 'songwriter', name: 'Автор песни', system: 'Ты «Автор песни» BRIIX. Из темы пользователя пиши полную лирику: [verse], [pre-chorus], [chorus], [bridge], [outro] — образно и пропеваемо, без штампов, 16–40 строк. Всегда по-русски (если не попросили иначе). Пояснений минимум: коротко об управлении настроением и характером вокала.' }
    ]
  };

  // ---- transport (as v1) ----------------------------------------------------
  const server = () => {
    const host = location.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return location.origin + '/api';
    try { return JSON.parse(localStorage.getItem(SERVER_KEY)) || DEFAULT_SERVER; } catch { return DEFAULT_SERVER; }
  };
  const token = () => localStorage.getItem(TOKEN_KEY) || '';
  const setToken = v => { const s = String(v || '').trim(); if (s) localStorage.setItem(TOKEN_KEY, s); else localStorage.removeItem(TOKEN_KEY); };
  // Ключ из ссылки (?key=...) — для показов: открыл ссылку с ключом, ключ сохранился сам
  try {
    const urlKey = new URLSearchParams(location.search).get('key');
    if (urlKey && urlKey.trim()) setToken(urlKey);
  } catch { /* ignore */ }
  const headers = () => ({ Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' });

  class BusError extends Error {
    constructor(code, message, status = 0) { super(message || code); this.code = code; this.status = status; }
  }

  async function request(path, options = {}) {
    let response;
    try { response = await fetch(server() + path, options); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new BusError('network', 'Стенд недоступен: ' + server() + ' не отвечает.');
    }
    if (response.status === 401) throw new BusError('unauthorized', 'Ключ отклонён стендом (401). Проверьте ключ.', 401);
    if (response.status === 422 || response.status === 400) {
      let payload = null;
      try { payload = await response.json(); } catch { /* пустое тело */ }
      const code = payload?.error?.code || (response.status === 422 ? 'content_blocked' : 'bad_params');
      const message = payload?.error?.message || (response.status === 422 ? 'Не пройдена проверка контента.' : 'Сервер отклонил параметры запроса.');
      throw new BusError(code, message, response.status);
    }
    if (response.status === 429) throw new BusError('queue_full', 'Очередь сервера заполнена.', 429);
    if (response.status === 503) throw new BusError('unavailable', 'Сервер или бэкенд недоступен.', 503);
    if (!response.ok) throw new BusError('http', 'Сервер ответил ' + response.status + '.', response.status);
    return response;
  }

  async function chatNonStream({ messages, maxTokens, signal }) {
    const response = await request('/v1/chat/completions', {
      method: 'POST', headers: headers(), signal,
      body: JSON.stringify({ messages, stream: false, max_tokens: maxTokens || 600 })
    });
    const payload = await response.json();
    if (payload?.error) throw new BusError(payload.error.code || 'upstream_error', payload.error.message);
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new BusError('bad_response', 'Сервер вернул ответ без текста.');
    return text;
  }

  function parseEvent(raw) {
    const line = raw.split('\n').find(l => l.startsWith('data:'));
    if (!line) return null;
    const payload = line.slice(5).trim();
    if (!payload) return null;
    if (payload === '[DONE]') return { done: true };
    try { return JSON.parse(payload); } catch { return null; }
  }

  async function chatStream({ messages, onChunk, signal }) {
    const response = await request('/v1/chat/completions', {
      method: 'POST', headers: headers(), signal,
      body: JSON.stringify({ messages, stream: true })
    });
    if (!response.body) throw new BusError('stream_unsupported', 'Браузер не отдал тело потока.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', delivered = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const event = parseEvent(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        if (!event) continue;
        if (event.done) { reader.cancel().catch(() => {}); buffer = ''; break; }
        if (event.error) throw new BusError(event.error.code || 'upstream_error', event.error.message || 'Ошибка бэкенда посреди потока.');
        const piece = event.choices?.[0]?.delta?.content;
        if (piece) { delivered += piece; onChunk?.(piece); }
      }
    }
    if (!delivered) throw new BusError('empty_stream', 'Сервер закрыл поток без текста.');
    return delivered;
  }

  async function submitJob(body) {
    const response = await request('/jobs', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const payload = await response.json();
    if (!payload?.job_id) throw new BusError('bad_response', 'Сервер не вернул job_id.');
    return payload.job_id;
  }

  async function pollJob(id, { onStatus, intervalMs = 2000, timeoutMs = 40 * 60000, shouldStop }) {
    // 40 мин = серверный потолок vocal (2400 c). Длинные песни на CPU идут дольше 15 минут — ждём честно.
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (shouldStop?.()) throw new BusError('cancelled', 'Ожидание остановлено. Задача продолжает выполняться на сервере — результат не сохранится.');
      await new Promise(r => setTimeout(r, intervalMs));
      if (shouldStop?.()) throw new BusError('cancelled', 'Ожидание остановлено. Задача продолжает выполняться на сервере — результат не сохранится.');
      const response = await request('/jobs/' + encodeURIComponent(id), { headers: headers() });
      const data = await response.json();
      onStatus?.(data);
      if (data.status === 'ready') {
        if (!data.result_url) throw new BusError('bad_response', 'Сервер сообщил о готовности, но не отдал ссылку на файл.');
        return data;
      }
      if (['failed', 'cancelled', 'expired'].includes(data.status)) {
        throw new BusError(data.status, 'Задача не завершена: ' + (data.error?.message || data.status) + '.');
      }
    }
    throw new BusError('timeout', 'Задача выполняется слишком долго — ожидание прервано.');
  }

  // ---- creative base --------------------------------------------------------
  let baseCache = null;
  async function creativeBase() {
    if (baseCache) return baseCache;
    const response = await fetch('/assets/data/creative-base.json');
    if (!response.ok) throw new BusError('base_unavailable', 'База стилей владельца недоступна (' + response.status + ').');
    baseCache = await response.json();
    return baseCache;
  }

  function pickRandom(items, n) {
    const copy = items.slice();
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }

  async function improveText(fieldText, kind /* 'lyrics' | 'prompt' */) {
    const base = await creativeBase();
    const pool = kind === 'lyrics' ? (base.lyrics || []) : (base.prompts || []);
    const examples = pickRandom(pool, 5);
    const sources = [...new Set(pool.map(e => e.source).filter(Boolean))];
    const fewShot = examples.map(e => '<example source="' + (e.source || '') + '">\n' + e.text + '\n</example>').join('\n\n');
    const what = kind === 'lyrics' ? 'лирику песни' : 'музыкальный промпт для модели ACE-Step';
    const system = 'Ты редактор музыкальной студии BRIIX. Улучшай ' + what + ' пользователя, сохраняя его замысел, язык и тему. '
      + 'Опирайся на стиль владельца: ' + sources.join('; ') + '. '
      + (kind === 'lyrics'
        ? 'Держи строки пропеваемыми, усили образность и структуру (куплет/припев), ремарки вокала — в скобках по-английски. '
        : 'Промпт — компактная строка на английском: жанр, BPM, вокал, инструменты, продакшн, негативные указания через "no ...". ')
      + 'Верни ТОЛЬКО улучшенный текст без пояснений и кавычек.\n\nПримеры стиля владельца:\n' + fewShot;
    return chatNonStream({ messages: [{ role: 'system', content: system }, { role: 'user', content: 'Улучши:\n\n' + fieldText }], maxTokens: 600 });
  }

  // ---- UI -------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const els = {
    modes: $('modes'), prompt: $('prompt'), advanced: $('advanced'),
    lyrics: $('lyrics'), musicPrompt: $('musicPrompt'),
    improveLyrics: $('improveLyrics'), improvePrompt: $('improvePrompt'),
    undoLyrics: $('undoLyrics'), undoPrompt: $('undoPrompt'),
    tags: $('tags'), addBtn: $('addBtn'),
    assistantChip: $('assistantChip'), assistantName: $('assistantName'), assistantMenu: $('assistantMenu'),
    modelChip: $('modelChip'), modelName: $('modelName'), modelMenu: $('modelMenu'),
    durationChip: $('durationChip'), durationName: $('durationName'), durationMenu: $('durationMenu'),
    vocalSeg: $('vocalSeg'), tuneToggle: $('tuneToggle'),
    send: $('send'), feed: $('feed'), status: $('status'), metaLeft: $('metaLeft'),
    composer: $('composer'), keyCard: $('keyCard'), keyInput: $('keyInput'), keySave: $('keySave'),
    newChat: $('newChat'), improvePhoto: $('improvePhoto'), undoPhoto: $('undoPhoto'),
    gate: $('gate'), nickInput: $('nickInput'), pinDots: $('pinDots'), pinpad: $('pinpad'),
    enterBtn: $('enterBtn'), gateHint: $('gateHint'), studio: $('studio'),
    profileBtn: $('profileBtn'), profileMenu: $('profileMenu'), profileNick: $('profileNick'),
    profileKeyBtn: $('profileKeyBtn'), profileLogoutBtn: $('profileLogoutBtn'), keyStatus: $('keyStatus'),
    tabs: $('tabs'), lib: $('lib')
  };

  let mode = 'chat';
  let quality = 'flash';
  let durKey = 'std'; // «Стандарт» по умолчанию: типичная песня заметно короче 5 минут
  try { const savedKey = localStorage.getItem('briix-studio-duration-key'); if (DUR_PRESETS.some(p => p.key === savedKey)) durKey = savedKey; } catch {}
  let duration = durationSec();
  let instrumental = false; // вокальный контур починен (infra#79) — дефолт снова «Песня»; выбор хранится в браузере
  try { const savedInstr = localStorage.getItem('briix-studio-instrumental'); if (savedInstr !== null) instrumental = savedInstr === '1'; } catch {}
  let advanced = false;
  let history = []; // chat mode: {role, content}
  // Лента переживает перезагрузку: сериализованный журнал карточек в localStorage (per-ник).
  let feedLog = [];
  const FEED_KEY = nick => 'briix-studio-feed-' + nick;
  const FEED_MAX = 80;
  function feedSave() {
    const nick = currentUser();
    if (!nick) return;
    try { localStorage.setItem(FEED_KEY(nick), JSON.stringify(feedLog.slice(-FEED_MAX))); } catch { /* переполнение */ }
  }
  function feedPush(d) { feedLog.push(d); feedLog = feedLog.slice(-FEED_MAX); feedSave(); }
  // Восстановление: тексты сразу, медиа дозабираем с шины по /files/{id}.
  function feedRestore() {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(FEED_KEY(currentUser()))) || []; } catch { /* пусто */ }
    feedLog = log;
    for (const d of feedLog) {
      if (d.t === 'media') {
        const body = card('assistant', d.who, '');
        body.textContent = '';
        const slot = document.createElement('div');
        body.append(slot);
        if (d.track) addMakeTrackAction(body.closest('.card'), d.track);
        fileBlob(d.file).then(blob => {
          if (d.kind === 'photo') {
            const img = new Image();
            img.alt = 'Результат';
            img.src = URL.createObjectURL(blob);
            slot.append(img);
          } else {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.controlsList = 'nodownload';
            audio.preload = 'none';
            audio.src = URL.createObjectURL(blob);
            slot.append(audio);
          }
          addDownloadAction(body.closest('.card'), blob, d.kind === 'photo' ? 'briix-photo' : 'briix-track', d.kind === 'music' ? '⬇ Скачать M4A' : '⬇ Скачать');
        }).catch(() => { slot.textContent = 'Файл недоступен (см. Библиотеку).'; });
        continue;
      }
      const body = card(d.t, d.who, d.text);
      if (d.t === 'assistant' && d.track) addMakeTrackAction(body.closest('.card'), d.track);
    }
    if (feedLog.length) els.feed.scrollIntoView({ block: 'end' });
  }
  const assistantId = { chat: 'mentor', photo: 'art-dir', music: 'producer' };
  const undoBackup = { lyrics: null, musicPrompt: null };

  // Каждая генерация — независимая: свой контроллер отмены и свой ✕ в карточке.
  // Параллельно можно: писать в чат, запускать новые генерации, менять режимы/модели.
  function makeCancelHandle() {
    const h = { cancelled: false, controller: new AbortController(), stopBtn: null };
    h.stop = () => { h.cancelled = true; h.controller.abort(); };
    return h;
  }
  // ✕ в строке ожидания: гасит только свою генерацию.
  function appendStop(row, handle) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage-stop';
    b.setAttribute('aria-label', 'Остановить генерацию');
    b.title = 'Остановить';
    b.textContent = '✕';
    b.addEventListener('click', () => handle.stop());
    row.append(b);
    handle.stopBtn = b;
    return b;
  }

  function setStatus(text, isBusy) {
    els.status.textContent = text || 'готов';
    els.status.classList.toggle('busy', Boolean(isBusy));
  }

  function currentAssistant() {
    return ASSISTANTS[mode].find(a => a.id === assistantId[mode]) || ASSISTANTS[mode][0];
  }

  function meta() {
    const bits = [location.hostname, MODE_LABELS[mode]];
    if (mode === 'music') { const pr = DUR_PRESETS.find(p => p.key === durKey) || DUR_PRESETS[1]; bits.push(MODEL_LABELS[quality] + ' · ' + pr.label + ' · ' + pr.sub); }
    else bits.push(currentAssistant().name.replace(/\s*\(.*\)\s*$/, ''));
    els.metaLeft.textContent = bits.join(' · ');
  }

  // ---- дропдауны ------------------------------------------------------------
  function closeMenus() {
    document.querySelectorAll('.menu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('[aria-haspopup="menu"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  function attachMenu(chip, menu, buildItems) {
    chip.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      closeMenus();
      if (!willOpen) return;
      menu.innerHTML = '';
      for (const item of buildItems()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.setAttribute('aria-selected', String(item.selected));
        const label = document.createElement('span');
        label.textContent = item.label;
        button.append(label);
        if (item.sub) { const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = item.sub; button.append(sub); }
        button.addEventListener('click', () => { closeMenus(); item.onPick(); });
        menu.append(button);
      }
      menu.hidden = false;
      chip.setAttribute('aria-expanded', 'true');
    });
  }
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

  attachMenu(els.assistantChip, els.assistantMenu, () => ASSISTANTS[mode].map(a => ({
    label: a.name, selected: a.id === assistantId[mode],
    onPick: () => { assistantId[mode] = a.id; renderChrome(); }
  })));
  attachMenu(els.modelChip, els.modelMenu, () => Object.keys(MUSIC_MODELS).map(q => ({
    label: MODEL_LABELS[q], sub: MUSIC_MODELS[q], selected: q === quality,
    onPick: () => { quality = q; renderChrome(); }
  })));
  attachMenu(els.durationChip, els.durationMenu, () => DUR_PRESETS.map(p => ({
    label: p.label, sub: p.sub, selected: p.key === durKey,
    onPick: () => { durKey = p.key; duration = p.sec; try { localStorage.setItem('briix-studio-duration-key', p.key); } catch {} renderChrome(); }
  })));

  // ---- карточки ленты ---------------------------------------------------------
  // Автоскролл только когда лента у низа: читающие выше не выдёргиваются.
  // force — для нового сообщения пользователя (всегда показываем его).
  function scrollFeed(force = false) {
    const nearBottom = els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < 140;
    if (force || nearBottom) els.feed.scrollTop = els.feed.scrollHeight;
  }

  function card(kind, who, text) {
    const div = document.createElement('div');
    div.className = 'card ' + kind;
    const whoEl = document.createElement('div');
    whoEl.className = 'who';
    whoEl.textContent = who;
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = text || '';
    div.append(whoEl, body);
    els.feed.append(div);
    scrollFeed(kind === 'user');
    return body;
  }

  // Мини-спиннер + ротация фраз живого ожидания (wait-ui.js). Клик по ленте не нужен:
  // блок сам исчезает, когда приходит результат.
  function waitLine(type, stage) {
    const line = document.createElement('div');
    line.className = 'wait-line';
    const spin = document.createElement('span');
    spin.className = 'wait-spin';
    const phrase = document.createElement('span');
    phrase.setAttribute('data-wait', '');
    phrase.setAttribute('data-wait-type', type);
    if (stage) phrase.setAttribute('data-wait-stage', stage);
    line.append(spin, phrase);
    return line;
  }

  // Секундомер stage-карточки: «М:СС» с табличными цифрами (CSS .stage-elapsed).
  function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  // wait-line + секундомер в один ряд; таймер чистится при удалении карточки.
  function waitRow(type, stage) {
    const t0 = Date.now();
    const elapsed = document.createElement('span');
    elapsed.className = 'stage-elapsed';
    elapsed.textContent = fmtElapsed(0);
    const row = document.createElement('div');
    row.className = 'wait-row';
    row.append(waitLine(type, stage), elapsed);
    const timer = setInterval(() => { elapsed.textContent = fmtElapsed(Date.now() - t0); }, 1000);
    return { row, stop: () => clearInterval(timer) };
  }

  function errorCard(error) {
    if (error.name === 'AbortError' || error.code === 'cancelled') {
      card('notice', 'Остановлено', 'Генерацию остановили — текст остался в поле, можно править и запустить снова.');
      return;
    }
    if (error.code === 'content_blocked') {
      const body = card('error', 'Модерация', 'Не пройдена проверка контента: ' + (error.message || 'запрос нарушает политику.') + ' Текст сохранён в поле ввода — отредактируйте и попробуйте снова.');
      body.dataset.code = 'content_blocked';
      return;
    }
    if (error.code === 'unauthorized') { els.keyCard.hidden = false; els.keyInput.focus(); }
    card('error', 'Ошибка', error.message || 'Неизвестная ошибка.');
  }

  // «Сделать из этого трек»: чат → музыка с подставленным брифом.
  function addMakeTrackAction(container, brief) {    const row = document.createElement('div');
    row.className = 'actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action make-track';
    button.textContent = '🎵 Сделать из этого трек';
    button.addEventListener('click', () => {
      setMode('music');
      advanced = false;
      els.prompt.value = brief.trim().slice(0, 2000);
      updateEnabled();
    });
    row.append(button);
    container.append(row);
  }

  // Кнопка «Скачать» под готовым фото/треком (blob уже в памяти страницы).
  function extOf(blob) {
    const t = blob.type || '';
    if (t.includes('png')) return 'png';
    if (t.includes('jpeg')) return 'jpg';
    if (t.includes('wav')) return 'wav';
    if (t.includes('mpeg')) return 'mp3';
    return 'm4a'; // audio/mp4 и дефолт
  }
  function addDownloadAction(container, blob, name, label) {
    const row = document.createElement('div');
    row.className = 'actions';
    const link = document.createElement('a');
    link.className = 'action';
    link.href = URL.createObjectURL(blob);
    link.download = name + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.' + extOf(blob);
    link.textContent = label || '⬇ Скачать';
    row.append(link);
    container.append(row);
  }

  // ---- режим/состояния ---------------------------------------------------------
  function setMode(next) {
    mode = next;
    renderChrome();
  }

  function renderChrome() {
    els.modes.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const isMusic = mode === 'music';
    document.querySelectorAll('.music-only').forEach(el => { el.hidden = !isMusic; });
    document.querySelectorAll('.chat-only').forEach(el => { el.hidden = mode !== 'chat'; });
    document.querySelectorAll('.photo-only').forEach(el => { el.hidden = mode !== 'photo'; });
    renderKeyChip();
    els.advanced.hidden = !(isMusic && advanced);
    els.prompt.hidden = isMusic && advanced;
    els.prompt.placeholder = PLACEHOLDERS[mode];
    els.assistantName.textContent = currentAssistant().name.replace(/\s*\(.*\)\s*$/, '');
    els.modelName.textContent = MODEL_LABELS[quality];
    const preset = DUR_PRESETS.find(p => p.key === durKey) || DUR_PRESETS[1];
    els.durationName.textContent = preset.label + ' · ' + preset.sub;
    els.vocalSeg.querySelectorAll('.seg-btn').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.vocal) === (instrumental ? 1 : 0))));
    els.tuneToggle.setAttribute('aria-pressed', String(advanced));
    meta();
    updateEnabled();
  }

  function activePromptEl() {
    return (mode === 'music' && advanced) ? els.musicPrompt : els.prompt;
  }

  function promptValue() {
    return activePromptEl().value.trim();
  }

  function updateEnabled() {
    els.send.disabled = !promptValue(); // генерации параллельные: send не глушим
    els.improveLyrics.disabled = runningOps > 0 || !els.lyrics.value.trim();
    els.improvePrompt.disabled = runningOps > 0 || !els.musicPrompt.value.trim();
    els.improvePhoto.disabled = runningOps > 0 || mode !== 'photo' || !els.prompt.value.trim();
  }

  let runningOps = 0;
  function setBusy(delta, statusText) { // delta=true — операция началась, false — закончилась; счётчик, не глобальный флаг
    runningOps = Math.max(0, runningOps + (delta ? 1 : -1));
    els.improveLyrics.classList.toggle('busy', runningOps > 0);
    els.improvePrompt.classList.toggle('busy', runningOps > 0);
    setStatus(runningOps > 0 ? (statusText || 'Работаем…') : '', runningOps > 0);
    updateEnabled();
  }

  function needKey() {
    if (token()) return true;
    els.keyCard.hidden = false;
    els.keyInput.focus();
    card('notice', 'Ключ', 'Вставьте ключ приватного стенда — тот же, что в Настройках демо.');
    return false;
  }

  // Профиль-меню: актуальность подписей (ник и состояние ключа).
  function renderKeyChip() {
    const has = Boolean(token());
    els.profileNick.textContent = currentUser() || '';
    els.profileBtn.title = has ? 'Профиль — ключ стенда сохранён' : 'Профиль — ключ стенда не задан';
    // статус ключа виден всегда: в пункте меню и внутри карточки ключа
    els.profileKeyBtn.textContent = has ? 'Ключ стенда ✓' : 'Ключ стенда…';
    if (els.keyStatus) els.keyStatus.textContent = has
      ? 'Ключ сохранён ✓ — хранится только в этом браузере.'
      : 'Ключ ещё не задан.';
  }

  // ---- потоки -------------------------------------------------------------------
  async function create() {
    if (!needKey()) return;
    const text = promptValue();
    if (!text) return;
    if (mode === 'chat') return createChat(text);
    if (mode === 'photo') return createPhoto(text);
    return createMusic(text);
  }

  async function createChat(text) {
    history.push({ role: 'user', content: text });
    card('user', 'Вы', text);
    feedPush({ t: 'user', who: 'Вы', text });
    els.prompt.value = '';
    updateEnabled();
    const who = currentAssistant().name;
    const body = card('assistant', who, '');
    const handle = makeCancelHandle(); // ✕ в карточке гасит только этот стрим
    const textSpan = document.createElement('span'); // текст отдельно от ✕, чтобы не перемешивались
    const wait = waitLine('chat'); // мгновенный отклик: видно, что запрос ушёл
    const stopRow = document.createElement('div');
    stopRow.className = 'wait-row';
    stopRow.append(wait);
    appendStop(stopRow, handle);
    body.append(textSpan, stopRow);
    body.classList.add('streaming');
    setBusy(true, who + ' печатает…');
    try {
      const messages = [{ role: 'system', content: currentAssistant().system }, ...history];
      let first = true;
      const full = await chatStream({ messages, signal: handle.controller.signal, onChunk: piece => {
        if (first) { wait.remove(); first = false; } // ждущий блок уступает место стриму, ✕ остаётся
        textSpan.textContent += piece;
        scrollFeed();
      } });
      stopRow.remove();
      body.textContent = full; // чистый текст вместо служебных узлов
      history.push({ role: 'assistant', content: full });
      feedPush({ t: 'assistant', who, text: full, track: full }); // track = бриф «Сделать из этого трек»
      addMakeTrackAction(body.closest('.card'), full);
    } catch (error) {
      stopRow.remove();
      if (error.name === 'AbortError') {
        if (body.textContent.trim()) { // частичный ответ остаётся в ленте
          const note = document.createElement('div');
          note.className = 'stopped-note';
          note.textContent = '⏹ остановлено';
          body.append(note);
        } else body.closest('.card').remove();
        history.pop(); // неудачный ход не остаётся в истории
      } else {
        if (!body.textContent.trim()) body.closest('.card').remove(); // пустая карточка без ответа не висит
        history.pop(); // неудачный ход не остаётся в истории
        if (!els.prompt.value.trim()) els.prompt.value = text; // текст сохраняем для правки
        errorCard(error);
      }
    } finally { body.classList.remove('streaming'); setBusy(false); updateEnabled(); }
  }

  async function createPhoto(text) {
    card('user', 'Вы', text);
    feedPush({ t: 'user', who: 'Вы', text });
    els.prompt.value = '';
    updateEnabled();
    setBusy(true, 'Отправляем задачу…');
    const stageBody = card('stage', 'Фото', ''); // мгновенно, до ответа шины
    const skel = document.createElement('div');
    skel.className = 'skeleton-img';
    stageBody.append(skel);
    const wait = waitRow('image', 'generating');
    const handle = makeCancelHandle(); // ✕ гасит только эту джобу
    appendStop(wait.row, handle);
    stageBody.append(wait.row);
    try {
      const id = await submitJob({ type: 'image', prompt: text });
      const result = await pollJob(id, { shouldStop: () => handle.cancelled, onStatus: d => {
        if (d.stage) stageBody.querySelector('[data-wait]')?.setAttribute('data-wait-stage', d.stage);
      } });
      wait.stop();
      stageBody.closest('.card').remove();
      const item = document.createElement('img');
      item.alt = 'Результат';
      const blob = await fileBlob(result.result_url);
      item.src = URL.createObjectURL(blob);
      item.className = 'media-in';
      requestAnimationFrame(() => item.classList.add('loaded'));
      const wrap = card('assistant', 'Фото готово', '');
      wrap.textContent = '';
      wrap.append(item);
      addDownloadAction(wrap.closest('.card'), blob, 'briix-photo');
      feedPush({ t: 'media', who: 'Фото готово', kind: 'photo', file: result.result_url });
      libAdd({ job: id, kind: 'photo', prompt: text, file: result.result_url, created: Date.now(), fav: false });
    } catch (error) {
      wait.stop();
      stageBody.closest('.card').remove();
      if (error.name === 'AbortError' || error.code === 'cancelled') {
        card('notice', 'Остановлено', 'Генерацию остановили — запрос можно повторить.');
      } else {
        if (!els.prompt.value.trim()) els.prompt.value = text; // текст сохраняем для правки
        errorCard(error);
      }
    } finally { setBusy(false); updateEnabled(); }
  }

  async function autoLyrics(topic, outerSignal) {
    // vocal-модели требуют текст: если лирика пустая — qwen3 пишет её сам
    const messages = [
      { role: 'system', content: 'Ты — автор песен. Напиши текст песни на русском языке по теме пользователя. 8–16 строк. Обязательно используй структурные теги [verse] и [chorus] (можно [bridge], [outro]). Без пояснений и вступлений — только текст песни с тегами.' },
      { role: 'user', content: 'Тема песни: ' + topic }
    ];
    let full = '';
    // ✕ своей карточки + потолок 150 с (лимит каталога chat 180)
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(150000)]);
    try {
      full = await chatStream({ messages, onChunk: () => {}, signal });
    } catch (error) {
      if (error.name === 'TimeoutError') throw new BusError('timeout', 'Автор песни не ответил за 150 секунд.');
      throw error;
    }
    return full.trim().slice(0, 8000);
  }

  async function createMusic(description) {
    const style = (mode === 'music' && advanced) ? els.musicPrompt.value.trim() : description;
    let lyrics = advanced ? els.lyrics.value.trim() : '';
    const vocal = !instrumental;
    if (!style && !lyrics) { card('notice', 'Музыка', 'Опишите трек — стиль или лирику.'); return; }
    if (vocal && !lyrics && !style) { card('notice', 'Музыка', 'Опишите трек — о чём песня?'); return; }
    if (!advanced) els.prompt.value = '';
    else els.musicPrompt.value = '';
    updateEnabled();
    const requestText = style || lyrics; // что просили — карточка в ленте и в журнале
    card('user', 'Вы', requestText);
    feedPush({ t: 'user', who: 'Вы', text: requestText });
    const stageBody = card('stage', 'Музыка', ''); // мгновенно, включая фазу автолирики
    const wait = waitRow('music', vocal && !lyrics ? 'writing-lyrics' : 'synthesizing');
    const handle = makeCancelHandle(); // ✕ гасит автолирику и поллинг этой джобы
    appendStop(wait.row, handle);
    stageBody.append(wait.row);
    // Прогресс по трём стадиям: оценки из живых замеров (flash GPU + cover на CPU ~3 мин).
    const stages = ['writing-lyrics', 'synthesizing', 'album-cover'];
    const stageNames = { 'writing-lyrics': 'лирика', 'synthesizing': 'синтез', 'album-cover': 'обложка' };
    const estSec = () => {
      const per = MUSIC_MODELS[quality] === 'ace-step-pro' ? { wl: 1.3, syn: 0.15 } : { wl: 0.45, syn: 0.08 };
      return [Math.round(duration * per.wl), Math.round(duration * per.syn + 10), 180];
    };
    let curStage = stageBody.querySelector('[data-wait]')?.getAttribute('data-wait-stage') || stages[0];
    let stageAt = Date.now();
    const est = estSec();
    const bar = document.createElement('div');
    bar.className = 'stage-progress';
    const segs = stages.map(s => {
      const seg = document.createElement('div');
      seg.className = 'sp-seg';
      seg.title = stageNames[s];
      const fill = document.createElement('div');
      fill.className = 'sp-fill';
      seg.append(fill);
      bar.append(seg);
      return { el: seg, fill, name: s, est: est[stages.indexOf(s)] };
    });
    const barLabel = document.createElement('div');
    barLabel.className = 'stage-progress-label';
    const paint = () => {
      const idx = stages.indexOf(curStage);
      segs.forEach((s, i) => {
        s.el.classList.toggle('done', i < idx);
        s.el.classList.toggle('active', i === idx);
        s.fill.style.width = i < idx ? '100%' : i === idx ? Math.min(92, Math.round((Date.now() - stageAt) / 1000 / s.est * 100)) + '%' : '0%';
      });
      const left = Math.max(0, Math.round(segs.filter((s, i) => i >= idx).reduce((a, s, i) => a + Math.max(0, s.est - (i === idx ? (Date.now() - stageAt) / 1000 : 0)), 0)));
      barLabel.textContent = 'этап ' + (idx + 1) + ' из 3 · ' + stageNames[curStage] + ' · осталось ≈ ' + fmtElapsed(left * 1000);
    };
    paint();
    const barTimer = setInterval(paint, 1000);
    stageBody.append(bar, barLabel);
    const watchStage = new MutationObserver(() => {
      const now = stageBody.querySelector('[data-wait]')?.getAttribute('data-wait-stage');
      if (now && now !== curStage) { curStage = now; stageAt = Date.now(); paint(); }
    });
    watchStage.observe(stageBody, { subtree: true, attributes: true, attributeFilter: ['data-wait-stage'] });
    setBusy(true, vocal && !lyrics && !instrumental ? 'Пишем текст песни…' : 'Отправляем задачу…');
    try {
      if (vocal && !lyrics) {
        try {
          lyrics = await autoLyrics(style || lyrics || 'песня', handle.controller.signal);
          if (advanced) els.lyrics.value = lyrics;
        } catch (error) {
          wait.stop(); clearInterval(barTimer); watchStage.disconnect();
          stageBody.closest('.card').remove(); // setBusy(false) не нужен: finally в createMusic сделает декремент
          const why = error.name === 'AbortError' ? 'Остановлено вручную.'
            : error.code === 'timeout' ? error.message
            : error.code === 'content_blocked' ? 'Модерация не пропустила тему.'
            : 'Причина: ' + (error.message || 'неизвестная ошибка') + '.';
          card('notice', 'Музыка', 'Не удалось автоматически написать лирику. ' + why
            + ' Можно заполнить поле «Лирика» вручную (кнопка ✨ тоже поможет) и попробовать снова.');
          return;
        }
      }
      const params = { model: MUSIC_MODELS[quality], duration }; // контракт шины: params.duration (не duration_seconds!)
      if (instrumental) params.instrumental = true;
      if (lyrics) params.lyrics = lyrics;
      const id = await submitJob({ type: 'music', prompt: style || lyrics, params });
      const result = await pollJob(id, { shouldStop: () => handle.cancelled, onStatus: d => {
        if (d.stage) stageBody.querySelector('[data-wait]')?.setAttribute('data-wait-stage', d.stage);
      } });
      wait.stop();
      clearInterval(barTimer); watchStage.disconnect();
      stageBody.closest('.card').remove();
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.controlsList = 'nodownload'; // скачивание только через нашу кнопку: имя .m4a, обложка и текст внутри
      const blob = await fileBlob(result.result_url);
      audio.src = URL.createObjectURL(blob);
      const wrap = card('assistant', 'Трек готов (' + MODEL_LABELS[quality] + ' · ' + duration + ' с)', '');
      wrap.textContent = '';
      const coverPath = (result.result_url || '').replace(/\.m4a$/, '-cover.png');
      if (coverPath !== result.result_url) {
        const cimg = new Image();
        cimg.className = 'feed-cover';
        cimg.alt = 'Обложка трека';
        wrap.append(cimg);
        fileBlob(coverPath).then(b => { cimg.src = URL.createObjectURL(b); }).catch(() => cimg.remove());
      }
      wrap.append(audio);
      addDownloadAction(wrap.closest('.card'), blob, 'briix-track', '⬇ Скачать M4A');
      feedPush({ t: 'media', who: 'Трек готов (' + MODEL_LABELS[quality] + ' · ' + duration + ' с)', kind: 'music', file: result.result_url });
      const titleSource = (lyrics || style || '').split('\n').map(s => s.trim()).find(s => s.length > 2) || '';
      libAdd({
        job: id, kind: 'music', prompt: (style || lyrics || '').slice(0, 200),
        lyrics: (lyrics || '').slice(0, 8000),
        title: titleSource.slice(0, 60),
        model: MUSIC_MODELS[quality], duration, file: result.result_url, created: Date.now(), fav: false
      });
    } catch (error) {
      wait.stop(); clearInterval(barTimer); watchStage.disconnect();
      stageBody.closest('.card').remove();
      if (error.name === 'AbortError' || error.code === 'cancelled') {
        card('notice', 'Остановлено', 'Генерацию остановили — запрос можно повторить.');
      } else {
        // текст остаётся в полях для правки (в т.ч. после 422)
        if (!advanced && !els.prompt.value.trim()) els.prompt.value = description;
        if (advanced && !els.musicPrompt.value.trim()) els.musicPrompt.value = style;
        errorCard(error);
      }
    } finally { setBusy(false); updateEnabled(); }
  }

  async function fileBlob(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : server() + pathOrUrl;
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token() } });
    if (!response.ok) throw new BusError('http', 'Файл не получен (' + response.status + ').', response.status);
    return response.blob();
  }

  async function improve(field) {
    if (runningOps > 0) return;
    if (!needKey()) return;
    const el = field === 'lyrics' ? els.lyrics : els.musicPrompt;
    const original = el.value;
    const button = field === 'lyrics' ? els.improveLyrics : els.improvePrompt;
    setBusy(true, 'Улучшаем через базу владельца…');
    button.classList.add('busy');
    try {
      const improved = await improveText(original, field);
      undoBackup[field] = original;
      el.value = improved.trim();
      (field === 'lyrics' ? els.undoLyrics : els.undoPrompt).hidden = false;
    } catch (error) { errorCard(error); } finally { button.classList.remove('busy'); setBusy(false); }
  }

  function undo(field) {
    if (undoBackup[field] == null) return;
    (field === 'lyrics' ? els.lyrics : els.musicPrompt).value = undoBackup[field];
    undoBackup[field] = null;
    (field === 'lyrics' ? els.undoLyrics : els.undoPrompt).hidden = true;
    updateEnabled();
  }

  // ✨ в режиме «Фото»: арт-директор улучшает промпт перед отправкой.
  async function improvePhoto() {
    if (runningOps > 0) return;
    const original = els.prompt.value.trim();
    if (!original || !needKey()) return;
    setBusy(true, 'Улучшаем промпт…');
    els.improvePhoto.classList.add('busy');
    try {
      const improved = await chatNonStream({
        messages: [
          { role: 'system', content: currentAssistant().system },
          { role: 'user', content: 'Улучши промпт:\n\n' + original }
        ],
        maxTokens: 600
      });
      undoBackup.prompt = original;
      els.prompt.value = improved.trim();
      els.undoPhoto.hidden = false;
    } catch (error) { errorCard(error); }
    finally { els.improvePhoto.classList.remove('busy'); setBusy(false); updateEnabled(); }
  }

  function undoPhoto() {
    if (undoBackup.prompt == null) return;
    els.prompt.value = undoBackup.prompt;
    undoBackup.prompt = null;
    els.undoPhoto.hidden = true;
    updateEnabled();
  }

  // Новый чат: чистим ленту, журнал и историю (мод/качество/ключ не трогаем).
  function newChat() {
    if (runningOps > 0) return;
    if (feedLog.length && !confirm('Очистить ленту диалога? Генерации останутся в «Библиотеке», но переписка на экране сотрётся.')) return;
    history = [];
    feedLog = [];
    feedSave();
    els.feed.innerHTML = '';
  }

  function insertTag(tag) {
    const el = els.lyrics;
    const at = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, at);
    const after = el.value.slice(el.selectionEnd ?? at);
    const pad = before && !before.endsWith('\n') ? '\n' : '';
    el.value = before + pad + tag + (after && !after.startsWith('\n') ? '\n' : '') + after;
    el.focus();
    const pos = (before + pad + tag).length;
    el.setSelectionRange(pos, pos);
    updateEnabled();
  }

  // ---- auth: ник + PIN-пад (клиентский; переезд на серверную auth — INFRA #78) ----
  const PROFILES_KEY = 'briix-studio-profiles';
  const USER_KEY = 'briix-studio-user';
  const libKey = nick => 'briix-studio-library-' + nick;
  const PIN_MIN = 4, PIN_MAX = 6, PIN_MAX_FAILS = 5, PIN_LOCK_MS = 30000;

  function pinHash(nick, pin) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(nick + '::' + pin))
      .then(digest => [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join(''));
  }
  function profiles() { try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || {}; } catch { return {}; } }
  function saveProfiles(p) { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); } catch { /* приватный режим */ } }
  function currentUser() { return localStorage.getItem(USER_KEY) || ''; }

  let pinBuf = '';
  let pinFails = 0;
  let pinLockedUntil = 0;

  function renderDots() {
    els.pinDots.textContent = '';
    for (let i = 0; i < Math.max(pinBuf.length, PIN_MIN); i++) {
      const dot = document.createElement('span');
      dot.className = 'pd' + (i < pinBuf.length ? ' on' : '');
      els.pinDots.append(dot);
    }
  }
  function gateHint(text) { els.gateHint.textContent = text; }

  async function enterGate() {
    const nick = els.nickInput.value.trim();
    if (!nick) { gateHint('Сначала ник.'); els.nickInput.focus(); return; }
    if (pinBuf.length < PIN_MIN) { gateHint('PIN — от ' + PIN_MIN + ' цифр.'); return; }
    if (Date.now() < pinLockedUntil) { gateHint('Слишком много попыток — подождите полминуты.'); return; }
    const hash = await pinHash(nick, pinBuf);
    const profs = profiles();
    if (profs[nick]) {
      if (profs[nick].pinHash !== hash) {
        pinFails++;
        pinBuf = '';
        renderDots();
        if (pinFails >= PIN_MAX_FAILS) {
          pinLockedUntil = Date.now() + PIN_LOCK_MS;
          pinFails = 0;
          gateHint('Неверный PIN. Пауза 30 секунд.');
        } else {
          gateHint('Неверный PIN. Осталось попыток: ' + (PIN_MAX_FAILS - pinFails) + '.');
        }
        return;
      }
    } else {
      profs[nick] = { pinHash: hash, created: Date.now() };
      saveProfiles(profs);
      gateHint('Новый профиль создан.');
    }
    pinFails = 0;
    pinBuf = '';
    localStorage.setItem(USER_KEY, nick);
    startSession(nick);
  }

  function startSession(nick) {
    els.gate.hidden = true;
    els.studio.hidden = false;
    els.profileNick.textContent = nick;
    setView('chat');
    feedRestore(); // лента прошлого сеанса
    renderKeyChip();
  }

  function logout() {
    localStorage.removeItem(USER_KEY);
    els.studio.hidden = true;
    els.gate.hidden = false;
    els.nickInput.value = '';
    pinBuf = '';
    renderDots();
    gateHint('PIN — 4–6 цифр. Новый ник регистрируется при первом входе.');
    els.nickInput.focus();
  }

  // ---- библиотека (клиентская; переезд на GET /jobs — INFRA #77) ----------------
  const blobCache = new Map(); // job_id → objectURL
  let libFilter = 'all';

  function libLoad() {
    const nick = currentUser();
    if (!nick) return [];
    try { return JSON.parse(localStorage.getItem(libKey(nick))) || []; } catch { return []; }
  }
  function libSave(list) {
    const nick = currentUser();
    if (nick) { try { localStorage.setItem(libKey(nick), JSON.stringify(list)); } catch { /* переполнение */ } }
  }
  function libAdd(entry) {
    const list = libLoad();
    list.unshift(entry);
    libSave(list);
    if (!els.lib.hidden) renderLibrary();
  }

  const KIND_LABELS = { photo: 'Фото', music: 'Музыка' };
  const FILTERS = [['all', 'Все'], ['photo', 'Фото'], ['music', 'Музыка'], ['fav', '★ Избранное']];

  // Серверная библиотека (infra#77): GET /jobs как первоисточник, клиентские записи — дополнение.
  let libSeq = 0;
  async function serverJobs() {
    const response = await fetch(server() + '/jobs?limit=100', { headers: headers() });
    if (!response.ok) {
      if (response.status === 401) throw new BusError('unauthorized', 'Ключ не принят (401).', 401);
      return [];
    }
    const payload = await response.json();
    return Array.isArray(payload?.items) ? payload.items : [];
  }

  function renderLibrary() {
    els.lib.innerHTML = '';
    const filterRow = document.createElement('div');
    filterRow.className = 'lib-filters';
    for (const [value, label] of FILTERS) {
      const chip = document.createElement('button');
      chip.className = 'tag';
      chip.textContent = label;
      chip.setAttribute('aria-pressed', String(libFilter === value));
      chip.addEventListener('click', () => { libFilter = value; renderLibrary(); });
      filterRow.append(chip);
    }
    els.lib.append(filterRow);
    const render = (list, note, replace) => {
      if (replace && list.length) { // серверный список заменяет предварительный локальный рендер, а не дополняет его
        els.lib.innerHTML = '';
        els.lib.append(filterRow);
      }
      if (list.length) note?.remove();
      if (!list.length) {
        if (note) note.textContent = libFilter === 'all'
          ? 'Пока пусто — создайте фото или трек в чате, они появятся здесь.'
          : 'В этом фильтре пусто.';
        return;
      }
      for (const entry of list) els.lib.append(libCard(entry));
    };
    // мгновенно — клиентские записи, чтобы вкладка не мигала пустотой
    const local = libLoad().filter(e => libFilter === 'all' ? true : libFilter === 'fav' ? e.fav : e.kind === libFilter);
    const note = document.createElement('div');
    note.className = 'card notice';
    note.textContent = 'Загружаем библиотеку…';
    els.lib.append(note);
    render(local, note);
    // затем серверный список поверх (объединение по job id)
    const seq = ++libSeq;
    serverJobs().then(items => {
      if (seq !== libSeq) return; // устаревший прогон рендера
      const byId = new Map();
      for (const e of libLoad()) byId.set(e.job, e);
      const merged = [];
      for (const j of items) {
        const kind = j.type === 'image' ? 'photo' : j.type === 'music' ? 'music' : j.type;
        const localEntry = byId.get(j.id);
        if (localEntry) {
          localEntry.fav = !!j.favorite;
          localEntry.server = true;
          localEntry.file = j.result_url || localEntry.file;
          localEntry.cover = j.cover_url || localEntry.cover || '';
          localEntry.created = localEntry.created || (j.created_at || 0) * 1000;
          merged.push(localEntry);
          byId.delete(j.id);
        } else if (j.result_url) {
          merged.push({
            job: j.id, kind, prompt: j.prompt || '',
            file: j.result_url, cover: j.cover_url || '',
            created: (j.created_at || 0) * 1000, fav: !!j.favorite, server: true,
            lyrics: j.params?.lyrics || '', model: j.params?.model || '', duration: j.params?.duration_seconds || ''
          });
        }
      }
      for (const e of byId.values()) merged.push(e);
      merged.sort((a, b) => (b.created || 0) - (a.created || 0));
      render(merged.filter(e => libFilter === 'all' ? true : libFilter === 'fav' ? e.fav : e.kind === libFilter), note, true);
    }).catch((error) => {
      if (seq !== libSeq) return;
      if (!note.isConnected) els.lib.append(note); // note мог отцепиться после успешного локального рендера
      note.textContent = error instanceof BusError && error.status === 401
        ? 'Серверная библиотека недоступна: проверьте ключ (профиль → «Ключ стенда…»).'
        : 'Серверная библиотека недоступна — показаны локальные записи.';
    });
  }

  function libCard(entry) {
    const div = document.createElement('div');
    div.className = 'card lib-item' + (entry.fav ? ' fav' : '');
    // строка-карточка (эталон владельца): обложка-миниатюра слева, контент справа
    const main = document.createElement('div');
    main.className = 'lib-main';
    const who = document.createElement('div');
    who.className = 'who';
    if (entry.kind === 'music' && entry.cover) { // миниатюра обложки (infra#77: /files/{id}-cover.png)
      const cov = document.createElement('img');
      cov.className = 'lib-cover';
      cov.alt = 'Обложка';
      div.append(cov);
      fileBlob(entry.cover).then(b => { cov.src = URL.createObjectURL(b); }).catch(() => cov.remove());
    }
    let whoText = KIND_LABELS[entry.kind] || entry.kind;
    if (entry.kind === 'music' && entry.model) whoText += ' · ' + entry.model;
    if (entry.kind === 'music' && entry.duration) whoText += ' · ' + entry.duration + ' с';
    whoText += ' · ' + new Date(entry.created).toLocaleString('ru-RU');
    who.textContent = whoText;
    const promptEl = document.createElement('div');
    promptEl.className = 'body lib-prompt';
    promptEl.textContent = entry.prompt || '';
    const media = document.createElement('div');
    media.className = 'lib-media';
    libMedia(entry, media);
    const row = document.createElement('div');
    row.className = 'actions';
    const download = document.createElement('a');
    download.className = 'action';
    download.textContent = entry.kind === 'music' ? '⬇ Скачать M4A' : '⬇ Скачать';
    download.href = '#';
    download.addEventListener('click', async e => {
      e.preventDefault();
      const url = blobCache.get(entry.job);
      if (!url) return;
      download.href = url;
      download.download = 'briix-' + entry.kind + '-' + new Date(entry.created).toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.' + (entry.kind === 'photo' ? 'png' : 'm4a');
      download.click();
    });
    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'action';
    fav.textContent = entry.fav ? '★ В избранном' : '☆ В избранное';
    fav.addEventListener('click', async () => {
      const next = !entry.fav;
      if (entry.server) { // серверная запись — флаг на шине (infra#77)
        try {
          await fetch(server() + '/jobs/' + encodeURIComponent(entry.job) + '/favorite', {
            method: 'POST', headers: headers(), body: JSON.stringify({ favorite: next })
          });
        } catch { /* офлайн — просто перерисуем локальное состояние */ }
      }
      const list = libLoad();
      const item = list.find(x => x.job === entry.job);
      if (item) { item.fav = next; libSave(list); }
      renderLibrary();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'action';
    del.textContent = '🗑 Удалить';
    del.addEventListener('click', async () => {
      if (!confirm('Удалить из библиотеки? Файл на стенде останется.')) return;
      if (entry.server) {
        try { await fetch(server() + '/jobs/' + encodeURIComponent(entry.job), { method: 'DELETE', headers: headers() }); } catch { /* offline */ }
      }
      libSave(libLoad().filter(x => x.job !== entry.job));
      blobCache.delete(entry.job);
      renderLibrary();
    });
    row.append(download, fav, del);
    main.append(who, promptEl, media, row);
    div.append(main);
    if (entry.kind === 'music' && entry.lyrics) {
      const lyricsWrap = document.createElement('div');
      lyricsWrap.className = 'lib-lyrics';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'action lib-lyrics-toggle';
      toggle.textContent = '¶ Текст песни';
      toggle.addEventListener('click', () => {
        const open = lyricsWrap.classList.toggle('open');
        body.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
      });
      const body = document.createElement('div');
      body.className = 'lib-lyrics-text';
      body.hidden = true;
      body.textContent = entry.lyrics;
      lyricsWrap.append(toggle, body);
      main.append(lyricsWrap);
    }
    return div;
  }

  // Медиа библиотеки грузим лениво и по очереди: 12 параллельных m4a душат канал,
  // карточки висят в «Загружаем…». Очередь с 2 воркерами + IntersectionObserver.
  const libQueue = [];
  let libActive = 0;
  const LIB_PARALLEL = 2;
  function libPump() {
    while (libActive < LIB_PARALLEL && libQueue.length) {
      const task = libQueue.shift();
      libActive++;
      task().finally(() => { libActive--; libPump(); });
    }
  }
  function libMedia(entry, container) {
    const cached = blobCache.get(entry.job);
    if (cached) return renderMedia(entry, container, cached);
    container.textContent = 'Файл готов — нажмите ▶, чтобы загрузить и слушать.';
    if (entry.kind !== 'music') container.textContent = 'Загружаем…';
    const observer = new IntersectionObserver((records, obs) => {
      if (!container.isConnected) { obs.disconnect(); return; } // карточку перерисовали — наблюдение больше не нужно
      for (const r of records) if (r.isIntersecting) {
        obs.disconnect();
        libQueue.push(async () => {
          try {
            const blob = await fileBlob(entry.file);
            const url = URL.createObjectURL(blob);
            blobCache.set(entry.job, url);
            renderMedia(entry, container, url);
          } catch { container.textContent = 'Файл недоступен.'; }
        });
        libPump();
      }
    }, { rootMargin: '150px' });
    observer.observe(container);
  }
  function renderMedia(entry, container, url) {
    container.textContent = '';
    if (entry.kind === 'photo') {
      const img = new Image();
      img.alt = 'Результат';
      img.src = url;
      container.append(img);
    } else {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.controlsList = 'nodownload'; // то же: имя файла даёт наша кнопка
      audio.preload = 'none';
      audio.src = url;
      container.append(audio);
    }
  }

  // ---- вкладки: Чат / Библиотека -------------------------------------------------
  function setView(next) {
    els.tabs.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === next)));
    els.feed.hidden = next !== 'chat';
    els.lib.hidden = next !== 'library';
    els.composer.hidden = next !== 'chat';
    if (next === 'library') renderLibrary();
  }
  // ---- wiring -------------------------------------------------------------------
  els.modes.addEventListener('click', e => {
    const button = e.target.closest('.mode');
    if (!button) return;
    setMode(button.dataset.mode);
  });

  els.tuneToggle.addEventListener('click', () => { advanced = !advanced; renderChrome(); });
  els.vocalSeg.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    instrumental = btn.dataset.vocal === '1';
    try { localStorage.setItem('briix-studio-instrumental', instrumental ? '1' : '0'); } catch {}
    renderChrome();
  });

  els.send.addEventListener('click', create);
  els.improveLyrics.addEventListener('click', () => improve('lyrics'));
  els.improvePrompt.addEventListener('click', () => improve('prompt'));
  els.undoLyrics.addEventListener('click', () => undo('lyrics'));
  els.undoPrompt.addEventListener('click', () => undo('musicPrompt'));
  els.improvePhoto.addEventListener('click', improvePhoto);
  els.undoPhoto.addEventListener('click', undoPhoto);
  els.newChat.addEventListener('click', newChat);
  els.tags.addEventListener('click', e => {
    const tag = e.target.closest('.tag');
    if (tag) insertTag(tag.dataset.tag);
  });

  els.addBtn.addEventListener('click', e => {
    e.stopPropagation();
    card('notice', 'Вложения', 'Прикрепление файлов скоро — пока опишите всё текстом.');
  });

  els.prompt.addEventListener('input', updateEnabled);
  els.lyrics.addEventListener('input', updateEnabled);
  els.musicPrompt.addEventListener('input', updateEnabled);

  els.keySave.addEventListener('click', () => {
    setToken(els.keyInput.value);
    els.keyInput.value = '';
    els.keyCard.hidden = true;
    renderKeyChip();
    card('notice', 'Ключ', 'Ключ сохранён в этом браузере.');
  });

  // Профиль-меню в панели вкладок: пункты статичные, меню руками (не attachMenu).
  els.profileBtn.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = els.profileMenu.hidden;
    closeMenus();
    if (!willOpen) return;
    renderKeyChip();
    els.profileMenu.hidden = false;
    els.profileBtn.setAttribute('aria-expanded', 'true');
  });
  els.profileKeyBtn.addEventListener('click', () => {
    closeMenus();
    els.keyCard.hidden = false;
    els.keyInput.focus();
  });
  els.profileLogoutBtn.addEventListener('click', () => {
    closeMenus();
    if (confirm('Выйти из профиля ' + currentUser() + '?')) logout();
  });

  // пин-пад: цифры и backspace
  els.pinpad.addEventListener('click', e => {
    const button = e.target.closest('.pk');
    if (!button) return;
    if (button.dataset.digit && pinBuf.length < PIN_MAX) {
      pinBuf += button.dataset.digit;
      renderDots();
      gateHint('');
    } else if (button.dataset.action === 'back') {
      pinBuf = pinBuf.slice(0, -1);
      renderDots();
    }
  });
  els.enterBtn.addEventListener('click', enterGate);
  els.nickInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.pinpad.querySelector('[data-digit="1"]').focus(); });
  els.tabs.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) setView(tab.dataset.tab);
  });

  // Enter отправляет в чате, Shift+Enter — перенос строки (как в обычном мессенджере).
  els.prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && mode === 'chat') {
      e.preventDefault();
      create();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && document.activeElement === activePromptEl()) create();
  });

  // ---- старт: сессия или гейт входа ------------------------------------------------
  renderDots();
  renderChrome();
  const savedUser = currentUser();
  if (savedUser && profiles()[savedUser]) startSession(savedUser);
  else { els.gate.hidden = false; els.nickInput.focus(); }
})();
