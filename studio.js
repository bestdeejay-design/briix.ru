/* BRIIX Studio v3 — a durable, multimodal chat on the existing private media-bff.
 * Every request owns its card, AbortController and server job. The composer never locks:
 * while one answer is being generated the next idea can already be on its way.
 * No secrets, blobs or base64 in storage. Catalog readiness is never replaced by a mock.
 */
(() => {
  'use strict';

  const STORE_KEY = 'briix-studio-v3';
  const MAX_ITEMS = 60;
  const MAX_HISTORY_MESSAGES = 12;
  const MAX_HISTORY_CHARS = 8000;
  const MUSIC_MODELS = ['ace-step-flash', 'ace-step-pro'];
  const DURATIONS = [30, 60, 120, 180, 240, 300];
  const DEFAULT_MODEL = { chat: 'qwen3:4b-instruct', photo: 'flux-2-klein-4b', music: 'ace-step-flash' };
  const MODE_LABELS = { chat: 'Текст', photo: 'Фото', music: 'Музыка' };
  const PLACEHOLDERS = { chat: 'Напишите сообщение…', photo: 'Опишите изображение…', music: 'Опишите песню или инструментал…' };
  const MODEL_META = {
    'qwen3:4b-instruct': { name: 'Qwen 3 · 4B', mode: 'chat', description: 'Текст и диалог' },
    'flux-2-klein-4b': { name: 'FLUX.2 Klein · 4B', mode: 'photo', description: 'Изображение' },
    'musicgen-small': { name: 'MusicGen Small', mode: 'music', description: 'Инструментал без вокала' },
    'ace-step-flash': { name: 'ACE-Step Flash', mode: 'music', description: 'Песня с вокалом · быстрее' },
    'ace-step-pro': { name: 'ACE-Step Pro', mode: 'music', description: 'Песня с вокалом · качественнее' }
  };
  const STAGE_LABELS = {
    'writing-lyrics': 'Создаю музыкальную структуру',
    synthesizing: 'Синтезирую голос и инструменты',
    'album-cover': 'Оформляю обложку',
    'model-warmup': 'Загружаю модель в память',
    generating: 'Генерирую результат',
    queued: 'Запрос принят в очередь',
    'local-queue': 'В очереди — предыдущая генерация ещё создаётся',
    reconnecting: 'Связь прервалась — переподключаюсь'
  };
  const SUGGESTIONS = {
    chat: ['Придумай 5 названий для трека о возвращении домой', 'Собери контент-план для маленькой кофейни на неделю', 'Помоги превратить идею в сильный творческий бриф'],
    photo: ['Керамическая чашка на тёмном камне, мягкий утренний свет', 'Постер электронного концерта: типографика, свет, глубина', 'Уютная мастерская художника, плёночная фотография'],
    music: ['Dream pop о ночном городе, 90 BPM, женский вокал', 'Тёплый lo-fi инструментал для спокойной работы', 'Песня о дороге домой: куплет, припев и финальный бридж']
  };
  const ASSISTANTS = [
    { id: 'mentor', name: 'Наставник', system: 'Ты «Наставник» — дружелюбный универсальный собеседник студии BRIIX. Отвечай по-русски, по делу и кратко. Помогай развивать идеи, а не просто давать общие советы. Не выдумывай факты и источники.' },
    { id: 'producer', name: 'Продюсер', system: 'Ты «Музыкальный продюсер» — опытный композитор и продюсер BRIIX. Обсуждай жанры, референсы, аранжировки, BPM, вокал и структуру трека. Отвечай по-русски конкретно: темп, инструменты, динамика, характер вокала. Помогай довести идею до готового музыкального промпта.' },
    { id: 'prompt-eng', name: 'Промпт-инженер', system: 'Ты «Промпт-инженер» BRIIX. Превращай идею пользователя в практичный промпт для генеративной модели. Для музыки: жанр, BPM, вокал, инструменты, продакшн и структура. Для изображения: субъект, композиция, свет, палитра и атмосфера. Пояснения по-русски, готовый промпт можно дать по-английски.' }
  ];

  const $ = id => document.getElementById(id);
  const els = {
    feed: $('feed'), welcome: $('welcome'), suggestions: $('suggestions'),
    prompt: $('prompt'), advanced: $('advanced'), lyrics: $('lyrics'), musicPrompt: $('musicPrompt'),
    modes: $('modes'), assistantChip: $('assistantChip'), assistantName: $('assistantName'), assistantMenu: $('assistantMenu'),
    modelChip: $('modelChip'), modelName: $('modelName'), modelMenu: $('modelMenu'),
    durationAnchor: $('durationAnchor'), durationChip: $('durationChip'), durationName: $('durationName'), durationMenu: $('durationMenu'),
    vocalChip: $('vocalChip'), tuneToggle: $('tuneToggle'), send: $('send'), metaLeft: $('metaLeft'), status: $('status'),
    improveLyrics: $('improveLyrics'), improvePrompt: $('improvePrompt'), undoLyrics: $('undoLyrics'), undoPrompt: $('undoPrompt'), tags: $('tags'),
    connectionButton: $('connectionButton'), connectionDot: $('connectionDot'), connectionLabel: $('connectionLabel'),
    keyCard: $('keyCard'), keyInput: $('keyInput'), keySave: $('keySave'), keyClose: $('keyClose'), keyStatus: $('keyStatus'),
    notice: $('notice'), noticeText: $('noticeText'), noticeClose: $('noticeClose'),
    clearFeed: $('clearFeed'), clearDialog: $('clearDialog'), clearCancel: $('clearCancel'), clearConfirm: $('clearConfirm'), announcer: $('announcer')
  };
  const bus = window.BRIIX_BUS;
  if (!bus) {
    els.notice.hidden = false;
    els.noticeText.textContent = 'Модуль связи с сервером не загрузился. Обновите страницу.';
    return;
  }

  // A shared link may carry the key, but it must not remain in history or referrers.
  try {
    const url = new URL(location.href);
    const key = url.searchParams.get('key');
    if (key) {
      bus.setToken(key);
      url.searchParams.delete('key');
      history.replaceState(null, '', url.pathname + (url.searchParams.size ? '?' + url.searchParams : '') + url.hash);
    }
  } catch { /* storage can be unavailable in private browsing */ }

  let catalog = [];
  let catalogState = 'idle'; // idle | loading | ready | error
  let mode = 'chat';
  let assistantId = 'mentor';
  let advanced = false;
  let duration = 60;
  let selectedByMode = { ...DEFAULT_MODEL };
  let items = [];
  let activeRuns = new Map(); // assistant item id -> { controller, kind }
  let nodes = new Map();
  let mediaCache = new Map(); // assistant item id -> {url, blob, name}
  let mediaLoads = new Map();
  let musicQueue = Promise.resolve();
  let saveTimer = null;
  let draftTimer = null;
  let elapsedTimer = null;
  const undoBackup = { lyrics: null, musicPrompt: null };

  function uid(prefix = 'studio') { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function cleanText(value, max = 20000) { return typeof value === 'string' ? value.slice(0, max) : ''; }
  function safeItem(raw) {
    if (!raw || typeof raw !== 'object' || !['user', 'assistant'].includes(raw.role)) return null;
    if (!['chat', 'photo', 'music'].includes(raw.mode)) return null;
    const statuses = ['queued', 'running', 'streaming', 'ready', 'error', 'stopped', 'expired'];
    return {
      id: cleanText(raw.id, 80) || uid('item'), role: raw.role, mode: raw.mode,
      content: cleanText(raw.content), model: cleanText(raw.model, 100) || null,
      status: statuses.includes(raw.status) ? raw.status : 'ready',
      stage: cleanText(raw.stage, 200), error: cleanText(raw.error, 1000),
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      serverJobId: cleanText(raw.serverJobId, 100) || null,
      resultUrl: cleanText(raw.resultUrl, 1000) || null,
      mime: cleanText(raw.mime, 100) || null,
      provenance: raw.provenance && typeof raw.provenance === 'object' ? raw.provenance : null,
      request: raw.request && typeof raw.request === 'object' ? {
        prompt: cleanText(raw.request.prompt, 4000), lyrics: cleanText(raw.request.lyrics, 8000),
        duration: Math.max(5, Math.min(3600, Number(raw.request.duration) || 60)),
        model: cleanText(raw.request.model, 100), assistantId: cleanText(raw.request.assistantId, 40)
      } : null
    };
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      items = Array.isArray(saved.items) ? saved.items.map(safeItem).filter(Boolean).slice(-MAX_ITEMS) : [];
      const prefs = saved.prefs || {};
      if (['chat', 'photo', 'music'].includes(prefs.mode)) mode = prefs.mode;
      if (ASSISTANTS.some(a => a.id === prefs.assistantId)) assistantId = prefs.assistantId;
      advanced = !!prefs.advanced;
      duration = DURATIONS.includes(Number(prefs.duration)) ? Number(prefs.duration) : 60;
      for (const m of Object.keys(DEFAULT_MODEL)) {
        if (typeof prefs.selectedByMode?.[m] === 'string' && MODEL_META[prefs.selectedByMode[m]]) selectedByMode[m] = prefs.selectedByMode[m];
      }
      els.prompt.value = cleanText(saved.drafts?.prompt, 4000);
      els.lyrics.value = cleanText(saved.drafts?.lyrics, 8000);
      els.musicPrompt.value = cleanText(saved.drafts?.musicPrompt, 4000);
    } catch { items = []; }
  }
  function serializableItems() {
    return items.slice(-MAX_ITEMS).map(item => ({ ...item, provenance: item.provenance ? JSON.parse(JSON.stringify(item.provenance)) : null }));
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          items: serializableItems(),
          prefs: { mode, assistantId, advanced, duration, selectedByMode },
          drafts: { prompt: els.prompt.value, lyrics: els.lyrics.value, musicPrompt: els.musicPrompt.value }
        }));
      } catch { /* storage full/private: the active feed still works */ }
    }, 120);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        items: serializableItems(), prefs: { mode, assistantId, advanced, duration, selectedByMode },
        drafts: { prompt: els.prompt.value, lyrics: els.lyrics.value, musicPrompt: els.musicPrompt.value }
      }));
    } catch { /* no persistence available */ }
  }

  function entry(id) { return catalog.find(model => model.id === id) || null; }
  function meta(id) { return MODEL_META[id] || { name: id || 'Модель сервера', mode, description: 'Модель из каталога' }; }
  function modelId() { return selectedByMode[mode] || DEFAULT_MODEL[mode]; }
  function isReady(id = modelId()) { return entry(id)?.status === 'ready'; }
  function isVocal(id = modelId()) { return MUSIC_MODELS.includes(id); }
  function modeForModel(id) { return meta(id).mode; }
  function currentAssistant() { return ASSISTANTS.find(a => a.id === assistantId) || ASSISTANTS[0]; }
  function modelLatency(id) {
    const seconds = Number(entry(id)?.latency?.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return seconds < 90 ? 'обычно около ' + Math.round(seconds) + ' с' : 'обычно около ' + Math.max(1, Math.round(seconds / 60)) + ' мин';
  }
  function durationCap(id) {
    // The catalog is informational; duration is never used to disable the composer.
    return Number(entry(id)?.limits?.max_duration_seconds) || 300;
  }
  function announce(text) { els.announcer.textContent = ''; setTimeout(() => { els.announcer.textContent = text; }, 20); }
  function notify(text) {
    els.noticeText.textContent = text;
    els.notice.hidden = false;
  }

  // ---- Catalog and connection --------------------------------------------
  function renderConnection() {
    const pending = activeRuns.size;
    els.connectionDot.className = 'connection-dot' + (catalogState === 'loading' ? ' busy' : catalogState === 'ready' ? ' ready' : catalogState === 'error' ? ' error' : '');
    els.connectionLabel.textContent = pending ? pending + ' в работе' :
      catalogState === 'loading' ? 'Проверяем стенд' : catalogState === 'ready' ? 'Стенд подключён' :
      catalogState === 'error' ? 'Нет связи' : bus.hasToken() ? 'Подключить модели' : 'Нужен ключ';
    els.clearFeed.disabled = !items.length;
    els.status.textContent = pending ? pending + ' в работе · можно писать дальше' : 'готов';
    els.status.classList.toggle('busy', pending > 0);
  }
  async function loadCatalog(force = true) {
    if (!bus.hasToken()) { catalog = []; catalogState = 'idle'; renderChrome(); return false; }
    catalogState = 'loading'; renderConnection();
    try {
      const health = await bus.health();
      if (!health) throw new bus.BusError('network', 'Стенд не отвечает. Проверьте туннель и адрес сервера.');
      catalog = await bus.models(force);
      catalogState = 'ready';
      for (const m of Object.keys(DEFAULT_MODEL)) {
        const selected = entry(selectedByMode[m]);
        if (!selected) {
          const fallback = catalog.find(model => model.status === 'ready' && modeForModel(model.id) === m);
          if (fallback) selectedByMode[m] = fallback.id;
        }
      }
      renderChrome();
      return true;
    } catch (error) {
      catalog = []; catalogState = 'error';
      renderChrome();
      if (error.code === 'unauthorized') showKey('Ключ отклонён стендом. Вставьте новый ключ.');
      return false;
    }
  }
  function showKey(message = '') {
    els.keyCard.hidden = false;
    els.connectionButton.setAttribute('aria-expanded', 'true');
    els.keyStatus.classList.toggle('error', !!message);
    els.keyStatus.textContent = message || 'Ключ хранится только в этом браузере и не попадает в экспорт ленты.';
    setTimeout(() => els.keyInput.focus(), 30);
  }
  function hideKey() {
    els.keyCard.hidden = true;
    els.connectionButton.setAttribute('aria-expanded', 'false');
  }

  // ---- Menus ---------------------------------------------------------------
  let openChip = null;
  function closeMenus(returnFocus = false) {
    document.querySelectorAll('.menu').forEach(menu => { menu.hidden = true; });
    document.querySelectorAll('[aria-haspopup="menu"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (returnFocus && openChip) openChip.focus();
    openChip = null;
  }
  function attachMenu(chip, menu, title, build) {
    chip.addEventListener('click', event => {
      event.stopPropagation();
      if (!menu.hidden) { closeMenus(); return; }
      closeMenus();
      menu.innerHTML = '';
      const heading = document.createElement('div'); heading.className = 'menu-title'; heading.textContent = title; menu.append(heading);
      const options = build();
      if (!options.length) { const empty = document.createElement('div'); empty.className = 'menu-empty'; empty.textContent = catalogState === 'loading' ? 'Загружаем каталог…' : 'Каталог пока недоступен'; menu.append(empty); }
      for (const option of options) {
        const button = document.createElement('button');
        button.type = 'button'; button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(option.selected));
        button.disabled = !!option.disabled;
        const label = document.createElement('span'); label.className = 'menu-label';
        const strong = document.createElement('strong'); strong.textContent = option.label;
        const small = document.createElement('small'); small.textContent = option.sub || '';
        label.append(strong, small); button.append(label);
        if (option.selected) { const check = document.createElement('span'); check.className = 'menu-check'; check.textContent = '✓'; button.append(check); }
        button.addEventListener('click', () => { closeMenus(true); option.onPick(); });
        menu.append(button);
      }
      menu.hidden = false; chip.setAttribute('aria-expanded', 'true'); openChip = chip;
      (menu.querySelector('[aria-checked="true"]:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
    });
    menu.addEventListener('keydown', event => {
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (event.key === 'Home') { event.preventDefault(); buttons[0]?.focus(); }
      else if (event.key === 'End') { event.preventDefault(); buttons.at(-1)?.focus(); }
    });
  }
  attachMenu(els.assistantChip, els.assistantMenu, 'Роль помощника', () => ASSISTANTS.map(assistant => ({
    label: assistant.name, sub: assistant.id === 'mentor' ? 'Общие идеи и вопросы' : assistant.id === 'producer' ? 'Музыка и аранжировка' : 'Сильные промпты',
    selected: assistant.id === assistantId,
    onPick: () => { assistantId = assistant.id; renderChrome(); save(); }
  })));
  attachMenu(els.modelChip, els.modelMenu, 'Модель для следующего ответа', () => {
    const ids = catalog.length ? catalog.map(model => model.id) : Object.keys(MODEL_META);
    return ids.filter(id => MODEL_META[id]).map(id => {
      const model = entry(id); const ready = model?.status === 'ready';
      return {
        label: meta(id).name,
        sub: meta(id).description + (modelLatency(id) ? ' · ' + modelLatency(id) : '') + (model && !ready ? ' · недоступна' : ''),
        selected: id === modelId(), disabled: catalogState === 'ready' && !ready,
        onPick: () => chooseModel(id)
      };
    });
  });
  attachMenu(els.durationChip, els.durationMenu, 'Длительность следующей песни', () => DURATIONS.map(seconds => ({
    label: seconds >= 60 ? (seconds / 60) + ' мин' : seconds + ' с', sub: seconds === duration ? 'Выбрано' : 'Можно продолжать работать во время генерации',
    selected: seconds === duration,
    onPick: () => { duration = seconds; renderChrome(); save(); }
  })));
  document.addEventListener('click', event => { if (!event.target.closest('.menu-anchor')) closeMenus(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeMenus(true); els.notice.hidden = true; } });

  function chooseModel(id) {
    if (catalogState === 'ready' && !isReady(id)) { notify('Эта модель сейчас недоступна в каталоге. Выберите другую.'); return; }
    mode = modeForModel(id);
    selectedByMode[mode] = id;
    renderChrome(); save();
  }
  function setMode(next) {
    mode = next;
    if (!entry(modelId()) && catalogState === 'ready') {
      const fallback = catalog.find(model => model.status === 'ready' && modeForModel(model.id) === next);
      if (fallback) selectedByMode[next] = fallback.id;
    }
    renderChrome(); save();
  }
  function activePromptEl() { return mode === 'music' && advanced ? els.musicPrompt : els.prompt; }
  function promptValue() { return activePromptEl().value.trim(); }
  function updateEnabled() {
    els.send.disabled = !promptValue();
    els.improveLyrics.disabled = activeRuns.has('improve') || !els.lyrics.value.trim();
    els.improvePrompt.disabled = activeRuns.has('improve') || !els.musicPrompt.value.trim();
  }
  function autoSize() {
    els.prompt.style.height = 'auto';
    els.prompt.style.height = Math.min(180, Math.max(62, els.prompt.scrollHeight)) + 'px';
  }
  function renderSuggestions() {
    els.suggestions.innerHTML = '';
    for (const text of SUGGESTIONS[mode]) {
      const button = document.createElement('button'); button.className = 'suggestion'; button.textContent = text;
      button.addEventListener('click', () => { els.prompt.value = text; advanced = false; renderChrome(); els.prompt.focus(); });
      els.suggestions.append(button);
    }
  }
  function renderChrome() {
    els.modes.querySelectorAll('.mode').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    const music = mode === 'music';
    document.querySelectorAll('.music-only').forEach(element => { element.hidden = !music; });
    document.querySelectorAll('.chat-only').forEach(element => { element.hidden = mode !== 'chat'; });
    els.durationAnchor.hidden = !(music && isVocal());
    els.advanced.hidden = !(music && advanced);
    els.prompt.hidden = music && advanced;
    els.prompt.placeholder = PLACEHOLDERS[mode];
    els.assistantName.textContent = currentAssistant().name;
    els.modelName.textContent = meta(modelId()).name;
    els.modelChip.querySelector('.model-dot').classList.toggle('ready', isReady());
    els.durationName.textContent = duration >= 60 ? (duration / 60) + ' мин' : duration + ' с';
    const instrumental = music && modelId() === 'musicgen-small';
    els.vocalChip.setAttribute('aria-pressed', String(instrumental));
    els.vocalChip.textContent = instrumental ? 'Без вокала' : 'С вокалом';
    els.tuneToggle.setAttribute('aria-pressed', String(advanced));
    const latency = modelLatency();
    els.metaLeft.textContent = meta(modelId()).name + (music && isVocal() ? ' · ' + (duration >= 60 ? (duration / 60) + ' мин' : duration + ' с') : '') + (latency ? ' · ' + latency : '');
    els.welcome.hidden = items.length > 0;
    els.feed.classList.toggle('has-items', items.length > 0);
    if (!items.length) renderSuggestions();
    renderConnection(); updateEnabled(); autoSize();
  }

  // ---- Feed ----------------------------------------------------------------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function timeLabel(timestamp) { return new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)); }
  function nearBottom() { return els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < 110; }
  function scrollBottom(force = false) { if (force || nearBottom()) requestAnimationFrame(() => { els.feed.scrollTop = els.feed.scrollHeight; }); }
  function requestFor(item) {
    const index = items.findIndex(candidate => candidate.id === item.id);
    for (let i = index - 1; i >= 0; i--) if (items[i].role === 'user' && items[i].mode === item.mode) return items[i];
    return null;
  }
  function action(label, handler, primary = false) {
    const button = el('button', 'action' + (primary ? ' primary-action' : ''), label);
    button.type = 'button'; button.addEventListener('click', handler); return button;
  }
  function copyText(text) {
    navigator.clipboard?.writeText(text).then(() => announce('Текст скопирован')).catch(() => notify('Не удалось скопировать. Выделите текст вручную.'));
  }
  function prefillFrom(item) {
    const user = requestFor(item);
    const request = item.request || (user ? { prompt: user.content, model: item.model } : null);
    if (!request) return;
    if (request.model && MODEL_META[request.model]) { mode = modeForModel(request.model); selectedByMode[mode] = request.model; }
    if (request.duration) duration = DURATIONS.includes(request.duration) ? request.duration : duration;
    advanced = mode === 'music' && !!request.lyrics;
    if (advanced) { els.musicPrompt.value = request.prompt || ''; els.lyrics.value = request.lyrics || ''; }
    else els.prompt.value = request.prompt || user?.content || item.content || '';
    renderChrome(); save(); activePromptEl().focus();
  }
  function retry(item) {
    const user = requestFor(item);
    const request = item.request || (user ? { prompt: user.content, model: item.model, assistantId } : null);
    if (!request?.prompt && !request?.lyrics) { prefillFrom(item); return; }
    const config = normalizeConfig({ ...request, mode: item.mode });
    if (item.mode === 'chat') startChat(config);
    else startMedia(config);
  }
  function makeTrack(item) {
    mode = 'music'; selectedByMode.music = 'ace-step-flash'; advanced = false;
    els.prompt.value = item.content.slice(0, 2000);
    renderChrome(); save(); els.prompt.focus();
  }
  function stopRun(item) {
    const run = activeRuns.get(item.id);
    if (!run) return;
    run.stopped = true; run.controller.abort();
    patch(item, { status: 'stopped', stage: '' });
    if (run.serverJobId || item.serverJobId) bus.cancelJob(run.serverJobId || item.serverJobId).catch(() => {});
  }
  function download(item) {
    const media = mediaCache.get(item.id);
    if (!media) { notify('Файл ещё загружается. Попробуйте через секунду.'); return; }
    const link = document.createElement('a'); link.href = media.url; link.download = media.name; document.body.append(link); link.click(); link.remove();
  }
  function buildActions(item, container) {
    if (['queued', 'running', 'streaming'].includes(item.status)) {
      container.append(action('Остановить', () => stopRun(item))); return;
    }
    if (item.content && item.mode === 'chat') container.append(action('Копировать', () => copyText(item.content)));
    if (mediaCache.has(item.id)) container.append(action('Скачать', () => download(item), true));
    if (item.status === 'ready' && item.mode === 'chat' && item.content) container.append(action('Сделать трек', () => makeTrack(item)));
    if (!['content_blocked'].includes(item.provenance?.errorCode)) container.append(action('Повторить', () => retry(item)));
    container.append(action('Изменить запрос', () => prefillFrom(item)));
  }
  function detailsBlock(item) {
    if (!item.provenance && !item.request?.lyrics) return null;
    const fragment = document.createDocumentFragment();
    if (item.request?.lyrics) {
      const details = el('details', 'result-details lyrics-details');
      details.append(el('summary', '', 'Лирика')); const pre = el('pre', '', item.request.lyrics); details.append(pre); fragment.append(details);
    }
    if (item.provenance) {
      const details = el('details', 'result-details'); details.append(el('summary', '', 'Как создан результат'));
      const safe = { model: item.provenance.model || item.model, wallMs: item.provenance.wallMs, streamed: item.provenance.streamed, fallbackReason: item.provenance.fallbackReason, params: item.provenance.params || item.request?.duration && { duration: item.request.duration } };
      Object.keys(safe).forEach(key => safe[key] == null && delete safe[key]);
      details.append(el('pre', '', JSON.stringify(safe, null, 2))); fragment.append(details);
    }
    return fragment;
  }
  function pendingText(item) {
    if (item.mode === 'chat') return item.status === 'queued' ? 'Отправляю сообщение модели…' : 'Пишу ответ…';
    if (item.stage === 'lyrics') return 'Qwen пишет лирику для вашей песни…';
    if (item.stage === 'submit') return 'Отправляю задачу на сервер…';
    return STAGE_LABELS[item.stage] || (item.status === 'queued' ? 'Запрос принят в очередь' : item.mode === 'photo' ? 'Создаю изображение…' : 'Создаю музыку…');
  }
  function elapsed(item) {
    const seconds = Math.max(0, Math.floor((Date.now() - item.createdAt) / 1000));
    return seconds < 60 ? seconds + ' с' : Math.floor(seconds / 60) + ' мин ' + String(seconds % 60).padStart(2, '0') + ' с';
  }
  function buildPending(item) {
    const box = el('div', 'generation-stage'); box.dataset.pending = 'true';
    box.append(el('span', 'stage-spinner'));
    const copy = el('div', 'pending-copy');
    copy.append(el('strong', '', pendingText(item)));
    copy.append(el('small', '', 'Можно писать дальше и выбрать другую модель · ' + elapsed(item)));
    box.append(copy); return box;
  }
  function buildMedia(item) {
    const frame = el('div', 'media-frame'); frame.dataset.media = 'true';
    const cached = mediaCache.get(item.id);
    if (cached && item.mode === 'photo') {
      const image = el('img'); image.src = cached.url; image.alt = item.request?.prompt || requestFor(item)?.content || 'Сгенерированное изображение'; frame.append(image);
      frame.append(el('div', 'result-caption', meta(item.model).name + ' · приватный live'));
    } else if (cached && item.mode === 'music') {
      const audio = el('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = cached.url; frame.append(audio);
      frame.append(el('div', 'result-caption', meta(item.model).name + (item.request?.duration ? ' · до ' + item.request.duration + ' с' : '')));
    } else frame.append(el('div', 'media-loading', 'Загружаю готовый файл…'));
    return frame;
  }
  function buildNode(item) {
    const article = el('article', 'message ' + item.role + (item.status === 'error' || item.status === 'expired' ? ' error' : item.status === 'stopped' ? ' stopped' : ''));
    article.dataset.id = item.id; article.dataset.status = item.status;
    const content = el('div', 'message-content');
    if (item.role === 'user') {
      content.append(el('div', 'message-body', item.content)); article.append(content); return article;
    }
    const head = el('div', 'message-head');
    head.append(el('span', 'message-avatar', 'B'), el('span', 'message-model', meta(item.model).name), el('span', 'live-badge', 'Live'), el('time', 'message-time', timeLabel(item.createdAt)));
    article.append(head);
    if ((item.mode === 'chat' && !['queued', 'running'].includes(item.status)) || item.content) content.append(el('div', 'message-body', item.content));
    if (['queued', 'running', 'streaming'].includes(item.status) && item.mode !== 'chat') content.append(buildPending(item));
    if (['queued', 'running'].includes(item.status) && item.mode === 'chat' && !item.content) content.append(buildPending(item));
    if (item.status === 'ready' && item.mode !== 'chat') content.append(buildMedia(item));
    if (['error', 'stopped', 'expired'].includes(item.status)) {
      const kind = item.status === 'stopped' ? 'stopped' : 'error';
      const text = item.status === 'stopped' ? 'Остановлено. Часть работы и запрос сохранены.' : item.error || 'Не удалось завершить генерацию. Запрос сохранён — можно повторить.';
      content.append(el('div', 'inline-state ' + kind, text));
    }
    const details = detailsBlock(item); if (details && !['queued', 'running', 'streaming'].includes(item.status)) content.append(details);
    const actions = el('div', 'message-actions'); buildActions(item, actions); content.append(actions);
    article.append(content); return article;
  }
  function mount(item, rebuild = false) {
    if (!items.includes(item)) return;
    const old = nodes.get(item.id);
    const node = buildNode(item);
    if (old && rebuild) old.replaceWith(node);
    else if (!old) els.feed.append(node);
    else return;
    nodes.set(item.id, node);
    if (item.status === 'ready' && item.mode !== 'chat' && !mediaCache.has(item.id)) hydrateMedia(item);
  }
  function patch(item, changes, rebuild = true) {
    Object.assign(item, changes); save();
    if (rebuild) mount(item, true);
    renderConnection();
  }
  function updateStreaming(item) {
    const node = nodes.get(item.id);
    const body = node?.querySelector('.message-body');
    if (body) body.textContent = item.content;
    node?.querySelector('[data-pending]')?.remove();
    save();
  }
  function renderFeed() {
    nodes.clear(); mediaCache.forEach(media => URL.revokeObjectURL(media.url)); mediaCache.clear();
    els.feed.querySelectorAll('.message').forEach(node => node.remove());
    for (const item of items) mount(item);
    renderChrome(); scrollBottom(true);
  }
  function addExchange(config) {
    const user = safeItem({ id: uid('user'), role: 'user', mode: config.mode, content: config.prompt || config.lyrics, status: 'ready', createdAt: Date.now() });
    const assistant = safeItem({ id: uid('result'), role: 'assistant', mode: config.mode, model: config.model, content: '', status: 'queued', stage: config.mode === 'music' && isVocal(config.model) && !config.lyrics ? 'lyrics' : 'submit', createdAt: Date.now(), request: config });
    items.push(user, assistant); items = items.slice(-MAX_ITEMS);
    els.welcome.hidden = true; els.feed.classList.add('has-items');
    mount(user); mount(assistant); save(); renderConnection(); scrollBottom(true);
    return assistant;
  }

  // ---- Independent generation runs -----------------------------------------
  function normalizeConfig(config) {
    return {
      mode: config.mode || mode, model: config.model || modelId(), prompt: cleanText(config.prompt, 4000).trim(),
      lyrics: cleanText(config.lyrics, 8000).trim(), duration: Number(config.duration) || duration,
      assistantId: config.assistantId || assistantId
    };
  }
  function requireReady(config) {
    if (!bus.hasToken()) { showKey('Вставьте ключ — после подключения запрос можно отправить снова.'); return false; }
    if (catalogState === 'error') { notify('Нет связи со стендом. Проверьте туннель и нажмите на статус соединения, чтобы повторить.'); loadCatalog(true); return false; }
    if (catalogState === 'ready' && !isReady(config.model)) { notify(meta(config.model).name + ' сейчас недоступна. Выберите другую модель — запрос остался в поле.'); return false; }
    if (config.prompt.length > 4000) { notify('Сократите запрос до 4000 символов.'); return false; }
    return true;
  }
  function startChat(rawConfig) {
    const config = normalizeConfig(rawConfig);
    if (!requireReady(config)) return;
    const item = addExchange(config);
    const controller = new AbortController();
    activeRuns.set(item.id, { controller, kind: 'chat' });
    if (config.mode === mode && !advanced) { els.prompt.value = ''; autoSize(); updateEnabled(); save(); }
    renderConnection();
    const currentUser = requestFor(item);
    const historyItems = items.filter(candidate => candidate.mode === 'chat' && candidate.id !== item.id && candidate.id !== currentUser?.id &&
      (candidate.role === 'user' || candidate.role === 'assistant' && candidate.status === 'ready' && candidate.content));
    const history = historyItems.slice(-MAX_HISTORY_MESSAGES).map(candidate => ({ role: candidate.role, content: candidate.content }));
    let budget = MAX_HISTORY_CHARS;
    for (let i = 0; i < history.length; i++) { history[i].content = history[i].content.slice(0, budget); budget -= history[i].content.length; if (budget <= 0) { history.splice(0, i + 1); break; } }
    const assistant = ASSISTANTS.find(a => a.id === config.assistantId) || ASSISTANTS[0];
    const messages = [{ role: 'system', content: assistant.system }, ...history, { role: 'user', content: config.prompt }];
    bus.chat({
      messages, model: config.model, signal: controller.signal,
      onChunk: piece => {
        if (controller.signal.aborted) return;
        item.content += piece;
        if (item.status !== 'streaming') { item.status = 'streaming'; item.stage = ''; mount(item, true); }
        updateStreaming(item); scrollBottom(false);
      }
    }).then(result => {
      if (controller.signal.aborted) return;
      patch(item, { status: 'ready', stage: '', model: result.model || config.model, provenance: { model: result.model || config.model, wallMs: result.wallMs, streamed: result.streamed, fallbackReason: result.fallbackReason } });
      announce('Ответ модели готов');
    }).catch(error => handleRunError(item, error, controller)).finally(() => finishRun(item));
    return item;
  }
  function handleRunError(item, error, controller) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      patch(item, { status: 'stopped', stage: '', error: '' });
    } else {
      const message = error.code === 'unauthorized' ? 'Ключ отклонён стендом. Обновите подключение и повторите запрос.' : error.message || 'Сервер не завершил генерацию.';
      patch(item, { status: 'error', stage: '', error: message, provenance: { ...(item.provenance || {}), errorCode: error.code || 'error' } });
      if (error.code === 'unauthorized') showKey('Ключ отклонён стендом. Вставьте новый ключ.');
      announce('Генерация остановилась с ошибкой');
    }
  }
  function finishRun(item) {
    activeRuns.delete(item.id); save(); renderConnection(); updateEnabled();
    if (items.includes(item)) mount(item, true);
  }
  function abortableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
    });
  }
  async function pollMedia(item, run) {
    const { controller } = run;
    let networkFailures = 0;
    while (!controller.signal.aborted) {
      await abortableSleep(1600, controller.signal);
      let data;
      try { data = await bus.getJob(item.serverJobId, controller.signal); }
      catch (error) {
        if (controller.signal.aborted || !['network', 'unavailable'].includes(error.code) || ++networkFailures > 5) throw error;
        patch(item, { status: 'running', stage: 'reconnecting', error: '' });
        const small = nodes.get(item.id)?.querySelector('.pending-copy small');
        if (small) small.textContent = 'Связь прервалась — переподключаюсь, задача на сервере сохранена';
        await abortableSleep(1800, controller.signal);
        continue;
      }
      networkFailures = 0;
      if (controller.signal.aborted) return;
      item.provenance = data.provenance || item.provenance;
      if (data.status === 'ready') {
        if (!data.result_url) throw new bus.BusError('bad_response', 'Сервер завершил задачу, но не отдал файл.');
        patch(item, { status: 'ready', stage: '', resultUrl: data.result_url, mime: data.mime || null, provenance: data.provenance || item.provenance });
        await hydrateMedia(item, controller.signal);
        announce(item.mode === 'photo' ? 'Изображение готово' : 'Трек готов'); return;
      }
      if (['error', 'failed', 'cancelled', 'expired'].includes(data.status)) {
        throw new bus.BusError(data.status, data.error?.message || (data.status === 'cancelled' ? 'Задача отменена на сервере.' : 'Сервер не завершил задачу.'));
      }
      patch(item, { status: data.status === 'queued' ? 'queued' : 'running', stage: data.stage || data.status || 'generating', provenance: data.provenance || item.provenance });
    }
  }
  async function runMedia(item, run) {
    const { controller } = run;
    const config = item.request;
    try {
      if (item.mode === 'music' && isVocal(config.model) && !config.lyrics) {
        patch(item, { stage: 'lyrics', status: 'running' });
        let generatedLyrics = '';
        await bus.chat({
          model: 'qwen3:4b-instruct', signal: controller.signal,
          onChunk: piece => { generatedLyrics += piece; },
          messages: [
            { role: 'system', content: 'Ты — автор песен студии BRIIX. Напиши цельную песню по теме пользователя на русском языке, 12–24 строки. Используй [verse], [chorus], при необходимости [bridge] и [outro]. Сохрани смысл и настроение темы. Верни только лирику без пояснений.' },
            { role: 'user', content: config.prompt }
          ]
        });
        config.lyrics = cleanText(generatedLyrics, 8000).trim();
      }
      if (!item.serverJobId) {
        if (item.mode === 'music' && isVocal(config.model) && !config.lyrics) throw new bus.BusError('lyrics_empty', 'Не удалось получить лирику. Добавьте её вручную или повторите запрос.');
        patch(item, { stage: 'submit', status: 'running', request: config });
        const params = item.mode === 'music' && isVocal(config.model)
          ? { model: config.model, lyrics: config.lyrics, language: /[а-яё]/i.test(config.lyrics) ? 'ru' : 'en', duration: config.duration }
          : {};
        const id = await bus.submitJob({ type: item.mode === 'photo' ? 'image' : 'music', prompt: config.prompt || config.lyrics, params, idempotencyKey: item.id, signal: controller.signal });
        item.serverJobId = id; run.serverJobId = id;
        patch(item, { stage: 'queued', status: 'queued' });
        if (controller.signal.aborted) { bus.cancelJob(id).catch(() => {}); return; }
      }
      await pollMedia(item, run);
    } catch (error) { handleRunError(item, error, controller); }
    finally { finishRun(item); }
  }
  function scheduleMedia(item, run) {
    // Only submission/preflight is serialized. Long server jobs all poll independently.
    musicQueue = musicQueue.catch(() => {}).then(() => {
      if (run.controller.signal.aborted) { finishRun(item); return; }
      return runMedia(item, run);
    });
  }
  function startMedia(rawConfig) {
    const config = normalizeConfig(rawConfig);
    if (!requireReady(config)) return;
    const queuedBehind = [...activeRuns.values()].some(run => run.kind === 'media');
    const item = addExchange(config);
    if (queuedBehind) { item.stage = 'local-queue'; mount(item, true); save(); }
    const run = { controller: new AbortController(), kind: 'media', serverJobId: null };
    activeRuns.set(item.id, run);
    if (config.mode === mode) {
      if (advanced) els.musicPrompt.value = ''; else els.prompt.value = '';
      autoSize(); updateEnabled(); save();
    }
    renderConnection(); scheduleMedia(item, run); return item;
  }
  function hydrateMedia(item, signal) {
    if (!item.resultUrl || mediaCache.has(item.id)) return Promise.resolve();
    if (mediaLoads.has(item.id)) return mediaLoads.get(item.id);
    const promise = (async () => {
      try {
        const blob = await bus.fileBlob(item.resultUrl, signal);
        if (signal?.aborted) return;
        const extension = blob.type.includes('png') ? 'png' : blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('wav') ? 'wav' : blob.type.includes('mpeg') ? 'mp3' : 'm4a';
        const url = URL.createObjectURL(blob);
        mediaCache.set(item.id, { url, blob, name: 'briix-' + item.mode + '-' + item.id.slice(-8) + '.' + extension });
        mount(item, true);
      } catch (error) {
        if (error?.name === 'AbortError') return;
        patch(item, { status: error.code === 'gone' ? 'expired' : 'error', error: error.message || 'Не удалось скачать готовый файл.' });
      }
    })().finally(() => mediaLoads.delete(item.id));
    mediaLoads.set(item.id, promise);
    return promise;
  }
  function create() {
    const text = promptValue();
    if (!text && !(mode === 'music' && advanced && els.lyrics.value.trim())) return;
    if (mode === 'chat') startChat({ mode, model: modelId(), prompt: text, assistantId });
    else if (mode === 'photo') startMedia({ mode, model: modelId(), prompt: text });
    else startMedia({ mode, model: modelId(), prompt: text, lyrics: advanced ? els.lyrics.value.trim() : '', duration });
  }

  // ---- Lyrics/prompt improvement ------------------------------------------
  let baseCache = null;
  async function creativeBase() {
    if (baseCache) return baseCache;
    const response = await fetch('/assets/data/creative-base.json');
    if (!response.ok) throw new bus.BusError('base_unavailable', 'База стилей недоступна.');
    baseCache = await response.json(); return baseCache;
  }
  function pickRandom(pool, count) {
    const copy = pool.slice(); const out = [];
    while (copy.length && out.length < count) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }
  async function improve(field) {
    if (activeRuns.has('improve')) return;
    if (!bus.hasToken()) { showKey('Для улучшения текста подключите стенд.'); return; }
    const input = field === 'lyrics' ? els.lyrics : els.musicPrompt;
    const original = input.value; if (!original.trim()) return;
    const controller = new AbortController(); activeRuns.set('improve', { controller, kind: 'improve' }); updateEnabled();
    try {
      const base = await creativeBase();
      const pool = field === 'lyrics' ? base.lyrics || [] : base.prompts || [];
      const examples = pickRandom(pool, 5).map(example => '<example source="' + (example.source || '') + '">\n' + example.text + '\n</example>').join('\n\n');
      const system = 'Ты редактор музыкальной студии BRIIX. Улучши ' + (field === 'lyrics' ? 'лирику' : 'музыкальный промпт') + ', сохрани замысел и язык пользователя. Опирайся на примеры стиля владельца. Верни только улучшенный текст без пояснений.\n\n' + examples;
      const result = await bus.chatNonStream({ model: 'qwen3:4b-instruct', messages: [{ role: 'system', content: system }, { role: 'user', content: original }], maxTokens: 600, signal: controller.signal });
      undoBackup[field] = original; input.value = result.text.trim();
      (field === 'lyrics' ? els.undoLyrics : els.undoPrompt).hidden = false; save();
    } catch (error) { notify(error.message || 'Не удалось улучшить текст.'); }
    finally { activeRuns.delete('improve'); updateEnabled(); }
  }

  // ---- Events ---------------------------------------------------------------
  els.modes.addEventListener('click', event => { const button = event.target.closest('.mode'); if (button) setMode(button.dataset.mode); });
  els.vocalChip.addEventListener('click', () => {
    selectedByMode.music = modelId() === 'musicgen-small' ? 'ace-step-flash' : 'musicgen-small';
    renderChrome(); save();
  });
  els.tuneToggle.addEventListener('click', () => { advanced = !advanced; renderChrome(); save(); });
  els.send.addEventListener('click', create);
  [els.prompt, els.lyrics, els.musicPrompt].forEach(input => input.addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(save, 150); updateEnabled(); autoSize(); }));
  els.prompt.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); create(); }
  });
  els.musicPrompt.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); create(); } });
  els.improveLyrics.addEventListener('click', () => improve('lyrics'));
  els.improvePrompt.addEventListener('click', () => improve('prompt'));
  els.undoLyrics.addEventListener('click', () => { if (undoBackup.lyrics != null) { els.lyrics.value = undoBackup.lyrics; undoBackup.lyrics = null; els.undoLyrics.hidden = true; save(); } });
  els.undoPrompt.addEventListener('click', () => { if (undoBackup.musicPrompt != null) { els.musicPrompt.value = undoBackup.musicPrompt; undoBackup.musicPrompt = null; els.undoPrompt.hidden = true; save(); } });
  els.tags.addEventListener('click', event => {
    const button = event.target.closest('.tag'); if (!button) return;
    const at = els.lyrics.selectionStart ?? els.lyrics.value.length;
    els.lyrics.value = els.lyrics.value.slice(0, at) + (at && els.lyrics.value[at - 1] !== '\n' ? '\n' : '') + button.dataset.tag + '\n' + els.lyrics.value.slice(els.lyrics.selectionEnd ?? at);
    els.lyrics.focus(); save();
  });
  els.connectionButton.addEventListener('click', () => {
    if (els.keyCard.hidden) showKey(); else hideKey();
    if (bus.hasToken() && catalogState !== 'ready') loadCatalog(true);
  });
  els.keyClose.addEventListener('click', hideKey);
  els.keySave.addEventListener('click', async () => {
    if (!els.keyInput.value.trim()) { showKey('Вставьте ключ стенда.'); return; }
    bus.setToken(els.keyInput.value); els.keyInput.value = ''; els.keyStatus.classList.remove('error'); els.keyStatus.textContent = 'Проверяем каталог моделей…';
    const ok = await loadCatalog(true);
    if (ok) { hideKey(); announce('Стенд подключён'); }
    else showKey('Стенд пока недоступен. Проверьте ключ или туннель.');
  });
  els.keyInput.addEventListener('keydown', event => { if (event.key === 'Enter') els.keySave.click(); });
  els.noticeClose.addEventListener('click', () => { els.notice.hidden = true; });
  els.clearFeed.addEventListener('click', () => els.clearDialog.showModal());
  els.clearCancel.addEventListener('click', () => els.clearDialog.close());
  els.clearConfirm.addEventListener('click', () => {
    activeRuns.forEach(run => { run.stopped = true; run.controller.abort(); if (run.serverJobId) bus.cancelJob(run.serverJobId).catch(() => {}); });
    activeRuns.clear(); items = []; save(); els.clearDialog.close(); renderFeed(); flushSave();
  });
  window.addEventListener('pagehide', () => {
    flushSave();
    // Do not abort server jobs on navigation: persistence + serverJobId resumes polling.
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) items.filter(item => ['queued', 'running'].includes(item.status) && item.mode !== 'chat' && item.serverJobId && !activeRuns.has(item.id)).forEach(item => resumeMedia(item)); });
  function resumeMedia(item) {
    if (activeRuns.has(item.id)) return;
    const run = { controller: new AbortController(), kind: 'media', serverJobId: item.serverJobId };
    activeRuns.set(item.id, run); scheduleMedia(item, run);
  }

  // Restore text and server-backed artefacts without storing blobs or tokens in the feed.
  load(); renderFeed(); loadCatalog(true);
  for (const item of items) {
    if (item.mode === 'chat' && ['queued', 'running', 'streaming'].includes(item.status)) {
      item.status = 'stopped'; item.error = 'Страница перезагрузилась до завершения ответа. Запрос можно повторить.'; mount(item, true);
    } else if (item.mode !== 'chat' && ['queued', 'running'].includes(item.status) && item.serverJobId) resumeMedia(item);
    else if (item.mode !== 'chat' && ['queued', 'running'].includes(item.status)) {
      item.status = 'stopped'; mount(item, true);
    }
  }
  elapsedTimer = setInterval(() => {
    for (const item of items) {
      if (!['queued', 'running', 'streaming'].includes(item.status)) continue;
      const small = nodes.get(item.id)?.querySelector('.pending-copy small');
      if (small) small.textContent = 'Можно писать дальше и выбрать другую модель · ' + elapsed(item);
    }
  }, 1000);
})();
