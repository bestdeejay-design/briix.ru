/* BRIIX Studio — standalone screen: chat / photo / music on the private bus.
 * Own minimal transport (pattern of bus-live.js, no shared code). No secrets in git.
 * Chat: SSE stream from /v1/chat/completions. Photo/Music: POST /jobs + polling.
 * "Улучшить": few-shot from assets/data/creative-base.json (owner's own style base).
 */
(() => {
  'use strict';

  const DEFAULT_SERVER = 'http://127.0.0.1:8300';
  const SERVER_KEY = 'briix-media-live-server';
  const TOKEN_KEY = 'briix-media-live-token';
  const CHAT_MODEL = 'qwen3:4b-instruct';
  const MUSIC_MODELS = { flash: 'ace-step-flash', pro: 'ace-step-pro' };
  const STAGE_LABELS = {
    'writing-lyrics': 'Пишем лирику…',
    'synthesizing': 'Синтезируем музыку…',
    'album-cover': 'Готовим обложку…',
    'model-warmup': 'Прогреваем модель…'
  };

  const ASSISTANTS = {
    chat: [
      { id: 'mentor', name: 'Наставник (общий)', system: 'Ты «Наставник» — дружелюбный универсальный собеседник студии BRIIX. Отвечай по-русски, по делу и кратко: 2–6 абзацев максимум. Если вопрос про музыку, фото или промпты — помоги практическим советом и предложи, какой режим студии (чат/фото/музыка) удобнее для следующего шага.' },
      { id: 'producer', name: 'Музыкальный продюсер', system: 'Ты «Музыкальный продюсер» — опытный композитор и продюсер. Обсуждай жанры, референсы, аранжировки, BPM, вокал, структуру трека. Отвечай по-русски, конкретно: давай проверенные рецепты (темп, инструменты, динамика, характер вокала) и честно говори, что не сработает. Помогай довести идею до готового музыкального промпта.' },
      { id: 'prompt-eng', name: 'Промпт-инженер', system: 'Ты «Промпт-инженер» — специалист по сборке музыкальных промптов для модели ACE-Step. Из идеи пользователя собирай компактный англоязычный промпт одной строкой: жанр, BPM, вокал (тип голоса), инструменты, продакшн-детали (tape saturation, reverb), структура. Добавляй негативные указания через "no ..." при нужде. Пояснения — по-русски, сам промпт — по-английски.' }
    ],
    photo: [
      { id: 'art-dir', name: 'Арт-директор (FLUX)', system: 'Ты «Арт-директор» — улучшаешь промпты для генерации изображений (FLUX). Преврати идею пользователя в детальный англоязычный промпт: субъект, композиция, свет, палитра, стиль, объектив/ракурс, атмосфера. Без воды — только готовый промпт и одно короткое пояснение по-русски.' }
    ],
    music: [
      { id: 'producer', name: 'Продюсер', system: 'Ты «Продюсер» — помогаешь довести музыкальный промпт для ACE-Step. Работай с англоязычным описанием стиля: жанр, BPM, вокал, инструменты, продакшн, структура, негативные указания. Отвечай по-русски кратко и конкретно, сам промпт — по-английски одной строкой.' },
      { id: 'lyricist', name: 'Лирик', system: 'Ты «Лирик» — поэт-песенник. Помогай доработать лирику: образность, ритм, рифма, структура (куплет/припев/бридж), характер вокала в ремарках. Пиши по-русски (или в языке пользователя), держи строку пропеваемой, избегай штампов. Предлагай правки точечно, не переписывая всё без нужды.' }
    ]
  };

  // ---- transport -----------------------------------------------------------
  const server = () => {
    const host = location.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return location.origin + '/api';
    try { return JSON.parse(localStorage.getItem(SERVER_KEY)) || DEFAULT_SERVER; } catch { return DEFAULT_SERVER; }
  };
  const token = () => localStorage.getItem(TOKEN_KEY) || '';
  const setToken = v => { const s = String(v || '').trim(); if (s) localStorage.setItem(TOKEN_KEY, s); else localStorage.removeItem(TOKEN_KEY); };
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

  // ---- creative base -------------------------------------------------------
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

  // ---- UI ------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const els = {
    modes: $('modes'), assistant: $('assistant'), feed: $('feed'),
    singleField: $('singleField'), inputText: $('inputText'),
    musicFields: $('musicFields'), lyrics: $('lyrics'), musicPrompt: $('musicPrompt'),
    improveLyrics: $('improveLyrics'), improvePrompt: $('improvePrompt'),
    undoLyrics: $('undoLyrics'), undoPrompt: $('undoPrompt'),
    vocalQuality: $('vocalQuality'), create: $('create'), status: $('status'),
    keyCard: $('keyCard'), keyInput: $('keyInput'), keySave: $('keySave')
  };

  let mode = 'chat';
  let quality = 'flash';
  let history = []; // chat mode: {role, content}
  let busy = false;
  let controller = null;
  const undoBackup = { lyrics: null, musicPrompt: null };

  function signalOf() {
    controller = new AbortController();
    return controller.signal;
  }

  function setStatus(text) {
    els.status.hidden = !text;
    els.status.textContent = text || '';
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

  function renderMode() {
    els.modes.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    els.musicFields.hidden = mode !== 'music';
    els.singleField.hidden = mode === 'music';
    els.inputText.placeholder = mode === 'photo' ? 'Опишите изображение…' : 'Напишите сообщение…';
    const current = els.assistant.value;
    els.assistant.innerHTML = '';
    for (const a of ASSISTANTS[mode]) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      els.assistant.append(opt);
    }
    const stillThere = ASSISTANTS[mode].some(a => a.id === current);
    if (stillThere) els.assistant.value = current;
    updateImproveButtons();
  }

  function assistantSystem() {
    const found = ASSISTANTS[mode].find(a => a.id === els.assistant.value);
    return found?.system || '';
  }

  function updateImproveButtons() {
    els.improveLyrics.disabled = busy || !els.lyrics.value.trim();
    els.improvePrompt.disabled = busy || !els.musicPrompt.value.trim();
  }

  function setBusy(v, statusText) {
    busy = v;
    els.create.disabled = v;
    els.improveLyrics.classList.toggle('busy', v);
    els.improvePrompt.classList.toggle('busy', v);
    updateImproveButtons();
    setStatus(v ? (statusText || 'Работаем…') : '');
  }

  function needKey() {
    if (token()) return true;
    els.keyCard.hidden = false;
    els.keyInput.focus();
    card('notice', 'Ключ', 'Вставьте ключ приватного стенда — тот же, что в Настройках демо.');
    return false;
  }

  async function create() {
    if (busy) return;
    if (!needKey()) return;
    const text = els.inputText.value.trim();
    if (mode === 'music') return createMusic();
    if (!text) return;
    if (mode === 'chat') return createChat(text);
    return createPhoto(text);
  }

  async function createChat(text) {
    history.push({ role: 'user', content: text });
    card('user', 'Вы', text);
    els.inputText.value = '';
    const who = ASSISTANTS.chat.find(a => a.id === els.assistant.value)?.name || 'Помощник';
    const body = card('assistant', who, '');
    setBusy(true, who + ' печатает…');
    try {
      const messages = [{ role: 'system', content: assistantSystem() }, ...history];
      const full = await chatStream({ messages, onChunk: piece => { body.textContent += piece; body.scrollIntoView({ block: 'nearest' }); } });
      history.push({ role: 'assistant', content: full });
    } catch (error) {
      history.pop(); // неудачный ход не остаётся в истории
      if (!els.inputText.value.trim()) els.inputText.value = text; // текст сохраняем для правки
      errorCard(error);
    } finally { setBusy(false); }
  }

  async function createPhoto(text) {
    card('user', 'Вы', text);
    els.inputText.value = '';
    setBusy(true, 'Отправляем задачу…');
    try {
      const id = await submitJob({ type: 'image', prompt: text });
      const stageBody = card('stage', 'Фото', 'В очереди…');
      const result = await pollJob(id, { onStatus: d => { stageBody.textContent = d.stage ? (STAGE_LABELS[d.stage] || d.stage) : 'Генерируем…'; } });
      els.feed.removeChild(stageBody.closest('.card'));
      const item = document.createElement('img');
      item.alt = 'Результат';
      const blob = await fileBlob(result.result_url);
      item.src = URL.createObjectURL(blob);
      const wrap = card('assistant', 'Фото готово', '');
      wrap.textContent = '';
      wrap.append(item);
    } catch (error) { errorCard(error); } finally { setBusy(false); }
  }

  async function createMusic() {
    const lyrics = els.lyrics.value.trim();
    const prompt = els.musicPrompt.value.trim();
    if (!prompt) { card('notice', 'Музыка', 'Заполните музыкальный промпт — сервер принимает его в prompt.'); return; }
    setBusy(true, 'Отправляем задачу…');
    try {
      const id = await submitJob({ type: 'music', prompt, params: { lyrics, model: MUSIC_MODELS[quality] } });
      const stageBody = card('stage', 'Музыка', 'В очереди…');
      const result = await pollJob(id, { onStatus: d => { stageBody.textContent = d.stage ? (STAGE_LABELS[d.stage] || d.stage) : 'Генерируем…'; } });
      els.feed.removeChild(stageBody.closest('.card'));
      const audio = document.createElement('audio');
      audio.controls = true;
      const blob = await fileBlob(result.result_url);
      audio.src = URL.createObjectURL(blob);
      const wrap = card('assistant', 'Трек готов (' + (MUSIC_MODELS[quality] === 'ace-step-pro' ? 'Pro' : 'Flash') + ')', '');
      wrap.textContent = '';
      wrap.append(audio);
    } catch (error) { errorCard(error); } finally { setBusy(false); }
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
    try {
      const improved = await improveText(original, field);
      undoBackup[field] = original;
      el.value = improved.trim();
      (field === 'lyrics' ? els.undoLyrics : els.undoPrompt).hidden = false;
    } catch (error) { errorCard(error); } finally { setBusy(false); }
  }

  function undo(field) {
    if (undoBackup[field] == null) return;
    (field === 'lyrics' ? els.lyrics : els.musicPrompt).value = undoBackup[field];
    undoBackup[field] = null;
    (field === 'lyrics' ? els.undoLyrics : els.undoPrompt).hidden = true;
  }

  // ---- wiring --------------------------------------------------------------
  els.modes.addEventListener('click', e => {
    const button = e.target.closest('.mode');
    if (!button) return;
    mode = button.dataset.mode;
    renderMode();
  });

  els.assistant.addEventListener('change', () => { /* история общая; system подставляется при следующем ходе */ });

  els.vocalQuality.addEventListener('click', e => {
    const button = e.target.closest('.seg-btn');
    if (!button) return;
    quality = button.dataset.quality;
    els.vocalQuality.querySelectorAll('.seg-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.quality === quality)));
  });

  els.create.addEventListener('click', create);
  els.improveLyrics.addEventListener('click', () => improve('lyrics'));
  els.improvePrompt.addEventListener('click', () => improve('prompt'));
  els.undoLyrics.addEventListener('click', () => undo('lyrics'));
  els.undoPrompt.addEventListener('click', () => undo('musicPrompt'));

  els.inputText.addEventListener('input', () => { els.create.disabled = busy ? true : !els.inputText.value.trim() && mode !== 'music'; });
  els.lyrics.addEventListener('input', updateImproveButtons);
  els.musicPrompt.addEventListener('input', updateImproveButtons);

  els.keySave.addEventListener('click', () => {
    setToken(els.keyInput.value);
    els.keyInput.value = '';
    els.keyCard.hidden = true;
    card('notice', 'Ключ', 'Ключ сохранён в этом браузере.');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && document.activeElement === els.inputText) create();
  });

  renderMode();
})();
