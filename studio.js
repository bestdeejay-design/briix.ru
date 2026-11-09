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
  const DURATIONS = [30, 60, 120, 240, 300];
  const STAGE_LABELS = {
    'writing-lyrics': 'Пишем лирику…',
    'synthesizing': 'Синтезируем музыку…',
    'album-cover': 'Готовим обложку…',
    'model-warmup': 'Прогреваем модель…'
  };
  const MODE_LABELS = { chat: 'Чат', photo: 'Фото', music: 'Музыка' };
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

  async function chatNonStream({ messages, maxTokens }) {
    const response = await request('/v1/chat/completions', {
      method: 'POST', headers: headers(), signal: signalOf(),
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

  async function chatStream({ messages, onChunk }) {
    const response = await request('/v1/chat/completions', {
      method: 'POST', headers: headers(), signal: signalOf(),
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

  async function pollJob(id, { onStatus, intervalMs = 2000, timeoutMs = 15 * 60000 }) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise(r => setTimeout(r, intervalMs));
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
    vocalChip: $('vocalChip'), tuneToggle: $('tuneToggle'),
    send: $('send'), feed: $('feed'), status: $('status'), metaLeft: $('metaLeft'),
    composer: $('composer'), keyCard: $('keyCard'), keyInput: $('keyInput'), keySave: $('keySave')
  };

  let mode = 'chat';
  let quality = 'flash';
  let duration = 300; // по умолчанию — полная песня
  try { const saved = Number(localStorage.getItem('briix-studio-duration')); if (saved >= 5) duration = saved; } catch {}
  let instrumental = false;
  let advanced = false;
  let busy = false;
  let history = []; // chat mode: {role, content}
  let controller = null;
  const assistantId = { chat: 'mentor', photo: 'art-dir', music: 'producer' };
  const undoBackup = { lyrics: null, musicPrompt: null };

  function signalOf() {
    controller = new AbortController();
    return controller.signal;
  }

  function setStatus(text, isBusy) {
    els.status.textContent = text || 'готов';
    els.status.classList.toggle('busy', Boolean(isBusy));
  }

  function currentAssistant() {
    return ASSISTANTS[mode].find(a => a.id === assistantId[mode]) || ASSISTANTS[mode][0];
  }

  function meta() {
    const bits = ['briix.ru', MODE_LABELS[mode]];
    if (mode === 'music') bits.push(MODEL_LABELS[quality] + ' · ' + duration + ' с');
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
  attachMenu(els.durationChip, els.durationMenu, () => DURATIONS.map(d => ({
    label: d + ' с', selected: d === duration,
    onPick: () => { duration = d; try { localStorage.setItem('briix-studio-duration', String(d)); } catch {} renderChrome(); }
  })));

  // ---- карточки ленты ---------------------------------------------------------
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
    div.scrollIntoView({ block: 'nearest' });
    return body;
  }

  function errorCard(error) {
    if (error.code === 'content_blocked') {
      const body = card('error', 'Модерация', 'Не пройдена проверка контента: ' + (error.message || 'запрос нарушает политику.') + ' Текст сохранён в поле ввода — отредактируйте и попробуйте снова.');
      body.dataset.code = 'content_blocked';
      return;
    }
    if (error.code === 'unauthorized') { els.keyCard.hidden = false; els.keyInput.focus(); }
    card('error', 'Ошибка', error.message || 'Неизвестная ошибка.');
  }

  // «Сделать из этого трек»: чат → музыка с подставленным брифом.
  function addMakeTrackAction(container, brief) {
    const row = document.createElement('div');
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

  // ---- режим/состояния ---------------------------------------------------------
  function setMode(next) {
    mode = next;
    renderChrome();
  }

  function renderChrome() {
    els.modes.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const isMusic = mode === 'music';
    document.querySelectorAll('.music-only').forEach(el => { el.hidden = !isMusic; });
    els.advanced.hidden = !(isMusic && advanced);
    els.prompt.hidden = isMusic && advanced;
    els.prompt.placeholder = PLACEHOLDERS[mode];
    els.assistantName.textContent = currentAssistant().name.replace(/\s*\(.*\)\s*$/, '');
    els.modelName.textContent = MODEL_LABELS[quality];
    els.durationName.textContent = duration + ' с';
    els.vocalChip.setAttribute('aria-pressed', String(instrumental));
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
    els.send.disabled = busy || !promptValue();
    els.improveLyrics.disabled = busy || !els.lyrics.value.trim();
    els.improvePrompt.disabled = busy || !els.musicPrompt.value.trim();
  }

  function setBusy(v, statusText) {
    busy = v;
    els.send.classList.toggle('busy', v);
    els.improveLyrics.classList.toggle('busy', v);
    els.improvePrompt.classList.toggle('busy', v);
    setStatus(v ? (statusText || 'Работаем…') : '', v);
    updateEnabled();
  }

  function needKey() {
    if (token()) return true;
    els.keyCard.hidden = false;
    els.keyInput.focus();
    card('notice', 'Ключ', 'Вставьте ключ приватного стенда — тот же, что в Настройках демо.');
    return false;
  }

  // ---- потоки -------------------------------------------------------------------
  async function create() {
    if (busy) return;
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
    els.prompt.value = '';
    updateEnabled();
    const who = currentAssistant().name;
    const body = card('assistant', who, '');
    setBusy(true, who + ' печатает…');
    try {
      const messages = [{ role: 'system', content: currentAssistant().system }, ...history];
      const full = await chatStream({ messages, onChunk: piece => { body.textContent += piece; body.scrollIntoView({ block: 'nearest' }); } });
      history.push({ role: 'assistant', content: full });
      addMakeTrackAction(body.closest('.card'), full);
    } catch (error) {
      history.pop(); // неудачный ход не остаётся в истории
      if (!els.prompt.value.trim()) els.prompt.value = text; // текст сохраняем для правки
      errorCard(error);
    } finally { setBusy(false); updateEnabled(); }
  }

  async function createPhoto(text) {
    card('user', 'Вы', text);
    els.prompt.value = '';
    updateEnabled();
    setBusy(true, 'Отправляем задачу…');
    try {
      const id = await submitJob({ type: 'image', prompt: text });
      const stageBody = card('stage', 'Фото', 'В очереди…');
      const result = await pollJob(id, { onStatus: d => { stageBody.textContent = d.stage ? (STAGE_LABELS[d.stage] || d.stage) : 'Генерируем…'; } });
      stageBody.closest('.card').remove();
      const item = document.createElement('img');
      item.alt = 'Результат';
      const blob = await fileBlob(result.result_url);
      item.src = URL.createObjectURL(blob);
      const wrap = card('assistant', 'Фото готово', '');
      wrap.textContent = '';
      wrap.append(item);
    } catch (error) {
      if (!els.prompt.value.trim()) els.prompt.value = text; // текст сохраняем для правки
      errorCard(error);
    } finally { setBusy(false); updateEnabled(); }
  }

  async function autoLyrics(topic) {
    // vocal-модели требуют текст: если лирика пустая — qwen3 пишет её сам
    const messages = [
      { role: 'system', content: 'Ты — автор песен. Напиши текст песни на русском языке по теме пользователя. 8–16 строк. Обязательно используй структурные теги [verse] и [chorus] (можно [bridge], [outro]). Без пояснений и вступлений — только текст песни с тегами.' },
      { role: 'user', content: 'Тема песни: ' + topic }
    ];
    let full = '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      full = await chatStream({ messages, onChunk: () => {}, signal: controller.signal });
    } finally { clearTimeout(timer); }
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
    setBusy(true, vocal && !lyrics && !instrumental ? 'Пишем текст песни…' : 'Отправляем задачу…');
    try {
      if (vocal && !lyrics) {
        try {
          lyrics = await autoLyrics(style || lyrics || 'песня');
          if (advanced) els.lyrics.value = lyrics;
        } catch {
          setBusy(false); updateEnabled();
          card('notice', 'Музыка', 'Не удалось автоматически написать лирику. Заполните поле «Лирика» вручную (кнопка ✨ тоже поможет) и попробуйте снова.');
          return;
        }
      }
      const params = { model: MUSIC_MODELS[quality], duration_seconds: duration };
      if (instrumental) params.instrumental = true;
      if (lyrics) params.lyrics = lyrics;
      const id = await submitJob({ type: 'music', prompt: style || lyrics, params });
      const stageBody = card('stage', 'Музыка', 'В очереди…');
      const result = await pollJob(id, { onStatus: d => { stageBody.textContent = d.stage ? (STAGE_LABELS[d.stage] || d.stage) : 'Генерируем…'; } });
      stageBody.closest('.card').remove();
      const audio = document.createElement('audio');
      audio.controls = true;
      const blob = await fileBlob(result.result_url);
      audio.src = URL.createObjectURL(blob);
      const wrap = card('assistant', 'Трек готов (' + MODEL_LABELS[quality] + ' · ' + duration + ' с)', '');
      wrap.textContent = '';
      wrap.append(audio);
    } catch (error) {
      // текст остаётся в полях для правки (в т.ч. после 422)
      if (!advanced && !els.prompt.value.trim()) els.prompt.value = description;
      if (advanced && !els.musicPrompt.value.trim()) els.musicPrompt.value = style;
      errorCard(error);
    } finally { setBusy(false); updateEnabled(); }
  }

  async function fileBlob(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : server() + pathOrUrl;
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token() } });
    if (!response.ok) throw new BusError('http', 'Файл не получен (' + response.status + ').', response.status);
    return response.blob();
  }

  async function improve(field) {
    if (busy) return;
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

  // ---- wiring -------------------------------------------------------------------
  els.modes.addEventListener('click', e => {
    const button = e.target.closest('.mode');
    if (!button) return;
    setMode(button.dataset.mode);
  });

  els.tuneToggle.addEventListener('click', () => { advanced = !advanced; renderChrome(); });
  els.vocalChip.addEventListener('click', () => { instrumental = !instrumental; renderChrome(); });

  els.send.addEventListener('click', create);
  els.improveLyrics.addEventListener('click', () => improve('lyrics'));
  els.improvePrompt.addEventListener('click', () => improve('prompt'));
  els.undoLyrics.addEventListener('click', () => undo('lyrics'));
  els.undoPrompt.addEventListener('click', () => undo('musicPrompt'));
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
    card('notice', 'Ключ', 'Ключ сохранён в этом браузере.');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && document.activeElement === activePromptEl()) create();
  });

  renderChrome();
})();
