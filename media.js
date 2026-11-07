/* BRIIX Media Studio — isolated, deterministic local mock.
 * No provider requests, API keys, credits, file-content reads or model inference.
 * The host supplies only UI helpers. Media state has its own storage key and schema.
 * Storage v2: v1 + optional mode/serverJobId/resultUrl/provenance (v1 upgrades in place,
 * no data loss). The optional "Приватный live" mode is implemented in media-live.js;
 * without it this file stays a pure local mock.
 */
(() => {
  'use strict';
  const STORAGE_KEY = 'briix-media-v1';
  const MAX_JOBS = 40;
  const MAX_ACTIVE = 6;
  const MAX_PROMPT = 1500;
  const LIVE_STATUSES = ['queued', 'running', 'ready', 'error', 'cancelled', 'interrupted', 'expired'];
  const LIVE_TYPES = ['image', 'music', 'text'];
  const ASSETS = {
    ceramic: { name: 'Тихая керамика', image: 'assets/media/ceramic-still.jpg', video: 'assets/media/ceramic-still', alt: 'Шалфейная керамическая чашка и светлая ваза на камне в мягком боковом свете', tag: 'Предметная съёмка' },
    coffee: { name: 'Утро в кофейне', image: 'assets/media/coffee-story.jpg', video: 'assets/media/coffee-story', alt: 'Чашка капучино на деревянной стойке кофейни в утреннем свете', tag: 'Атмосфера бренда' },
    skincare: { name: 'Чистый свет', image: 'assets/media/skincare-light.jpg', video: 'assets/media/skincare-light', alt: 'Стеклянный флакон и баночка крема на светлом камне с тенями листьев', tag: 'Beauty и уход' }
  };
  const RECIPES = [
    { id: 'product-photo', type: 'image', title: 'Продукт в свете', subtitle: 'Карточка товара или обложка поста', asset: 'ceramic', icon: 'image', goal: 'product', prompt: 'Предметный кадр керамической чашки на натуральном камне. Мягкий боковой свет, спокойная палитра, свободное место для заголовка. Сохранить форму и фактуру продукта.', negative: 'Искажённая форма, лишние предметы, нечитаемый текст, пластиковая фактура.', steps: ['Зафиксировать продукт и пропорции', 'Выбрать свет и свободную область', 'Собрать серию в одном формате'] },
    { id: 'brand-photo', type: 'image', title: 'Атмосфера бренда', subtitle: 'Визуальная история для ленты', asset: 'coffee', icon: 'sparkles', goal: 'social', prompt: 'Утренний капучино в небольшой кофейне. Тёплая деревянная стойка, мягкий свет из окна, живая текстура молочной пены. Настроение спокойного начала дня, без людей и логотипов.', negative: 'Стоковая улыбка, лишние пальцы, водяные знаки, чрезмерная насыщенность.', steps: ['Определить настроение истории', 'Оставить место под типографику', 'Проверить кроп для ленты'] },
    { id: 'beauty-photo', type: 'image', title: 'Чистая композиция', subtitle: 'Hero-изображение для лендинга', asset: 'skincare', icon: 'columns', goal: 'hero', prompt: 'Минималистичная композиция ухода: матовое стекло, светлый камень, мягкие тени листьев. Много воздуха, натуральная фактура, аккуратные отражения. Упаковка без надписей.', negative: 'Выдуманные надписи, лишняя упаковка, жёсткие блики, медицинский контекст.', steps: ['Выбрать главный объект', 'Проверить негативное пространство', 'Подготовить широкую и квадратную версии'] },
    { id: 'product-video', type: 'video', title: 'Медленное знакомство', subtitle: 'Пятисекундный продуктовый тизер', asset: 'ceramic', icon: 'play', goal: 'social', prompt: 'Один непрерывный план: медленное приближение к керамической чашке. Камера движется плавно, объект и фон неподвижны, свет постоянный. Без склеек, текста и звука.', negative: 'Дрожание, деформация предмета, резкая смена света, внезапные объекты.', steps: ['Начать с утверждённого кадра', 'Задать одно движение камеры', 'Проверить первый и последний кадры'] },
    { id: 'story-video', type: 'video', title: 'История в движении', subtitle: 'Вертикальный фон для Reels / Stories', asset: 'coffee', icon: 'megaphone', goal: 'social', prompt: 'Вертикальный атмосферный план кофейни. Очень медленный дрейф камеры, постоянный мягкий свет, чашка остаётся в фокусе. Оставить спокойную область для субтитров. Без звука.', negative: 'Быстрый зум, скачки экспозиции, новые предметы, сгенерированные субтитры.', steps: ['Выбрать вертикальный исходник', 'Ограничить движение камеры', 'Добавить текст монтажным слоем'] }
  ];
  const MODELS = [
    { id: 'flux', name: 'FLUX.2', maker: 'Black Forest Labs', kind: 'image', access: 'API / открытые веса', use: 'Продуктовые кадры, референсы, редактирование', note: 'Klein 4B — Apache 2.0; Klein 9B — некоммерческая лицензия. Pro — hosted API.', url: 'https://docs.bfl.ai/flux_2/flux2_overview' },
    { id: 'gemini-image', name: 'Nano Banana', maker: 'Google', kind: 'image', access: 'Gemini API', use: 'Диалоговое редактирование, текст, бренд-консистентность', note: 'Семейство включает 2.1, 2 Lite, 2 и Pro. Free Tier для перечисленных image-моделей недоступен.', url: 'https://ai.google.dev/gemini-api/docs/image-generation' },
    { id: 'gpt-image', name: 'GPT Image 2.5 Flare', maker: 'OpenAI', kind: 'image', access: 'Images API', use: 'Генерация и редактирование по тексту и изображению', note: 'Документированный ID: gpt-image-2.5-flare. Стоимость зависит от токенов и качества.', url: 'https://developers.openai.com/api/docs/models/gpt-image-2.5-flare' },
    { id: 'uni', name: 'uni-1 / uni-1-max', maker: 'Luma Agents', kind: 'image', access: 'REST API', use: 'Изображения, референсы, редактирование', note: 'Новый Agents API; не путать с прежними Photon / Ray2 в старых docs.lumalabs.ai.', url: 'https://docs.agents.lumalabs.ai/' },
    { id: 'veo', name: 'Veo 3.1', maker: 'Google', kind: 'video', access: 'Gemini API', use: 'Кинематографичные планы, image-to-video, звук', note: 'Асинхронная операция. Скачивайте результат: документированное хранение — 2 дня.', url: 'https://ai.google.dev/gemini-api/docs/veo' },
    { id: 'runway', name: 'Runway API', maker: 'Runway', kind: 'video', access: 'API / model router', use: 'Единый доступ к видео-моделям и маркетинговым recipes', note: 'В документации есть Gen-4.5, Kling, Seedance, Wan и другие. Тариф зависит от выбранной модели.', url: 'https://docs.dev.runwayml.com/guides/pricing/' },
    { id: 'ray', name: 'Ray 3.2', maker: 'Luma Agents', kind: 'video', access: 'REST API', use: 'Text/image-to-video, редактирование, reframe', note: 'Draft 360p позволяет дешевле проверять движение. HDR и video edit тарифицируются отдельно.', url: 'https://docs.agents.lumalabs.ai/guides/pricing/' },
    { id: 'wan', name: 'Wan 2.2', maker: 'Wan-Video', kind: 'video', access: 'Открытые веса / провайдеры', use: 'Локальные эксперименты и собственный pipeline', note: 'Apache 2.0 у репозитория; проверяйте карточку конкретных весов и требования к GPU.', url: 'https://github.com/Wan-Video/Wan2.2' },
    { id: 'ltx', name: 'LTX-2', maker: 'Lightricks', kind: 'video', access: 'Открытый pipeline / API', use: 'Локальный видеопайплайн и исследовательские прототипы', note: 'Лицензию кода и лицензию весов проверяют отдельно; открытость не означает нулевую стоимость.', url: 'https://github.com/Lightricks/LTX-2' }
  ];
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  let host = null;
  let root = null;
  let tab = 'create';
  let libraryType = 'all';
  let libraryQuery = '';
  let modelType = 'all';
  let timer = null;
  let storageOkay = true;
  let storageProtected = false;
  let references = [];
  let form = { type: 'image', recipe: 'product-photo', asset: 'ceramic', goal: 'product', ratio: '1:1', project: '', prompt: RECIPES[0].prompt, failNext: false };
  let detailId = null;
  const uid = () => 'media-' + (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const recipe = id => RECIPES.find(r => r.id === id) || RECIPES[0];
  const asset = id => ASSETS[id] || ASSETS.ceramic;
  const job = id => state.jobs.find(j => j.id === id);
  const esc = value => host.esc(value);
  const icon = name => host.icon(name);
  const activeCount = () => state.jobs.filter(j => ['queued', 'running'].includes(j.status)).length;
  const readyJobs = () => state.jobs.filter(j => j.status === 'ready');
  const liveActive = () => !!(window.BRIIX_MEDIA_LIVE && window.BRIIX_MEDIA_LIVE.active());
  const originLabel = () => liveActive() ? 'Приватный live' : 'Локальный мок';
  const typeBadge = j => j.mode === 'live'
    ? ({ image: 'Фото', music: 'Музыка', text: 'Текст' })[j.type] + ' · live'
    : (j.type === 'video' ? 'Видео · 5 с' : 'Фото') + ' · мок';
  const liveDisplayUrl = j => (j.mode === 'live' && window.BRIIX_MEDIA_LIVE) ? window.BRIIX_MEDIA_LIVE.displayUrl(j) : null;
  function fresh() { return { version: 2, jobs: [] }; }
  function validateLiveJob(j, ids) {
    if (!j || typeof j.id !== 'string' || !/^[\w-]{1,100}$/.test(j.id) || ids.has(j.id) || !LIVE_TYPES.includes(j.type) || typeof j.prompt !== 'string' || !LIVE_STATUSES.includes(j.status)) throw new Error('Повреждена live-задача медиа-студии.');
    ids.add(j.id);
    const http = v => typeof v === 'string' && /^https?:\/\//.test(v) && v.length <= 500 ? v : null;
    return {
      id: j.id, type: j.type, mode: 'live', recipe: null, asset: null,
      goal: 'social', ratio: j.type === 'image' && ['1:1', '4:5', '16:9', '9:16'].includes(j.ratio) ? j.ratio : '1:1',
      project: typeof j.project === 'string' ? j.project.slice(0, 80) : '', prompt: j.prompt.slice(0, MAX_PROMPT),
      status: j.status, progress: 0, favorite: !!j.favorite,
      createdAt: Number.isFinite(j.createdAt) && j.createdAt > 0 && j.createdAt <= 8640000000000000 ? j.createdAt : Date.now(),
      startedAt: null, fail: false, references: [],
      serverJobId: typeof j.serverJobId === 'string' && /^[\w-]{1,100}$/.test(j.serverJobId) ? j.serverJobId : null,
      resultUrl: http(j.resultUrl),
      provenance: j.provenance && typeof j.provenance === 'object' ? {
        model: typeof j.provenance.model === 'string' ? j.provenance.model.slice(0, 120) : null,
        params: j.provenance.params && typeof j.provenance.params === 'object' && !Array.isArray(j.provenance.params) ? j.provenance.params : null,
        wall_clock_ms: Number.isFinite(j.provenance.wall_clock_ms) ? j.provenance.wall_clock_ms : null,
        queued_ms: Number.isFinite(j.provenance.queued_ms) ? j.provenance.queued_ms : null
      } : null
    };
  }
  function validate(raw) {
    // v1 upgrades to v2 in place without data loss; v2 accepted as-is.
    if (!raw || (raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.jobs) || raw.jobs.length > MAX_JOBS) throw new Error('Неверный формат медиа-хранилища.');
    const ids = new Set();
    return { version: 2, jobs: raw.jobs.map(j => {
      if (j && j.mode === 'live') return validateLiveJob(j, ids);
      if (!j || typeof j.id !== 'string' || !/^[\w-]{1,100}$/.test(j.id) || ids.has(j.id) || !['image', 'video'].includes(j.type) || !Object.hasOwn(ASSETS, j.asset) || !RECIPES.some(r => r.id === j.recipe && r.type === j.type) || typeof j.prompt !== 'string' || typeof j.project !== 'string' || !['queued', 'running', 'ready', 'error', 'cancelled'].includes(j.status)) throw new Error('Повреждена задача медиа-студии.');
      ids.add(j.id);
      const ratios = j.type === 'image' ? ['1:1', '4:5', '16:9', '9:16'] : ['16:9', '9:16'];
      return { id: j.id, type: j.type, recipe: j.recipe, asset: j.asset, goal: ['product', 'social', 'hero'].includes(j.goal) ? j.goal : 'social', ratio: ratios.includes(j.ratio) ? j.ratio : ratios[0], project: j.project.slice(0, 80), prompt: j.prompt.slice(0, MAX_PROMPT), status: ['queued', 'running'].includes(j.status) ? 'queued' : j.status, progress: j.status === 'ready' ? 100 : 0, favorite: !!j.favorite, createdAt: Number.isFinite(j.createdAt) && j.createdAt > 0 && j.createdAt <= 8640000000000000 ? j.createdAt : Date.now(), startedAt: null, fail: false, references: Array.isArray(j.references) ? j.references.slice(0, 3).filter(f => f && typeof f.name === 'string').map(f => ({ name: f.name.slice(0, 180), size: Number.isFinite(f.size) ? Math.max(0, Math.min(f.size, 10485760)) : 0 })) : [] };
    }) };
  }
  function load() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? validate(JSON.parse(raw)) : fresh(); }
    catch { storageProtected = true; return fresh(); }
  }
  let state = load();
  // One-time storage upgrade: a freshly loaded v1 payload is rewritten as v2
  // (same jobs, no loss) so the migration is durable across reloads.
  try { const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); if (raw && raw.version === 1) persist(); } catch {}
  function persist() {
    if (!storageOkay || storageProtected) return false;
    try {
      const jobs = state.jobs.map(j => {
        const base = { ...j, startedAt: null, progress: j.status === 'ready' ? 100 : 0 };
        if (j.mode === 'live') return { ...base, resultUrl: j.resultUrl || null }; // live: no blob/base64 ever persisted
        return { ...base, status: j.status === 'running' ? 'queued' : j.status };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, jobs }));
      return true;
    }
    catch { storageOkay = false; updateNotice(); host?.toast('Медиатека работает в памяти. Скачайте нужные результаты до закрытия страницы.', 'error'); return false; }
  }
  function updateNotice() {
    const el = $('#media-storage-notice', root || document); if (!el) return;
    el.hidden = storageOkay && !storageProtected;
    el.textContent = storageProtected ? 'Сохранённая медиатека повреждена. Исходные данные не перезаписаны; новые результаты доступны только в этой вкладке.' : 'Хранилище недоступно или заполнено. Результаты доступны до закрытия страницы; скачайте нужные файлы.';
  }
  function output(j, preview = false) {
    const live = liveDisplayUrl(j);
    if (live) return live;
    if (j.type === 'image') return asset(j.asset).image;
    return preview ? asset(j.asset).image : asset(j.asset).video + '-' + (j.ratio === '9:16' ? 'portrait' : 'landscape') + '.mp4';
  }
  function date(value) { return new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function statusLabel(j) {
    if (j.mode === 'live') return ({ queued: 'В очереди (сервер)', running: 'Генерация на сервере', ready: 'Готово', error: 'Ошибка сервера', cancelled: 'Остановлено', interrupted: 'Прервано: сервер недоступен', expired: 'Результат истёк' })[j.status];
    return ({ queued: 'В очереди', running: j.type === 'image' ? 'Собираем макет' : 'Подготавливаем видео', ready: 'Готово', error: 'Демо-ошибка', cancelled: 'Остановлено' })[j.status];
  }
  function heading() {

    return `<div class="page-header media-heading"><div><div class="eyebrow">Визуальная мастерская</div><h1>Изображения</h1><p>От идеи до визуального черновика: фото и видео. Спокойно, наглядно, в одном месте.</p></div><button class="btn media-help" data-media-action="help">${icon('help')}<span>Как это работает</span></button></span> <button class="btn ${liveActive() ? 'primary' : ''} media-live-toggle" data-media-action="live" aria-pressed="${liveActive()}">${icon('terminal')}${liveActive() ? '<span>Live включён</span>' : '<span>Приватный live (эксперимент)</span>'}</button></div>
      <div class="media-mode-note">${icon('flask')}<span><strong>Локальный мок, не нейросеть.</strong> Фото выбраны из готовой коллекции; видео — плавная анимация кадра. Бриф сохраняется, но не управляет пикселями. Без API, кредитов и загрузки файлов.</span></div>
      <div id="media-storage-notice" class="storage-banner" role="status" hidden></div>
      <div id="media-live-banner" class="storage-banner" role="status" hidden></div>
      <div class="media-tabs" role="tablist" aria-label="Разделы мастерской изображений">${[['create', 'Создание', 'sparkles'], ['library', 'Медиатека', 'image'], ['queue', 'Очередь', 'clock'], ['models', 'Модели и рецепты', 'route']].map(([id, label, ic]) => `<button id="media-tab-${id}" role="tab" aria-selected="${tab === id}" aria-controls="media-panel" tabindex="${tab === id ? 0 : -1}" class="media-tab ${tab === id ? 'active' : ''}" data-media-action="tab" data-id="${id}">${icon(ic)}<span>${label}</span>${id === 'library' ? `<span class="media-count" id="media-library-count">${readyJobs().length}</span>` : id === 'queue' ? `<span class="media-count" id="media-queue-count">${activeCount()}</span>` : ''}</button>`).join('')}</div><section id="media-panel" role="tabpanel" aria-labelledby="media-tab-${tab}" tabindex="0"></section>`;

  }
  function render() {
    if (!root || !host) return;
    $$('video', root).forEach(v => v.pause());
    root.innerHTML = `<div class="page media-page">${heading()}<div id="media-panel-content"></div></div>`;
    renderPanel(); updateNotice(); updateCounts();
  }
  function renderPanel() {
    $$('video', root).forEach(v => v.pause());
    const focused = document.activeElement;
    const focusKey = focused?.closest('#media-panel [data-media-action]') ? { action: focused.dataset.mediaAction, id: focused.dataset.id } : focused?.id ? { id: focused.id } : null;
    const panel = $('#media-panel', root); if (!panel) return;
    panel.setAttribute('aria-labelledby', 'media-tab-' + tab);
    $$('.media-tab', root).forEach(b => { const on = b.dataset.id === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $('#media-panel-content', root).innerHTML = tab === 'create' ? createMarkup() : tab === 'library' ? libraryMarkup() : tab === 'queue' ? queueMarkup() : modelsMarkup();
    $$('video', root).forEach(v => v.load());
    if (focusKey) { const target = focusKey.action ? $$('#media-panel [data-media-action]', root).find(b => b.dataset.mediaAction === focusKey.action && b.dataset.id === focusKey.id) : document.getElementById(focusKey.id); target?.focus({ preventScroll: true }); }
  }
  function createMarkup() {
    const latest = readyJobs()[0];
    return `<div class="media-create-layout"><form id="media-brief-form" class="media-brief" novalidate>
      <div class="media-section-title"><span class="eyebrow">01 / Бриф</span><span class="badge">Сохраняется локально</span></div>
      <div class="media-type-switch" role="group" aria-label="Тип медиа"><button type="button" aria-pressed="${form.type === 'image'}" class="${form.type === 'image' ? 'active' : ''}" data-media-action="type" data-id="image">${icon('image')}Фото</button><button type="button" aria-pressed="${form.type === 'video'}" class="${form.type === 'video' ? 'active' : ''}" data-media-action="type" data-id="video">${icon('play')}Видео</button></div>
      <label class="media-field">Задача<select id="media-goal" name="goal">${[['product', 'Карточка продукта'], ['social', 'Пост / Reels / Stories'], ['hero', 'Обложка / hero-баннер']].map(([id, name]) => `<option value="${id}" ${form.goal === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
      <label class="media-field">Название проекта <span class="muted">· необязательно</span><input id="media-project" name="project" maxlength="80" value="${esc(form.project)}" placeholder="Например, осенняя коллекция" autocomplete="off"></label>
      <label class="media-field" for="media-prompt">Опишите задумку</label><textarea id="media-prompt" class="media-prompt" name="prompt" rows="5" maxlength="${MAX_PROMPT}" aria-describedby="media-prompt-hint media-form-error" placeholder="Что в кадре, какой свет, какое настроение?">${esc(form.prompt)}</textarea><div class="media-field-hint" id="media-prompt-hint"><span>Текст для следующего подключения модели</span><span id="media-prompt-count">${form.prompt.length} / ${MAX_PROMPT}</span></div>
      <div class="media-field"><span id="media-ratio-label">Формат кадра</span><div class="media-ratios" role="group" aria-labelledby="media-ratio-label">${(form.type === 'image' ? ['1:1', '4:5', '16:9', '9:16'] : ['16:9', '9:16']).map(r => `<button type="button" class="${form.ratio === r ? 'active' : ''}" aria-pressed="${form.ratio === r}" data-media-action="ratio" data-id="${r}"><span class="media-ratio-shape" style="--ratio:${r.replace(':', '/')}"></span>${r}</button>`).join('')}</div></div>
      <label class="media-field">Референс<select id="media-asset">${Object.entries(ASSETS).map(([id, a]) => `<option value="${id}" ${form.asset === id ? 'selected' : ''}>${a.name}</option>`).join('')}</select></label>
      <div class="media-reference-note">${icon('info')}<span>Видео в демо: 5 секунд, без звука. Выбранный референс задаёт готовый локальный исходник.</span></div>
      <details class="media-extra"><summary>Референсы с устройства <span>необязательно</span></summary><p>Как и в диалогах, сохраняются только имя и размер. Содержимое не читается и не влияет на мок.</p><button type="button" class="btn" data-media-action="reference">${icon('paperclip')}Выбрать изображения</button><input type="file" id="media-reference-input" accept="image/png,image/jpeg,image/webp" multiple hidden><div id="media-reference-list" class="media-reference-list">${referenceMarkup()}</div></details>
      <label class="media-error-test"><input type="checkbox" id="media-fail" ${form.failNext ? 'checked' : ''}><span>Проверить ошибку на следующей задаче</span></label>
      <p id="media-form-error" class="media-form-error" role="alert" hidden></p><button type="submit" class="btn primary media-generate" id="media-generate" ${activeCount() >= MAX_ACTIVE ? 'disabled' : ''}>${icon('sparkles')}<span>${form.type === 'image' ? 'Создать фото-мок' : 'Создать видео-мок'}</span>${icon('arrowRight')}</button><div class="media-safe-note">${icon('lock')}Без регистрации и расходов · до 6 задач в очереди</div>
    </form><div class="media-workspace"><div class="media-section-title"><span class="eyebrow">02 / Визуальное направление</span><span class="media-local-label"><span></span>${originLabel()}</span></div>
      <div class="media-recipes" role="group" aria-label="Готовые рецепты">${RECIPES.filter(r => r.type === form.type).map(r => `<button class="media-recipe ${form.recipe === r.id ? 'active' : ''}" aria-pressed="${form.recipe === r.id}" data-media-action="recipe" data-id="${r.id}"><img src="${asset(r.asset).image}" alt="" loading="lazy" width="160" height="110"><span class="media-recipe-copy"><strong>${r.title}</strong><small>${r.subtitle}</small></span><span class="media-recipe-check">${icon('check')}</span></button>`).join('')}</div>
      <div id="media-preview" class="media-preview">${previewMarkup(latest)}</div><div id="media-inline-queue" class="media-inline-queue">${inlineQueueMarkup()}</div>
      <div class="media-principle">${icon('shield')}<div><strong>Сначала смысл. Потом генерация.</strong><p>Хороший бриф фиксирует продукт, свет, композицию и ограничения. Реальные модели подключаются позже — через сервер, не через ключ в браузере.</p></div></div>
    </div></div>`;
  }
  function referenceMarkup() { return references.map((f, i) => `<div class="media-reference-chip">${icon('image')}<span>${esc(f.name)}</span><button type="button" class="icon-btn small" data-media-action="remove-reference" data-index="${i}" aria-label="Убрать ${esc(f.name)}">${icon('close')}</button></div>`).join(''); }
  function previewMarkup(j) {
    const a = asset(j?.asset || form.asset);
    return `<div class="media-preview-head"><span>${j ? esc(j.project || (j.mode === 'live' ? 'Приватный live' : recipe(j.recipe).title)) : 'Ваш следующий визуальный черновик'}</span><span class="badge">${j ? (j.mode === 'live' ? 'Готово · live' : 'Готовый мок') : 'Предпросмотр коллекции'}</span></div><div class="media-preview-frame ${j?.type === 'video' || (!j && form.type === 'video') ? 'is-video' : ''}" style="--preview-ratio:${(j?.ratio || form.ratio).replace(':', '/')};--preview-factor:${Number((j?.ratio || form.ratio).split(':')[0]) / Number((j?.ratio || form.ratio).split(':')[1])}">${j?.type === 'video' ? `<video controls playsinline preload="metadata" poster="${a.image}" aria-label="Локальное демо-видео: ${esc(a.name)}"><source src="${output(j)}" type="video/mp4"><source src="${output(j).replace('.mp4', '.webm')}" type="video/webm"></video>` : `<img src="${j ? output(j) : a.image}" alt="${esc(a.alt)}">`}<span class="media-image-label">${icon('flask')}${originLabel()}</span></div><div class="media-preview-caption"><div><strong>${j ? (j.mode === 'live' ? `Live-результат · ${({ image: 'фото', music: 'аудио', text: 'текст' })[j.type]}` : j.type === 'video' ? 'Видео-мок · 5 сек · без звука' : 'Фото-мок · готовая иллюстрация') : a.tag}</strong><span>${j ? (j.mode === 'live' ? `${date(j.createdAt)} · локальные модели на вашем сервере` : `${j.ratio} · ${date(j.createdAt)} · не результат указанной модели`) : 'Выберите рецепт и создайте задачу — результат появится здесь и в медиатеке.'}</span></div>${j ? `<div class="media-preview-actions"><button class="icon-btn ${j.favorite ? 'active' : ''}" data-media-action="favorite" data-id="${j.id}" aria-label="${j.favorite ? 'Убрать из избранного' : 'В избранное'}" aria-pressed="${j.favorite}">${icon('star')}</button><button class="icon-btn" data-media-action="detail" data-id="${j.id}" aria-label="Открыть детали результата">${icon('arrowRight')}</button></div>` : ''}</div>`;
  }
  function inlineQueueMarkup() {
    const active = state.jobs.filter(j => ['queued', 'running', 'error'].includes(j.status)).slice(0, 2);
    return active.length ? active.map(j => `<div class="media-mini-job" data-job-row="${j.id}"><span class="media-job-icon">${icon(j.type === 'video' ? 'play' : 'image')}</span><div><strong>${esc(j.project || recipe(j.recipe).title)}</strong><span data-job-status>${statusLabel(j)}</span>${['queued', 'running'].includes(j.status) ? `<div class="media-progress" role="progressbar" aria-label="Подготовка локального мока" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${j.progress}"><span data-job-progress style="width:${j.progress}%"></span></div>` : ''}</div>${j.status === 'error' ? `<button class="text-btn" data-media-action="retry" data-id="${j.id}">Повторить</button>` : ['running', 'queued'].includes(j.status) ? `<button class="icon-btn small" data-media-action="cancel" data-id="${j.id}" aria-label="Остановить задачу">${icon('stop')}</button>` : ''}</div>`).join('') : `<div class="media-queue-empty">${icon('check')}Очередь свободна. Можно попробовать новый рецепт.</div>`;
  }
  function libraryMarkup() {
    return `<div class="media-library-toolbar"><div class="filter-tabs" role="group" aria-label="Тип результата">${[['all', 'Все'], ['image', 'Фото'], ['video', 'Видео'], ['favorite', 'Избранное']].map(([id, label]) => `<button class="filter-tab ${libraryType === id ? 'active' : ''}" aria-pressed="${libraryType === id}" data-media-action="library-filter" data-id="${id}">${label}</button>`).join('')}</div><label class="media-search">${icon('search')}<input type="search" id="media-library-search" placeholder="Найти по проекту или брифу" aria-label="Поиск по медиатеке" value="${esc(libraryQuery)}"></label><button class="btn" data-media-action="export">${icon('download')}Экспорт брифов</button></div><div class="media-library-meta"><span id="media-result-count"></span><button class="text-btn" data-media-action="clear">Очистить медиатеку</button></div><div id="media-library-grid" class="media-library-grid"></div>`;
  }
  function filteredJobs() { return readyJobs().filter(j => (libraryType === 'all' || (libraryType === 'favorite' ? j.favorite : j.type === libraryType)) && (!libraryQuery || (j.project + ' ' + j.prompt + ' ' + recipe(j.recipe).title).toLowerCase().includes(libraryQuery.toLowerCase()))); }
  function updateLibrary() {
    const grid = $('#media-library-grid', root); if (!grid) return;
    const jobs = filteredJobs();
    $('#media-result-count', root).textContent = `${jobs.length} из ${readyJobs().length} готовых работ · хранится до 40 задач`;
    grid.innerHTML = jobs.length ? jobs.map(j => `<article class="media-library-card"><button class="media-library-image" data-media-action="detail" data-id="${j.id}" aria-label="Открыть ${esc(j.project || recipe(j.recipe).title)}"><img src="${output(j, true)}" alt="${esc(j.mode === 'live' ? 'Live-результат' : asset(j.asset).alt)}" loading="lazy" width="400" height="300"><span class="badge">${icon(j.type === 'video' ? 'play' : j.mode === 'live' && j.type === 'music' ? 'megaphone' : 'image')}${typeBadge(j)}</span></button><div class="media-library-card-body"><div><strong>${esc(j.project || recipe(j.recipe).title)}</strong><span>${j.ratio} · ${date(j.createdAt)}</span></div><button class="icon-btn small ${j.favorite ? 'active' : ''}" data-media-action="favorite" data-id="${j.id}" aria-pressed="${j.favorite}" aria-label="${j.favorite ? 'Убрать из избранного' : 'В избранное'}">${icon('star')}</button></div><div class="media-library-card-actions"><button class="text-btn" data-media-action="reuse" data-id="${j.id}">${icon('refresh')}Повторить бриф</button><button class="icon-btn small" data-media-action="download" data-id="${j.id}" aria-label="Скачать локальный ${j.type === 'video' ? 'видео-мок' : 'фото-мок'}">${icon('download')}</button><button class="icon-btn small" data-media-action="delete" data-id="${j.id}" aria-label="Удалить результат">${icon('trash')}</button></div></article>`).join('') : `<div class="empty-state media-empty">${icon(libraryType === 'favorite' ? 'star' : 'image')}<h2>${readyJobs().length ? 'Ничего не найдено' : 'Здесь будет ваша медиатека'}</h2><p>${readyJobs().length ? 'Попробуйте другой запрос или снимите фильтр.' : 'Создайте первый фото- или видео-мок. Бриф, формат и результат останутся рядом.'}</p><button class="btn primary" data-media-action="${readyJobs().length ? 'reset-filter' : 'new'}">${readyJobs().length ? 'Сбросить фильтры' : 'Создать первый мок'}</button></div>`;
  }
  function queueMarkup() {
    const jobs = state.jobs.filter(j => j.status !== 'ready');
    return `<div class="media-queue-intro"><div><h2>От брифа к результату</h2><p>${liveActive() ? 'Live-задачи выполняются локальными моделями на сервере: фото — минуты, музыка — минуты, текст — секунды. Прогресс обновляется опросом сервера.' : 'Одна задача готовится примерно 4–6 секунд. Это таймер интерфейса, не скорость реальной модели.'}</p></div><button class="btn" data-media-action="new">${icon('plus')}Новая задача</button></div><div class="media-queue-list">${jobs.length ? jobs.map(j => `<article class="media-queue-card" data-job-row="${j.id}"><img src="${asset(j.asset).image}" alt="" width="88" height="72"><div class="media-queue-card-main"><div class="media-queue-card-title"><strong>${esc(j.project || recipe(j.recipe).title)}</strong><span class="badge ${j.status === 'error' ? 'media-status-error' : ''}" data-job-status>${statusLabel(j)}</span></div><p>${j.type === 'video' ? 'Видео' : 'Фото'} · ${j.ratio} · ${date(j.createdAt)}</p>${['running', 'queued'].includes(j.status) ? `<div class="media-progress" role="progressbar" aria-label="Подготовка локального мока" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${j.progress}"><span data-job-progress style="width:${j.progress}%"></span></div>` : j.status === 'error' ? '<p class="media-error-copy">Специально включённая демо-ошибка. Внешний сервис не вызывался.</p>' : '<p>Задача остановлена. Бриф можно использовать повторно.</p>'}</div><div class="media-queue-card-actions">${['queued', 'running'].includes(j.status) ? `<button class="btn" data-media-action="cancel" data-id="${j.id}">${icon('stop')}Остановить</button>` : `<button class="btn" data-media-action="retry" data-id="${j.id}">${icon('refresh')}Повторить</button>`}<button class="icon-btn" data-media-action="delete" data-id="${j.id}" aria-label="Удалить задачу">${icon('trash')}</button></div></article>`).join('') : `<div class="empty-state media-empty">${icon('clock')}<h2>Всё спокойно</h2><p>Активных и остановленных задач нет. Готовые работы находятся в медиатеке.</p><button class="btn primary" data-media-action="new">Попробовать рецепт</button></div>`}</div>`;
  }
  function modelsMarkup() {
    return `<div class="media-model-intro"><div><h2>Модель — инструмент, а не весь продукт</h2><p>Каталог для выбора направления. Ни одна из этих моделей не подключена к демо; названия и условия проверены по документации на 6 ноября 2026 года.</p></div><a class="btn" href="audits/2026-11-06-media-hub-research.md" download>${icon('download')}Исследование</a></div><div class="filter-tabs media-model-filters" role="group" aria-label="Направление моделей">${[['all', 'Все направления'], ['image', 'Фото'], ['video', 'Видео']].map(([id, label]) => `<button class="filter-tab ${modelType === id ? 'active' : ''}" aria-pressed="${modelType === id}" data-media-action="model-filter" data-id="${id}">${label}</button>`).join('')}</div><div class="media-model-grid">${MODELS.filter(m => modelType === 'all' || m.kind === modelType).map(m => `<article class="media-model-card"><div class="media-model-top"><span class="avatar tone-${m.kind === 'image' ? 'green' : 'violet'}">${icon(m.kind === 'image' ? 'image' : 'play')}</span><span class="badge">${m.access}</span></div><span class="eyebrow">${m.maker}</span><h3>${m.name}</h3><p>${m.use}</p><div class="media-model-note">${m.note}</div><a class="text-btn" href="${m.url}" target="_blank" rel="noopener noreferrer">Первичная документация ${icon('arrowRight')}</a></article>`).join('')}</div><div class="media-catalog-note">${icon('info')}<span>Ссылки ведут на внешние сайты только после клика. Цены, лицензии, доступность в вашем регионе и условия обработки данных нужно перепроверить перед production.</span></div>`;
  }
  function updateCounts() {
    if (!root) return;
    const library = $('#media-library-count', root), queue = $('#media-queue-count', root);
    if (library) library.textContent = readyJobs().length;
    if (queue) queue.textContent = activeCount();
    const button = $('#media-generate', root); if (button) button.disabled = activeCount() >= MAX_ACTIVE;
  }
  function updateJobRows() {
    $$('[data-job-row]', root).forEach(row => {
      const j = job(row.dataset.jobRow); if (!j) return;
      const status = $('[data-job-status]', row), progress = $('[data-job-progress]', row);
      if (status) status.textContent = statusLabel(j);
      if (progress) { progress.style.width = j.progress + '%'; progress.parentElement.setAttribute('aria-valuenow', String(j.progress)); }
    });
  }
  function ensureTimer() { if (!timer && state.jobs.some(j => j.status === 'queued' && j.mode !== 'live')) timer = setInterval(tick, 120); }
  function tick() {
    const now = Date.now();
    if (!state.jobs.some(j => j.status === 'running' && j.mode !== 'live')) {
      const next = state.jobs.find(j => j.status === 'queued' && j.mode !== 'live');
      if (next) { next.status = 'running'; next.startedAt = now; persist(); if (root && tab === 'queue') renderPanel(); }
    }
    let finished = null;
    for (const j of state.jobs) {
      if (j.status !== 'running' || j.mode === 'live') continue;
      const duration = j.type === 'video' ? 5600 : 3800;
      j.progress = Math.min(100, Math.max(0, Math.round((now - j.startedAt) / duration * 100)));
      if (j.progress >= 100) { j.status = j.fail ? 'error' : 'ready'; j.fail = false; j.startedAt = null; finished = j; }
    }
    if (finished) {
      const saved = persist(); updateCounts();
      if (finished.status === 'error') host?.toast('Демо-ошибка завершена. Попробуйте повторить задачу.', 'error');
      else host?.toast(saved ? 'Мок готов. Он сохранён в медиатеке.' : 'Мок готов в этой вкладке. Скачайте его до закрытия страницы.', saved ? 'success' : 'error');
      if (root) {
        if (tab === 'create') { $('#media-preview', root).innerHTML = previewMarkup(readyJobs()[0]); $('video', root)?.load(); $('#media-inline-queue', root).innerHTML = inlineQueueMarkup(); }
        else if (tab === 'library') updateLibrary(); else if (tab === 'queue') renderPanel();
      }
    } else if (root) updateJobRows();
    if (!state.jobs.some(j => ['queued', 'running'].includes(j.status))) { clearInterval(timer); timer = null; if (root && tab === 'create') $('#media-inline-queue', root).innerHTML = inlineQueueMarkup(); }
  }
  function syncForm() {
    if (!$('#media-prompt', root || document)) return;
    form.prompt = $('#media-prompt', root).value.slice(0, MAX_PROMPT);
    form.project = $('#media-project', root).value.slice(0, 80);
    form.goal = $('#media-goal', root).value;
    form.asset = $('#media-asset', root).value;
    form.failNext = $('#media-fail', root).checked;
  }
  function setType(type) {
    syncForm(); form.type = type;
    const r = RECIPES.find(r => r.type === type); form.recipe = r.id; form.asset = r.asset; form.goal = r.goal; form.prompt = r.prompt;
    if (type === 'video' && !['16:9', '9:16'].includes(form.ratio)) form.ratio = '9:16';
    renderPanel();
  }
  function makeRoom() { return state.jobs.length < MAX_JOBS || state.jobs.some(j => ['ready', 'error', 'cancelled'].includes(j.status) && !j.favorite); }
  function trimCapacity() {
    // Shared by submit/retry: a retried job is new, so its old record can be evicted.
    while (state.jobs.length > MAX_JOBS) { const index = state.jobs.findLastIndex(item => ['ready', 'error', 'cancelled'].includes(item.status) && !item.favorite); if (index < 0) break; state.jobs.splice(index, 1); }
  }
  function submit() {
    syncForm();
    if (liveActive()) { window.BRIIX_MEDIA_LIVE.submit({ type: form.type === 'video' ? 'image' : form.type, prompt: form.prompt.trim(), project: form.project.trim(), ratio: form.ratio }); return; }
    const error = $('#media-form-error', root);
    if (form.prompt.trim().length < 12) { error.hidden = false; error.textContent = 'Добавьте хотя бы 12 символов: что показать, какой свет и какое настроение.'; $('#media-prompt', root).setAttribute('aria-invalid', 'true'); $('#media-prompt', root).focus(); return; }
    if (activeCount() >= MAX_ACTIVE || !makeRoom()) { host.toast('Достигнут лимит очереди или медиатеки. Освободите место в медиатеке.', 'error'); return; }
    error.hidden = true; $('#media-prompt', root).removeAttribute('aria-invalid');
    const j = { id: uid(), type: form.type, recipe: form.recipe, asset: form.asset, goal: form.goal, ratio: form.ratio, project: form.project.trim(), prompt: form.prompt.trim(), status: 'queued', progress: 0, favorite: false, createdAt: Date.now(), startedAt: null, fail: form.failNext, references: references.map(f => ({ ...f })) };
    state.jobs.unshift(j);
    // Capacity was checked before insertion. Only oldest unprotected settled work is evicted.
    trimCapacity();
    form.failNext = false; $('#media-fail', root).checked = false;
    persist(); updateCounts(); $('#media-inline-queue', root).innerHTML = inlineQueueMarkup(); ensureTimer(); host.toast('Бриф добавлен в локальную очередь.');
  }
  function cancel(id) {
    const j = job(id); if (!j || !['queued', 'running'].includes(j.status)) return;
    if (j.mode === 'live') { window.BRIIX_MEDIA_LIVE && window.BRIIX_MEDIA_LIVE.cancel(j); return; }
    j.status = 'cancelled'; j.startedAt = null; const saved = persist(); updateCounts(); renderPanel(); host.toast(saved ? 'Задача остановлена. Бриф сохранён.' : 'Задача остановлена. Бриф доступен только в этой вкладке.'); }
  function retry(id) {
    const old = job(id); if (!old || !['error', 'cancelled'].includes(old.status)) return;
    if (activeCount() >= MAX_ACTIVE || !makeRoom()) { host.toast('Очередь или хранилище заполнены. Освободите место перед повтором.', 'error'); return; }
    const j = { ...old, id: uid(), status: 'queued', progress: 0, favorite: false, createdAt: Date.now(), startedAt: null, fail: false };
    state.jobs.unshift(j); trimCapacity(); persist(); updateCounts(); renderPanel(); ensureTimer(); host.toast('Повтор добавлен в очередь без демо-ошибки.');
  }
  function reuse(id) { const j = job(id); if (!j) return; host.closeModal(); form = { ...form, type: j.type, recipe: j.recipe, asset: j.asset, goal: j.goal, ratio: j.ratio, project: j.project, prompt: j.prompt, failNext: false }; references = j.references.map(f => ({ ...f })); tab = 'create'; render(); $('#media-prompt', root)?.focus(); host.toast('Бриф перенесён в форму. Можно изменить детали.'); }
  function favorite(id) { const j = job(id); if (!j || j.status !== 'ready') return; j.favorite = !j.favorite; persist(); if (tab === 'library') updateLibrary(); else if (tab === 'create') { $('#media-preview', root).innerHTML = previewMarkup(readyJobs()[0]); $('video', root)?.load(); } if (detailId === id && $('#modal').open) detail(id); }
  function remove(id) {
    const j = job(id); if (!j) return;
    host.openModal('Удалить эту работу?', `<div class="media-modal"><p>«${esc(j.project || recipe(j.recipe).title)}» будет удалена из локальной медиатеки. Уже скачанные файлы останутся на устройстве.</p></div>`, [{ label: 'Оставить', action: host.closeModal }, { label: 'Удалить', danger: true, action: () => { state.jobs = state.jobs.filter(item => item.id !== id); persist(); host.closeModal(); detailId = null; renderPanel(); updateCounts(); host.toast('Работа удалена из медиатеки.'); } }]);
  }
  function detail(id) {
    const j = job(id); if (!j || j.status !== 'ready') return; detailId = id;
    if (j.mode === 'live') {
      const p = j.provenance || {};
      const wc = Number.isFinite(p.wall_clock_ms) ? (p.wall_clock_ms / 1000).toFixed(1) + ' с' : '—';
      const q = Number.isFinite(p.queued_ms) ? (p.queued_ms / 1000).toFixed(1) + ' с' : '—';
      host.openModal(j.project || 'Приватный live', `<div class="media-modal"><div class="media-detail-media">${j.type === 'music' ? `<audio controls src="${output(j)}"></audio>` : j.type === 'text' ? `<pre class="media-detail-prompt">${esc(liveDisplayUrl(j) ? 'Результат готов — откройте или скачайте файл.' : 'Результат истёк на сервере.')}</pre>` : `<img src="${output(j)}" alt="Live-результат">`}</div><div class="media-detail-tags"><span class="badge">${({ image: 'Фото', music: 'Музыка', text: 'Текст' })[j.type]} · live</span><span class="badge">Приватный live</span></div><p class="media-detail-disclaimer">Результат сгенерирован локальными моделями на вашем сервере и получен по защищённому туннелю. Файл хранится на сервере 24 часа.</p><h3>Бриф</h3><p class="media-detail-prompt">${esc(j.prompt)}</p><h3>Provenance</h3><p>Модель: ${esc(p.model || '—')} · генерация: ${wc} · ожидание в очереди: ${q}${p.params ? ' · параметры: ' + esc(JSON.stringify(p.params)) : ''}</p></div>`, [{ label: 'Повторить бриф', action: () => reuse(id) }, { label: 'Скопировать бриф', action: () => host.copyText(j.prompt) }, { label: 'Скачать результат', primary: true, action: () => window.BRIIX_MEDIA_LIVE && window.BRIIX_MEDIA_LIVE.download(j) }], true);
      return;
    }
    const r = recipe(j.recipe);
    host.openModal(j.project || r.title, `<div class="media-modal"><div class="media-detail-media">${j.type === 'video' ? `<video controls playsinline preload="metadata" poster="${asset(j.asset).image}" aria-label="Демо-видео ${esc(asset(j.asset).name)}"><source src="${output(j)}" type="video/mp4"><source src="${output(j).replace('.mp4', '.webm')}" type="video/webm"></video>` : `<img src="${output(j)}" alt="${esc(asset(j.asset).alt)}">`}</div><div class="media-detail-tags"><span class="badge">${j.type === 'video' ? 'Видео · 5 с · без звука' : 'Фото'}</span><span class="badge">${j.ratio}</span><span class="badge">Локальный мок</span></div><p class="media-detail-disclaimer">${j.type === 'video' ? 'Видео собрано локально из неподвижного изображения с помощью движения камеры. Это не генерация новой сцены.' : 'Готовая демонстрационная иллюстрация. Она не создана по вашему брифу и не является результатом названной модели.'} Фото скачивается с центральной обрезкой под выбранный формат; видео использует готовый кроп 16:9 или 9:16.</p><h3>Бриф</h3><p class="media-detail-prompt">${esc(j.prompt)}</p><h3>Ограничения для будущей модели</h3><p>${esc(r.negative)}</p><h3>Рецепт</h3><ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>${j.references.length ? `<p class="muted">Референсы-заглушки: ${j.references.map(f => esc(f.name)).join(', ')}. Содержимое не сохранялось.</p>` : ''}</div>`, [{ label: 'Повторить бриф', action: () => reuse(id) }, { label: 'Скопировать бриф', action: () => host.copyText(j.prompt) }, { label: 'Скачать мок', primary: true, action: () => downloadJob(j) }], true);
    $('video', $('#modal'))?.load();
  }
  async function downloadJob(j) {
    const a = document.createElement('a'); a.download = 'briix-local-mock-' + j.id.slice(6, 14) + (j.type === 'video' ? '.mp4' : '.jpg');
    if (j.type === 'video') a.href = output(j);
    else {
      // Decode the job's own asset, not whichever preview happens to be in the DOM.
      const image = new Image(); image.src = output(j);
      try { await image.decode(); }
      catch { host.toast('Изображение ещё загружается. Попробуйте через секунду.', 'error'); return; }
      const [rw, rh] = j.ratio.split(':').map(Number);
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const sw = image.naturalWidth * scale, sh = image.naturalHeight * scale;
      const cw = Math.min(sw, sh * rw / rh), ch = cw * rh / rw;
      const canvas = document.createElement('canvas'); canvas.width = Math.round(cw); canvas.height = Math.round(ch);
      canvas.getContext('2d').drawImage(image, (sw - cw) / 2 / scale, (sh - ch) / 2 / scale, cw / scale, ch / scale, 0, 0, canvas.width, canvas.height);
      a.href = canvas.toDataURL('image/jpeg', .92);
    }
    document.body.append(a); a.click(); a.remove(); host.toast(originLabel() + ' подготовлен к скачиванию.');
  }
  function help() {
    host.openModal('Изображения без магии за кадром', `<div class="media-modal"><div class="media-help-steps"><div><span>01</span><strong>Соберите бриф</strong><p>Задача, проект, описание, формат и визуальный референс. Это реальное локальное состояние, а не декоративная форма.</p></div><div><span>02</span><strong>Проверьте сценарий</strong><p>Очередь, прогресс, отмена, ошибка и повтор работают. Фото берётся из коллекции; видео — локальная ffmpeg-анимация исходника.</p></div><div><span>03</span><strong>Сохраните направление</strong><p>Медиатека, избранное, поиск, скачивание и экспорт брифов. Данные живут отдельно от диалогов в этом браузере.</p></div></div><h3>Что не происходит</h3><p>Нет inference, API-ключей, кредитов, анализа загруженных файлов и отправки брифов провайдерам. Текст брифа не меняет изображение. Фото скачивается с центральной обрезкой под выбранный формат; видео использует готовый кроп 16:9 или 9:16.</p><h3>Где брать бесплатные моки</h3><p>Самый воспроизводимый путь — собственные или лицензированные исходники, локальная обработка Pillow и анимация FFmpeg. Инструкция и команды: <a class="media-doc-link" href="audits/2026-11-06-free-mock-guide.md" download>руководство по локальным мокам</a>. Пробные кредиты облачных сервисов — отдельный, временный и не гарантированный вариант.</p><p class="media-detail-disclaimer">Прежняя «инструкция от меня» в доступной истории и репозитории не найдена. Это новое руководство, а не найденный старый документ.</p></div>`, [{ label: 'Понятно, попробуем', primary: true, action: host.closeModal }], true);
  }
  function clear() {
    if (!state.jobs.length && !storageProtected && storageOkay) { host.toast('Медиатека уже пуста.'); return; }
    host.openModal('Очистить мастерскую изображений?', `<div class="media-modal"><p>Будут удалены все задачи, брифы и отметки избранного. Активные задачи тоже остановятся. Диалоги BRIIX не затрагиваются. Скачанные файлы останутся на устройстве.</p></div>`, [{ label: 'Отмена', action: host.closeModal }, { label: 'Скачать брифы', action: exportBriefs }, { label: 'Очистить', danger: true, action: () => { clearInterval(timer); timer = null; state = fresh(); storageProtected = false; storageOkay = true; persist(); host.closeModal(); render(); host.toast('Мастерская изображений очищена.'); } }]);
  }
  function exportBriefs() { host.download('briix-media-briefs-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ ...state, notice: 'Local mocks only. No model inference. Asset paths are relative to BRIIX.', jobs: state.jobs.map(j => ({ ...j, status: j.status === 'running' ? 'queued' : j.status, startedAt: null })) }, null, 2), 'application/json'); host.toast('Брифы экспортированы. Сами медиафайлы скачиваются отдельно.'); }
  function addReferences(files) {
    for (const file of [...files]) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { host.toast('Выберите PNG, JPEG или WebP.', 'error'); continue; }
      if (file.size > 10485760) { host.toast('Изображение должно быть не больше 10 МБ.', 'error'); continue; }
      if (references.length >= 3) { host.toast('В демо можно добавить до трёх референсов.', 'error'); break; }
      references.push({ name: file.name.slice(0, 180), size: file.size });
    }
    const list = $('#media-reference-list', root); if (list) list.innerHTML = referenceMarkup();
  }
  const actions = {
    tab: el => { syncForm(); tab = el.dataset.id; renderPanel(); if (tab === 'library') updateLibrary(); },
    type: el => setType(el.dataset.id),
    recipe: el => { syncForm(); const r = recipe(el.dataset.id); if (r.type !== form.type) return; form.recipe = r.id; form.asset = r.asset; form.goal = r.goal; form.prompt = r.prompt; renderPanel(); },
    ratio: el => { syncForm(); form.ratio = el.dataset.id; renderPanel(); },
    reference: () => $('#media-reference-input', root).click(),
    'remove-reference': el => { references.splice(Number(el.dataset.index), 1); $('#media-reference-list', root).innerHTML = referenceMarkup(); },
    'library-filter': el => { libraryType = el.dataset.id; renderPanel(); updateLibrary(); },
    'model-filter': el => { modelType = el.dataset.id; renderPanel(); },
    'reset-filter': () => { libraryType = 'all'; libraryQuery = ''; renderPanel(); updateLibrary(); },
    new: () => { tab = 'create'; renderPanel(); $('#media-prompt', root)?.focus(); },
    cancel: el => cancel(el.dataset.id), retry: el => retry(el.dataset.id), reuse: el => reuse(el.dataset.id), favorite: el => favorite(el.dataset.id), detail: el => detail(el.dataset.id), delete: el => remove(el.dataset.id), download: el => { const j = job(el.dataset.id); if (j?.status !== 'ready') return; if (j.mode === 'live') { window.BRIIX_MEDIA_LIVE && window.BRIIX_MEDIA_LIVE.download(j); return; } downloadJob(j); }, help, clear, export: exportBriefs,
    live: () => { if (window.BRIIX_MEDIA_LIVE) window.BRIIX_MEDIA_LIVE.toggle(); }
  };
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-media-action]'); if (!el || el.disabled || !host) return;
    const action = actions[el.dataset.mediaAction]; if (action) { event.preventDefault(); action(el); }
  });
  document.addEventListener('input', event => {
    if (!root) return;
    if (event.target.id === 'media-prompt') { form.prompt = event.target.value; $('#media-prompt-count', root).textContent = form.prompt.length + ' / ' + MAX_PROMPT; $('#media-form-error', root).hidden = true; event.target.removeAttribute('aria-invalid'); }
    if (event.target.id === 'media-project') form.project = event.target.value;
    if (event.target.id === 'media-library-search') { libraryQuery = event.target.value; updateLibrary(); }
  });
  document.addEventListener('change', event => {
    if (!root) return;
    if (['media-goal', 'media-asset'].includes(event.target.id)) { syncForm(); if (event.target.id === 'media-asset' && !readyJobs().length) $('#media-preview', root).innerHTML = previewMarkup(null); }
    if (event.target.id === 'media-fail') form.failNext = event.target.checked;
    if (event.target.id === 'media-reference-input') { addReferences(event.target.files); event.target.value = ''; }
  });
  document.addEventListener('submit', event => { if (event.target.id === 'media-brief-form') { event.preventDefault(); submit(); } });
  document.addEventListener('keydown', event => {
    if (!event.target.closest('.media-tabs') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = $$('.media-tab', root); const index = tabs.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    syncForm(); tab = tabs[next].dataset.id; renderPanel(); tabs[next].focus(); if (tab === 'library') updateLibrary();
  });
  document.addEventListener('error', event => { if (event.target.matches?.('.media-page video, .media-detail-media video')) host?.toast('Видео не загрузилось. Проверьте локальные файлы assets/media.', 'error'); }, true);
  $('#modal').addEventListener('close', () => { detailId = null; $$('video', $('#modal')).forEach(v => v.pause()); });
  window.addEventListener('pageshow', () => { if (state.jobs.some(j => j.status === 'queued')) ensureTimer(); });
  function suspend() { $$('video').forEach(v => v.pause()); clearInterval(timer); timer = null; state.jobs.forEach(j => { if (j.status === 'running' && j.mode !== 'live') { j.status = 'queued'; j.startedAt = null; j.progress = 0; } }); persist(); }
  window.BRIIX_MEDIA = {
    render(main, services) { host = services; root = main; render(); if (tab === 'library') updateLibrary(); ensureTimer(); window.BRIIX_MEDIA_LIVE && window.BRIIX_MEDIA_LIVE.onHostReady(); },
    suspend,
    validate,
    // Narrow internal surface for media-live.js (optional live mode).
    _api: {
      liveActive,
      setLiveBanner: text => { const el = $('#media-live-banner', root || document); if (!el) return; el.hidden = !text; el.textContent = text || ''; },
      addJob: jobData => {
        if (!window.BRIIX_MEDIA_LIVE || !window.BRIIX_MEDIA_LIVE.active()) return null;
        try { const j = validateLiveJob({ ...jobData, mode: 'live', favorite: false, createdAt: Date.now() }, new Set(state.jobs.map(x => x.id))); state.jobs.unshift(j); trimCapacity(); persist(); updateCounts(); if (root) { renderPanel(); if (tab === 'library') updateLibrary(); } return j; }
        catch { return null; }
      },
      patchJob: (id, patch) => {
        const j = job(id); if (!j) return null;
        Object.assign(j, patch); persist(); updateCounts();
        if (root) { updateJobRows(); if (tab === 'create') { $('#media-inline-queue', root).innerHTML = inlineQueueMarkup(); } if (tab === 'queue') renderPanel(); if (tab === 'library') updateLibrary(); }
        return j;
      },
      refresh: () => { if (root) { renderPanel(); if (tab === 'library') updateLibrary(); } updateCounts(); },
      toast: (message, kind) => host && host.toast(message, kind)
    }
  };
})();
