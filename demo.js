/* BRIIX — интерактивное демо пользовательского интерфейса.
 * Только localStorage и сценарные ответы. Ни сетевых запросов, ни SDK, ни настоящего inference.
 * Dynamic user content is escaped before rendering; markdown is a small allowlisted renderer.
 */
(() => {
  'use strict';
  const { assistants, promptLibrary, makeResponse, seedChats } = window.BRIIX_DATA;
  const STORAGE_KEY = 'briix-workspace-v2';
  const MAX_CHARS = 12000;
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const MAX_FILES = 4;
  const DEFAULT_SETTINGS = {
    theme: 'light', name: '', defaultAssistant: 'universal', enterToSend: true,
    showSuggestions: true, density: 'comfortable', fontSize: 'normal',
    simulateErrors: false, saveHistory: true, streaming: true
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const main = $('#main-content');
  const modal = $('#modal');
  const searchModal = $('#search-modal');
  const mobileQuery = matchMedia('(max-width: 800px)');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let storageAvailable = true;
  let storageProtected = false;
  let standStatusText = 'Ключ не проверялся в этой сессии.';
  let storageWarning = '';
  let skipInitialPersist = false;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  let modalReturnFocus = null;
  let searchReturnFocus = null;
  let sidebarReturnFocus = null;
  let activeStream = null;
  const chatLiveActive = () => !!window.BRIIX_CHAT_LIVE?.active();
  let draftTimer = null;
  let pendingSend = false;
  let modalVersion = 0;
  let catalogFilter = 'all';
  let catalogQuery = '';
  let promptFilter = 'Все';
  let promptQuery = '';
  let favoriteFilter = 'chats';
  let searchQuery = '';
  let revealObserver = null;

  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrowUp: '<path d="m6 11 6-6 6 6M12 5v14"/>',
    arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    search: '<circle cx="10.8" cy="10.8" r="7.2"/><path d="m16 16 4.5 4.5"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    library: '<path d="M4 6v14M8 4v16M12 6v14m4-15 4 14"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    settings: '<path d="m9.5 3-.6 2.2-2 .9-2.1-.6-2 3.5 1.6 1.6v2.8L2.8 15l2 3.5 2.1-.6 2 .9.6 2.2h5l.6-2.2 2-.9 2.1.6 2-3.5-1.6-1.6v-2.8L21.2 9l-2-3.5-2.1.6-2-.9L14.5 3h-5Z"/><circle cx="12" cy="12" r="3"/>',
    sparkles: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3ZM20 2v4m-2-2h4"/>',
    pen: '<path d="m16 3 5 5M4 20l4-1 13-13a2.1 2.1 0 0 0-5-5L3 14l-1 6 6-1"/>',
    chart: '<path d="M3 3v18h18M7 14v3m5-8v8m5-12v12"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
    megaphone: '<path d="m3 11 18-6v14L3 14v-3Zm4 4 1 6h3l-1-5M21 9l2 1v4l-2 1"/>',
    book: '<path d="M12 5v16M3 3h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V3Z"/>',
    route: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h8a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h8"/>',
    lightbulb: '<path d="M9 18h6m-5 3h4M8.1 14a6 6 0 1 1 7.8 0c-.9.7-.9 1.5-.9 2H9c0-.5 0-1.3-.9-2Z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    type: '<path d="M4 7V4h16v3M12 4v16m-4 0h8"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    flask: '<path d="M9 3h6m-5 0v7l-6 9a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2l-6-9V3M8 15h8"/>',
    graduation: '<path d="m2 9 10-5 10 5-10 5L2 9Zm4 2v6c3 3 9 3 12 0v-6m4-2v8"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/>',
    eyeOff: '<path d="M4 4l16 16"/><path d="M9.6 5.3A10.9 10.9 0 0 1 12 5c6.4 0 10 6 10 6a17.6 17.6 0 0 1-3.6 4.1M6.3 7.8A17.4 17.4 0 0 0 2 11s3.6 6 10 6a10.8 10.8 0 0 0 3.4-.5"/><path d="M9.6 9.9a2.6 2.6 0 0 0 3.6 3.6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z"/>',
    monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    paperclip: '<path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8m-8 4h5"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    thumbsUp: '<path d="M7 10v11H3V10h4Zm0 0 5-8a3 3 0 0 1 2 3v4h5a2 2 0 0 1 2 2l-1 8a2 2 0 0 1-2 2H7"/>',
    thumbsDown: '<path d="M7 14V3H3v11h4Zm0 0 5 8a3 3 0 0 0 2-3v-4h5a2 2 0 0 0 2-2l-1-8a2 2 0 0 0-2-2H7"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6a8 8 0 0 1 13.2 3M4.7 15A8 8 0 0 0 17.9 18"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 16v5h14v-5"/>',
    alert: '<path d="m10.3 3.8-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.2l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
    media: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/><path d="m14 3 1.2 3.8L19 8l-3.8 1.2L14 13l-1.2-3.8L9 8l3.8-1.2L14 3Z"/>',
    play: '<path d="m9 5 10 7-10 7V5Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-3 0h6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5M21 12H9"/>'
  };
  function icon(name, extra = '') { return `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.sparkles}</svg>`; }
  function brandMark() { return '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 3.5c2.2 9.7 6.8 14.3 16.5 16.5C26.8 22.2 22.2 26.8 20 36.5 17.8 26.8 13.2 22.2 3.5 20 13.2 17.8 17.8 13.2 20 3.5Z" stroke="currentColor" stroke-width="1.6"/><path d="M20 10c1.3 5.7 4.3 8.7 10 10-5.7 1.3-8.7 4.3-10 10-1.3-5.7-4.3-8.7-10-10 5.7-1.3 8.7-4.3 10-10Z" fill="currentColor"/></svg>'; }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function uid(prefix = 'id') { return prefix + '-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
  function assistant(id) { return assistants.find(a => a.id === id) || assistants[0]; }
  function avatar(a, size = '') { return `<span class="avatar tone-${a.tone} ${size}">${icon(a.icon)}</span>`; }
  function currentChat() { const id = route().id; return state.chats.find(c => c.id === id); }
  function route() {
    const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/');
    const page = ['home', 'assistants', 'prompts', 'favorites', 'media', 'images', 'music', 'settings', 'chat'].includes(parts[0]) ? parts[0] : 'home';
    return { page: page === 'images' ? 'media' : page, id: parts[1] || '' };
  }
  function navigate(path) {
    closeSidebar(false);
    if (location.hash === '#/' + path) render(); else location.hash = '/' + path;
  }
  function freshState() { return { version: 2, settings: { ...DEFAULT_SETTINGS }, chats: seedChats(), saved: [], favoritePrompts: [], drafts: {}, selectedAssistant: 'universal' }; }
  function validateState(raw) {
    if (!raw || raw.version !== 2 || !Array.isArray(raw.chats) || !Array.isArray(raw.saved) || !Array.isArray(raw.favoritePrompts) || raw.favoritePrompts.length > 1000) throw new Error('Это не резервная копия BRIIX v2.');
    if (raw.chats.length > 500 || raw.saved.length > 1000) throw new Error('Слишком много записей для локального демо.');
    const ids = new Set();
    const chats = raw.chats.map(c => {
      if (!c || typeof c.id !== 'string' || !/^[\w-]{1,100}$/.test(c.id) || ids.has(c.id) || typeof c.title !== 'string' || c.title.length > 1000 || !Array.isArray(c.messages) || c.messages.length > 1000) throw new Error('Повреждена история диалогов.');
      ids.add(c.id);
      const messageIds = new Set();
      const messages = c.messages.map(m => {
        if (!m || typeof m.id !== 'string' || !/^[\w-]{1,100}$/.test(m.id) || messageIds.has(m.id) || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 100000) throw new Error('Повреждено сообщение.');
        messageIds.add(m.id);
        return { id: m.id, role: m.role, content: m.content, createdAt: safeDate(m.createdAt), assistantId: assistant(m.assistantId).id, status: m.role === 'assistant' && m.status === 'error' ? 'error' : m.status === 'stopped' || m.status === 'streaming' || !m.content ? 'stopped' : 'complete', variant: Number.isSafeInteger(m.variant) && m.variant >= 0 && m.variant <= 10000 ? m.variant : 0, feedback: ['up', 'down'].includes(m.feedback) ? m.feedback : null, attachments: Array.isArray(m.attachments) ? m.attachments.slice(0, MAX_FILES).filter(f => f && typeof f.name === 'string').map(f => ({ id: uid('file'), name: f.name.slice(0, 180), size: Number.isFinite(Number(f.size)) ? Math.min(MAX_FILE_SIZE, Math.max(0, Number(f.size))) : 0, type: String(f.type || '').slice(0, 100) })) : [] };
      });
      return { id: c.id, title: c.title.slice(0, 100), assistantId: assistant(c.assistantId).id, messages, favorite: !!c.favorite, isExample: !!c.isExample, createdAt: safeDate(c.createdAt), updatedAt: safeDate(c.updatedAt) };
    });
    const settings = { ...DEFAULT_SETTINGS };
    const incoming = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : {};
    for (const key of ['enterToSend', 'showSuggestions', 'simulateErrors', 'saveHistory', 'streaming']) if (typeof incoming[key] === 'boolean') settings[key] = incoming[key];
    for (const [key, values] of Object.entries({ theme: ['light', 'dark', 'system'], defaultAssistant: assistants.map(a => a.id), density: ['comfortable', 'compact'], fontSize: ['normal', 'large'] })) if (values.includes(incoming[key])) settings[key] = incoming[key];
    if (typeof incoming.name === 'string') settings.name = incoming.name.slice(0, 40);
    const saved = raw.saved.filter(s => s && typeof s.id === 'string' && /^[\w-]{1,100}$/.test(s.id) && typeof s.content === 'string' && typeof s.title === 'string').slice(0, 1000).map(s => ({ id: s.id.slice(0, 100), chatId: String(s.chatId || '').slice(0, 100), messageId: String(s.messageId || '').slice(0, 100), title: s.title.slice(0, 100), content: s.content.slice(0, 100000), assistantId: assistant(s.assistantId).id, createdAt: safeDate(s.createdAt) }));
    const savedIds = new Set();
    const uniqueSaved = saved.filter(s => { if (savedIds.has(s.id)) return false; savedIds.add(s.id); return true; });
    const drafts = {};
    const incomingDrafts = raw.drafts && typeof raw.drafts === 'object' && !Array.isArray(raw.drafts) ? raw.drafts : {};
    for (const [key, value] of Object.entries(incomingDrafts).slice(0, 510)) if (/^[\w-]{1,100}$/.test(key) && typeof value === 'string') drafts[key] = value.slice(0, MAX_CHARS);
    return { version: 2, settings, chats, saved: uniqueSaved, drafts, favoritePrompts: [...new Set(raw.favoritePrompts.filter(id => promptLibrary.some(p => p.id === id)))], selectedAssistant: assistant(raw.selectedAssistant).id };
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      storageAvailable = true;
      if (!raw) { storageProtected = false; storageWarning = ''; return freshState(); }
      try { const validated = validateState(JSON.parse(raw)); storageProtected = false; storageWarning = ''; skipInitialPersist = false; return validated; }
      catch { skipInitialPersist = true; storageProtected = true; storageWarning = 'Сохранённые данные повреждены. Загружено безопасное начальное демо; исходная копия защищена от перезаписи. Экспортируйте текущую работу или импортируйте исправленную копию.'; return freshState(); }
    } catch { storageAvailable = false; return freshState(); }
  }
  let state = loadState();
  function flushDraft() { clearTimeout(draftTimer); draftTimer = null; return persist(); }
  function persist() {
    if (!storageAvailable || storageProtected) return false;
    const durable = durableState();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(durable)); return true; }
    catch { storageAvailable = false; toast('Хранилище недоступно или заполнено. Изменения остаются только до закрытия страницы. Экспортируйте копию в настройках.', 'error'); updateStorageNotice(); return false; }
  }
  function updateStorageNotice() {
    const existing = $('#storage-banner');
    if (existing) existing.remove();
    if (!storageAvailable || storageWarning) {
      const div = document.createElement('div'); div.id = 'storage-banner'; div.className = 'storage-banner'; div.setAttribute('role', 'status');
      div.textContent = !storageAvailable ? 'Локальное хранилище недоступно. Демо работает в памяти; сохраните нужное через экспорт в настройках.' : storageWarning;
      main.prepend(div);
    }
  }
  function applySettings() {
    document.documentElement.dataset.theme = state.settings.theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : state.settings.theme;
    document.body.classList.toggle('density-compact', state.settings.density === 'compact');
    document.body.classList.toggle('font-large', state.settings.fontSize === 'large');
    $('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  }
  function draftKey() { return route().page === 'chat' ? route().id : 'new'; }
  function getDraft() { return state.drafts[draftKey()] || ''; }
  function setDraft(text) {
    state.drafts[draftKey()] = text.slice(0, MAX_CHARS);
    clearTimeout(draftTimer); draftTimer = setTimeout(() => { draftTimer = null; persist(); }, 350);
  }
  function safeDate(timestamp) { const n = Number(timestamp); return Number.isFinite(n) && n >= 0 && n <= 8640000000000000 ? n : Date.now(); }
  function dateLabel(timestamp) { return new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); }
  function timeLabel(timestamp) { return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
  function fileSize(bytes) { return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' МБ' : Math.max(1, Math.round(bytes / 1024)) + ' КБ'; }
  function toast(message, type = 'success') {
    const el = document.createElement('div'); el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.innerHTML = icon(type === 'error' ? 'alert' : 'check') + `<span>${esc(message)}</span>`;
    $('#toasts').append(el); setTimeout(() => el.remove(), type === 'error' ? 6500 : 3200);
  }
  async function copyText(text, label = 'Скопировано') {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px;top:0';
        const host = modal.open ? modal : document.body; host.append(area); area.select();
        const ok = document.execCommand('copy'); area.remove(); if (!ok) throw new Error('copy');
      }
      toast(label);
    } catch { openModal('Не удалось скопировать', `<p>Браузер ограничил доступ к буферу обмена. Выделите текст вручную или экспортируйте диалог.</p><textarea class="modal-input" readonly aria-label="Текст для копирования">${esc(text)}</textarea>`, [{ label: 'Закрыть', action: closeModal }]); }
  }
  function download(name, content, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  /* Sidebar / header */
  function renderSidebar() {
    const r = route();
    const favoriteCount = state.chats.filter(c => c.favorite).length + state.saved.length + state.favoritePrompts.length;
    const nav = [['assistants', 'grid', 'Помощники'], ['prompts', 'library', 'Библиотека промптов'], ['media', 'image', 'Изображения'], ['music', 'music', 'Музыка'], ['favorites', 'star', 'Избранное']];
    const sorted = [...state.chats].sort((a, b) => b.updatedAt - a.updatedAt);
    const today = new Date().setHours(0, 0, 0, 0);
    const groups = [['Сегодня', sorted.filter(c => c.updatedAt >= today)], ['Ранее', sorted.filter(c => c.updatedAt < today)]];
    $('#sidebar').innerHTML = `
      <a href="#/home" class="brand" aria-label="BRIIX — главная"><span class="brand-mark">${brandMark()}</span><span class="brand-name">briix</span><span class="badge">DEMO</span></a>
      <button class="btn new-chat" data-action="new-chat">${icon('plus')}<span>Новый диалог</span><kbd>${isMac ? '⌘ ⇧ O' : 'Ctrl ⇧ O'}</kbd></button>
      <nav class="nav-list" aria-label="Разделы"><button class="nav-item" data-action="search">${icon('search')}<span>Поиск</span><kbd>${isMac ? '⌘ K' : 'Ctrl K'}</kbd></button>
      ${nav.map(([path, ic, label]) => `<a href="#/${path}" class="nav-item ${r.page === path ? 'active' : ''}" ${r.page === path ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${path === 'favorites' && favoriteCount ? `<span class="nav-count">${favoriteCount}</span>` : ''}</a>`).join('')}</nav>
      <div class="sidebar-divider"></div>
      <div class="history-heading"><span class="eyebrow">Ваши диалоги</span><button class="icon-btn small" data-action="search" aria-label="Найти диалог" title="Найти диалог">${icon('search')}</button></div>
      <div class="history-list">${!state.settings.saveHistory ? '<div class="history-empty">История отключена.<br>Новые диалоги живут до закрытия страницы.</div>' : sorted.length ? groups.map(([label, chats]) => chats.length ? `<div class="history-group">${label}</div>${chats.map(c => `<a href="#/chat/${esc(c.id)}" class="history-item ${r.page === 'chat' && r.id === c.id ? 'active' : ''}" ${r.page === 'chat' && r.id === c.id ? 'aria-current="page"' : ''} title="${esc(c.title)}">${icon('chat')}<span class="history-title">${esc(c.title)}</span>${c.favorite ? icon('star', 'favorite-mini') : ''}</a>`).join('')}` : '').join('') : '<div class="history-empty">Здесь появятся ваши диалоги.<br>Начните с вопроса или готового примера.</div>'}</div>
      <div class="local-card"><div class="local-card-head">${icon('shield')}<span>Ваше спокойное пространство</span></div><p>${chatLiveActive() ? 'Диалоги хранятся в этом браузере. В live-режиме текст уходит на ваш собственный сервер через приватный туннель.' : 'Диалоги хранятся в этом браузере. Без аккаунта и отправки данных на сервер.'}</p><button class="text-btn" data-action="about">Как работает демо ${icon('arrowRight')}</button></div>
      <div class="profile"><span class="profile-avatar">${esc((state.settings.name || 'Вы').slice(0, 1).toUpperCase())}</span><div class="profile-info"><div class="profile-name">${esc(state.settings.name || 'Личное пространство')}</div><div class="profile-caption">Локальный профиль</div></div><a href="#/settings" class="icon-btn" aria-label="Настройки" title="Настройки">${icon('settings')}</a></div>`;
    updateSidebarAccess();
  }
  function renderTopbar() {
    const r = route(); const chat = currentChat();
    const labels = { home: 'Новый диалог', assistants: 'Помощники', prompts: 'Библиотека промптов', favorites: 'Избранное', media: 'Изображения', music: 'Музыка', settings: 'Настройки', chat: chat?.title || 'Диалог не найден' };
    $('#topbar').innerHTML = `<button class="icon-btn mobile-menu" data-action="toggle-sidebar" aria-label="Открыть меню" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button><div class="breadcrumb">${icon('compass')}<span class="workspace-crumb">Личное пространство</span><span class="slash">/</span><span class="breadcrumb-current">${esc(labels[r.page])}</span></div><div class="topbar-actions"><button class="badge" data-action="about" title="${chatLiveActive() ? 'Чат отвечает с вашего сервера через приватный туннель' : 'Это демо со сценарными ответами'}"><span class="dot"></span>${chatLiveActive() ? 'Приватный live' : 'Демо без backend'}</button><span class="topbar-separator"></span><button class="icon-btn" data-action="toggle-theme" aria-pressed="${document.documentElement.dataset.theme === 'dark'}" aria-label="${document.documentElement.dataset.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}" title="${document.documentElement.dataset.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button><button class="icon-btn help-top" data-action="shortcuts" aria-label="Справка и горячие клавиши" title="Справка и горячие клавиши">${icon('help')}</button></div>`;
  }
  function updateSidebarAccess() {
    const sidebar = $('#sidebar'); const open = sidebar.classList.contains('open');
    sidebar.inert = mobileQuery.matches && !open;
    $('.main-shell').inert = mobileQuery.matches && open;
    const toggle = $('[data-action="toggle-sidebar"]'); if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }
  function openSidebar() {
    sidebarReturnFocus = document.activeElement; $('#sidebar').classList.add('open'); $('#sidebar-scrim').hidden = false; document.body.classList.add('sidebar-open'); updateSidebarAccess(); $('.brand').focus();
  }
  function closeSidebar(restore = true) {
    const wasOpen = $('#sidebar').classList.contains('open');
    $('#sidebar').classList.remove('open'); $('#sidebar-scrim').hidden = true; document.body.classList.remove('sidebar-open'); updateSidebarAccess();
    if (wasOpen && restore && sidebarReturnFocus?.isConnected) sidebarReturnFocus.focus();
  }
  /* Composer */
  let pendingAttachments = [];
  function composerMarkup(chat = null) {
    const a = assistant(chat?.assistantId || state.selectedAssistant);
    const value = getDraft(); const streaming = activeStream && activeStream.chatId === chat?.id;
    return `<div class="composer" id="composer"><div class="attachment-list" id="attachment-list"></div><label class="sr-only" for="prompt-input">Ваше сообщение помощнику ${esc(a.name)}</label><textarea id="prompt-input" rows="2" maxlength="${MAX_CHARS}" placeholder="${chat ? 'Продолжим мысль или зададим новый вопрос…' : 'О чём вы думаете? Спросите, напишите, придумайте…'}">${esc(value)}</textarea><div class="composer-toolbar"><div class="composer-left"><button class="icon-btn" data-action="attach" aria-label="Прикрепить файл-заглушку" title="Прикрепить файл-заглушку (до 4 файлов, до 10 МБ)" ${streaming ? 'disabled' : ''}>${icon('paperclip')}</button><button class="icon-btn" data-action="attach-example" aria-label="Добавить пример вложения" title="Добавить пример вложения" ${streaming ? 'disabled' : ''}>${icon('file')}</button><span class="composer-divider"></span><button class="assistant-select tone-${a.tone}" data-action="choose-assistant" aria-label="Выбрать помощника: ${esc(a.name)}"><span class="assistant-dot"></span><span class="select-name">${esc(a.name)}</span>${icon('chevronDown')}</button></div><button class="send-btn" id="send-button" data-action="${streaming ? 'stop' : 'send'}" aria-label="${streaming ? 'Остановить ответ' : 'Отправить сообщение'}" title="${streaming ? 'Остановить ответ' : 'Отправить сообщение'}" ${!streaming && !value.trim() && !pendingAttachments.length ? 'disabled' : ''}>${icon(streaming ? 'stop' : 'arrowUp')}</button></div></div><div class="composer-context"><span>${icon(chatLiveActive() ? 'route' : 'lock')}${chatLiveActive() ? 'Приватный live · отвечает ваш сервер' : 'Только в вашем браузере · сценарные ответы'}</span><button class="text-btn chat-live-toggle ${chatLiveActive() ? 'active' : ''}" data-action="toggle-chat-live" aria-pressed="${chatLiveActive()}" title="Ответы с вашего сервера через приватный туннель">${chatLiveActive() ? 'Выключить live' : 'Приватный live'}</button><span class="char-limit ${value.length > MAX_CHARS * .9 ? 'near' : ''}" id="char-count">${value.length > MAX_CHARS * .8 ? value.length.toLocaleString('ru-RU') + ' / 12 000' : ''}</span><span class="keyboard-hint">${state.settings.enterToSend ? 'Enter — отправить' : 'Ctrl Enter — отправить'}</span></div>`;
  }
  function updateComposerState() {
    const input = $('#prompt-input'); const send = $('#send-button'); if (!input || !send) return;
    input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, innerWidth <= 540 ? 160 : 180) + 'px';
    const running = activeStream && activeStream.chatId === currentChat()?.id;
    send.disabled = send.dataset.action === 'stop' ? false : running ? false : !input.value.trim() && !pendingAttachments.length;
    const count = $('#char-count'); if (count) { count.textContent = input.value.length > MAX_CHARS * .8 ? input.value.length.toLocaleString('ru-RU') + ' / 12 000' : ''; count.classList.toggle('near', input.value.length > MAX_CHARS * .9); }
  }
  function renderAttachments() {
    const list = $('#attachment-list'); if (!list) return;
    list.innerHTML = pendingAttachments.map(f => `<div class="attachment-chip">${icon('file')}<span class="attachment-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="faint">${fileSize(f.size)}</span><button class="icon-btn" data-action="remove-attachment" data-id="${esc(f.id)}" aria-label="Убрать ${esc(f.name)}">${icon('close')}</button></div>`).join('') + (pendingAttachments.length ? '<div class="attachment-note" style="width:100%">Демо-вложения: сохраняются только имя и размер. Содержимое не читается и не отправляется.</div>' : '');
    updateComposerState();
  }
  function addAttachments(files) {
    let added = 0;
    for (const file of Array.from(files)) {
      if (pendingAttachments.length >= MAX_FILES) { toast('Можно добавить не больше четырёх файлов.', 'error'); break; }
      if (file.size > MAX_FILE_SIZE) { toast(`«${file.name}» больше 10 МБ. Выберите файл поменьше.`, 'error'); continue; }
      if (!/\.(txt|md|csv|json|pdf|png|jpe?g|webp)$/i.test(file.name)) { toast('Для демо доступны TXT, MD, CSV, JSON, PDF и изображения.', 'error'); continue; }
      if (pendingAttachments.some(f => f.name === file.name && f.size === file.size)) continue;
      pendingAttachments.push({ id: uid('file'), name: file.name, size: file.size, type: file.type }); added++;
    }
    renderAttachments(); if (added) toast('Вложение добавлено. Это заглушка: содержимое не читается.');
  }
  function fillPrompt(text, assistantId) {
    if (activeStream) { toast('Сначала остановите текущий ответ или дождитесь его завершения.', 'error'); return; }
    if (assistantId) state.selectedAssistant = assistantId;
    state.drafts.new = text.slice(0, MAX_CHARS);
    closeModal(); navigate('home');
    requestAnimationFrame(() => { const input = $('#prompt-input'); if (input) { input.value = state.drafts.new || ''; updateComposerState(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
  }
  /* Home */
  function renderHome() {
    const selected = assistant(state.selectedAssistant);
    const name = state.settings.name.trim().split(' ')[0];
    const quickIcons = [selected.icon, 'lightbulb', 'route'];
    main.innerHTML = `<section class="home" aria-labelledby="home-title"><div id="chat-live-banner" class="storage-banner live-mode-banner" role="status" hidden><span data-live-banner-text></span><a class="text-btn" href="#/settings" data-live-settings hidden>${icon('settings')}Ключ в Настройках</a></div><div class="home-intro"><div class="greeting-mark">${brandMark()}</div><h1 id="home-title">${name ? esc(name) + ', с чего начнём?' : 'Больше ясности. Меньше рутины.'}</h1><p>Поможем разобраться, найти слова и превратить идею в следующий шаг.</p></div><div class="assistant-strip" role="group" aria-label="Выбор помощника">${assistants.slice(0, 5).map(a => `<button class="assistant-chip tone-${a.tone} ${a.id === selected.id ? 'selected' : ''}" data-action="select-assistant" data-id="${a.id}" aria-pressed="${a.id === selected.id}">${icon(a.icon)}${esc(a.name)}</button>`).join('')}<a class="assistant-chip more" href="#/assistants" aria-label="Все помощники" title="Все помощники">${icon('grid')}</a></div>${composerMarkup()}${state.settings.showSuggestions ? `<div class="quick-heading"><h2>Немного вдохновения для старта</h2><button class="text-btn" data-action="shuffle-prompts">${icon('refresh')}Другой помощник</button></div><div class="quick-grid" id="quick-grid">${selected.prompts.map((p, i) => `<button class="quick-card tone-${selected.tone}" data-action="use-assistant-prompt" data-id="${selected.id}" data-index="${i}">${icon(quickIcons[i])}<strong>${esc(p.title)}</strong><span>${esc(p.text.length > 85 ? p.text.slice(0, 82) + '…' : p.text)}</span></button>`).join('')}</div>` : ''}<div class="studio-links" role="group" aria-label="Мастерские"><a class="studio-link" href="#/media"><span class="avatar tone-green">${icon('image')}</span><span class="studio-link-text"><strong>Изображения</strong><small>Фото и видео для контента · локальный мок</small></span>${icon('arrowRight')}</a><a class="studio-link" href="#/music"><span class="avatar tone-teal">${icon('music')}</span><span class="studio-link-text"><strong>Музыка</strong><small>Песня, инструментал или джингл · локальный мок</small></span>${icon('arrowRight')}</a></div><div class="home-bottom">${icon(chatLiveActive() ? 'route' : 'flask')}${chatLiveActive() ? 'Приватный live: отвечает ваша модель, история остаётся в этом браузере.' : 'Это демо: ответы сценарные, возможности интерфейса — настоящие.'}<button data-action="about">Подробнее</button></div></section>`;
    renderAttachments(); updateComposerState();
  }
  /* Catalogs */
  function pageHeader(eyebrow, title, description, action = '') { return `<div class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
  function renderAssistants() {
    main.innerHTML = `<section class="page" aria-label="Помощники">${pageHeader('Под задачу, а не наоборот', 'Один вопрос. Разные сильные стороны.', 'Выберите собеседника под то, что хотите сделать. Каждый помощник показывает свои примеры и подход к ответу.', '<button class="btn small" data-action="about">' + icon('info') + 'Как это работает</button>')}<div class="filter-bar"><div class="tabs" role="group" aria-label="Категории помощников">${[['all', 'Все помощники'], ['everyday', 'На каждый день'], ['work', 'Работа'], ['creative', 'Творчество'], ['learning', 'Обучение']].map(([id, label]) => `<button class="tab ${catalogFilter === id ? 'active' : ''}" data-action="filter-assistants" data-id="${id}" aria-pressed="${catalogFilter === id}">${label}</button>`).join('')}</div><label class="inline-search">${icon('search')}<input id="assistant-search" type="search" placeholder="Найти помощника" aria-label="Найти помощника" value="${esc(catalogQuery)}"></label></div><div class="assistant-grid" id="assistant-grid"></div><div class="catalog-note">${icon('flask')}<span>В демо помощники — разные сценарии общения, а не подключённые модели. Ответы подготовлены заранее; произвольный вопрос получит пример ответа по профилю помощника. Реальную модель можно подключить позже, сохранив интерфейс.</span></div></section>`;
    updateAssistantGrid();
  }
  function updateAssistantGrid() {
    const q = catalogQuery.toLowerCase().trim();
    const filtered = assistants.filter(a => (catalogFilter === 'all' || a.category === catalogFilter) && [a.name, a.description, ...a.skills].join(' ').toLowerCase().includes(q));
    $('#assistant-grid').innerHTML = filtered.length ? filtered.map(a => `<article class="assistant-card reveal tone-${a.tone} ${state.selectedAssistant === a.id ? 'selected' : ''}"><div class="assistant-card-top">${avatar(a, 'large')}<span class="card-label">${esc(a.label)}</span></div><h2>${esc(a.name)}</h2><p>${esc(a.description)}</p><div class="skill-list">${a.skills.map(s => `<span class="skill">${esc(s)}</span>`).join('')}</div><div class="assistant-card-actions"><button class="btn primary" data-action="start-assistant" data-id="${a.id}">${icon('plus')}Начать диалог</button><button class="icon-btn" data-action="assistant-details" data-id="${a.id}" aria-label="Подробнее: ${esc(a.name)}" title="Примеры и описание">${icon('arrowRight')}</button></div></article>`).join('') : emptyMarkup('search', 'Такого помощника пока нет', 'Попробуйте другую формулировку или сбросьте фильтр.', 'Сбросить фильтр', 'reset-assistants');
    setupReveals();
  }
  function renderPrompts() {
    const categories = ['Все', 'Избранные', ...new Set(promptLibrary.map(p => p.category))];
    main.innerHTML = `<section class="page" aria-label="Библиотека промптов">${pageHeader('Когда чистый лист — не помощник', 'Начните с хорошей отправной точки.', 'Готовые запросы можно попробовать как есть или изменить под себя. Нажмите «Использовать» — текст появится в поле сообщения.')}<div class="filter-bar"><div class="tabs" role="group" aria-label="Категории промптов">${categories.map(c => `<button class="tab ${promptFilter === c ? 'active' : ''}" data-action="filter-prompts" data-id="${esc(c)}" aria-pressed="${promptFilter === c}">${esc(c)}</button>`).join('')}</div><label class="inline-search">${icon('search')}<input id="prompt-search" type="search" placeholder="Поиск по библиотеке" aria-label="Поиск по библиотеке" value="${esc(promptQuery)}"></label></div><div class="prompt-grid" id="prompt-grid"></div></section>`;
    updatePromptGrid();
  }
  function updatePromptGrid() {
    const q = promptQuery.toLowerCase().trim();
    const filtered = promptLibrary.filter(p => (promptFilter === 'Все' || (promptFilter === 'Избранные' ? state.favoritePrompts.includes(p.id) : p.category === promptFilter)) && [p.title, p.description, p.text].join(' ').toLowerCase().includes(q));
    $('#prompt-grid').innerHTML = filtered.length ? filtered.map(p => { const a = assistant(p.assistant); const saved = state.favoritePrompts.includes(p.id); return `<article class="prompt-card reveal tone-${a.tone}"><div class="prompt-card-top"><span class="eyebrow">${esc(p.category)}</span><button class="icon-btn small ${saved ? 'active' : ''}" data-action="favorite-prompt" data-id="${p.id}" aria-label="${saved ? 'Убрать из избранного' : 'В избранное'}: ${esc(p.title)}" aria-pressed="${saved}">${icon('star')}</button></div><h2>${esc(p.title)}</h2><p>${esc(p.description)}</p><div class="prompt-card-bottom"><span class="prompt-author">${avatar(a, 'small')}${esc(a.name)}</span><button class="text-btn" data-action="use-prompt" data-id="${p.id}">Использовать ${icon('arrowRight')}</button></div></article>`; }).join('') : emptyMarkup(promptFilter === 'Избранные' ? 'star' : 'search', promptFilter === 'Избранные' ? 'Сохраните то, к чему захочется вернуться' : 'Ничего не нашлось', promptFilter === 'Избранные' ? 'Нажмите на звёздочку у промпта — он появится здесь.' : 'Попробуйте более короткий запрос или другую категорию.', 'Показать все промпты', 'reset-prompts');
    setupReveals();
  }
  function emptyMarkup(ic, title, text, button, action) { return `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${icon(ic)}</div><h2>${title}</h2><p>${text}</p>${button ? `<button class="btn primary" data-action="${action}">${button}${icon('arrowRight')}</button>` : ''}</div>`; }
  /* Conversations */
  function renderChat() {
    const chat = currentChat();
    if (!chat) { main.innerHTML = `<section class="page">${emptyMarkup('chat', 'Этот диалог не сохранён', 'Возможно, он был удалён, история отключена или ссылка открыта в другом браузере.', 'Начать новый диалог', 'new-chat')}</section>`; return; }
    const a = assistant(chat.assistantId);
    main.innerHTML = `<section class="chat-page" aria-label="${esc(chat.title)}"><div id="chat-live-banner" class="storage-banner live-mode-banner" role="status" hidden><span data-live-banner-text></span><a class="text-btn" href="#/settings" data-live-settings hidden>${icon('settings')}Ключ в Настройках</a></div><div class="chat-meta"><div class="chat-meta-left">${avatar(a, 'small')}<span>${esc(a.name)}</span><span class="badge">${chat.isExample ? 'Пример диалога' : 'Локальный диалог'}</span></div><div class="chat-meta-actions"><button class="icon-btn ${chat.favorite ? 'active' : ''}" data-action="favorite-chat" data-id="${esc(chat.id)}" aria-label="${chat.favorite ? 'Убрать диалог из избранного' : 'Диалог в избранное'}" aria-pressed="${chat.favorite}" title="Избранное">${icon('star')}</button><button class="icon-btn" data-action="rename-chat" data-id="${esc(chat.id)}" aria-label="Переименовать диалог" title="Переименовать">${icon('edit')}</button><button class="icon-btn" data-action="export-chat" data-id="${esc(chat.id)}" aria-label="Экспортировать диалог" title="Скачать Markdown">${icon('download')}</button><button class="icon-btn" data-action="delete-chat" data-id="${esc(chat.id)}" aria-label="Удалить диалог" title="Удалить">${icon('trash')}</button></div></div><div class="messages" id="messages" role="log" aria-label="Сообщения" aria-live="off">${chat.messages.map(m => messageMarkup(m, chat)).join('')}</div>${followupMarkup(chat)}<div class="chat-composer-wrap">${composerMarkup(chat)}<div class="chat-disclaimer">${chatLiveActive() ? 'Отвечает ваша модель через приватный туннель. Проверяйте важные факты.' : 'Сценарные ответы для проверки интерфейса. Не используйте демо для важных решений.'}</div></div></section>`;
    renderAttachments(); updateComposerState();
  }
  function messageMarkup(m, chat) {
    if (m.role === 'user') return `<article class="message user" data-message-id="${esc(m.id)}" aria-label="Ваше сообщение"><div><div class="user-bubble">${esc(m.content)}</div>${m.attachments?.length ? `<div class="attachment-list" style="margin-top:8px;justify-content:flex-end">${m.attachments.map(f => `<span class="attachment-chip" title="Демо-вложение, содержимое не читается">${icon('file')}<span class="attachment-name">${esc(f.name)}</span><span class="faint">${fileSize(f.size)}</span></span>`).join('')}</div>` : ''}</div></article>`;
    const a = assistant(m.assistantId || chat.assistantId);
    const last = chat.messages.at(-1)?.id === m.id;
    const streaming = activeStream?.messageId === m.id;
    const saved = state.saved.some(s => s.messageId === m.id && s.chatId === chat.id);
    const body = m.status === 'error' ? `<div class="message-error"><strong>${icon('alert')}Не удалось получить ответ</strong>${window.BRIIX_CHAT_LIVE?.errorNote(m) || '<p>Это демонстрационная ошибка. Сообщение сохранено — можно повторить запрос, ничего не вводя заново.</p>'}<button class="btn small" data-action="retry" data-id="${esc(m.id)}" ${last ? '' : 'disabled'}>${icon('refresh')}Попробовать снова</button></div>` : `${m.content ? `<div class="prose" data-prose-id="${esc(m.id)}">${markdown(m.content)}${streaming ? '<span class="streaming-caret" aria-hidden="true"></span>' : ''}</div>` : `<div class="typing"><span class="typing-dots"><i></i><i></i><i></i></span>Собираем мысль…</div>${chatLiveActive() ? '<p class="wait-line" data-wait data-wait-type="chat" aria-live="off"></p>' : ''}`}${m.status === 'stopped' ? `<div class="stopped-note">${icon('stop')}Вы остановили ответ. Можно продолжить вопросом или попробовать другой вариант.</div>` : ''}`;
    return `<article class="message assistant" data-message-id="${esc(m.id)}" aria-label="Ответ: ${esc(a.name)}">${avatar(a, 'small')}<div class="message-body"><div class="message-heading"><strong>${esc(a.name)}</strong>${window.BRIIX_CHAT_LIVE?.badge(m) || '<span class="badge">Демо-ответ</span>'}<time datetime="${new Date(m.createdAt).toISOString()}">${timeLabel(m.createdAt)}</time></div><div class="message-content">${body}</div>${window.BRIIX_CHAT_LIVE?.provenanceMarkup(m) || ''}${!streaming ? `<div class="message-actions"><button class="icon-btn" data-action="copy-message" data-id="${esc(m.id)}" aria-label="Скопировать ответ" title="Скопировать" ${m.status === 'error' ? 'disabled' : ''}>${icon('copy')}</button><button class="icon-btn ${saved ? 'active' : ''}" data-action="save-message" data-id="${esc(m.id)}" aria-label="${saved ? 'Убрать ответ из избранного' : 'Сохранить ответ'}" aria-pressed="${saved}" title="${saved ? 'Сохранено' : 'Сохранить ответ'}" ${m.status === 'error' ? 'disabled' : ''}>${icon('bookmark')}</button><span class="action-divider"></span><button class="icon-btn ${m.feedback === 'up' ? 'active' : ''}" data-action="feedback" data-id="${esc(m.id)}" data-value="up" aria-label="Хороший ответ" aria-pressed="${m.feedback === 'up'}" title="Хороший ответ" ${m.status === 'error' ? 'disabled' : ''}>${icon('thumbsUp')}</button><button class="icon-btn ${m.feedback === 'down' ? 'active' : ''}" data-action="feedback" data-id="${esc(m.id)}" data-value="down" aria-label="Ответ нужно улучшить" aria-pressed="${m.feedback === 'down'}" title="Нужно улучшить" ${m.status === 'error' ? 'disabled' : ''}>${icon('thumbsDown')}</button>${m.feedback ? '<span class="feedback-note">Отметка сохранена локально</span>' : ''}${last && !window.BRIIX_CHAT_LIVE?.provenanceFor(m.id)?.contentBlocked ? `<button class="text-btn" data-action="regenerate" data-id="${esc(m.id)}">${icon('refresh')}Другой вариант</button>` : ''}</div>` : `<div class="message-actions"><button class="text-btn" data-action="stop">${icon('stop')}Остановить</button></div>`}</div></article>`;
  }
  function followupMarkup(chat) {
    if (!state.settings.showSuggestions || activeStream || !chat.messages.length || chat.messages.at(-1).role !== 'assistant' || chat.messages.at(-1).status === 'error'
      || window.BRIIX_CHAT_LIVE?.provenanceFor(chat.messages.at(-1).id)?.contentBlocked) return '';
    return `<div class="followups" aria-label="Идеи для продолжения">${assistant(chat.assistantId).suggestions.map(s => `<button class="followup" data-action="followup" data-text="${esc(s)}">${esc(s)} ${icon('arrowRight')}</button>`).join('')}</div>`;
  }
  function refreshMessages(scroll = false) {
    const chat = currentChat(); if (!chat || !$('#messages')) return;
    const focused = document.activeElement;
    const focusKey = focused?.closest('#messages [data-action]') ? { action: focused.dataset.action, id: focused.dataset.id, value: focused.dataset.value } : null;
    $('#messages').innerHTML = chat.messages.map(m => messageMarkup(m, chat)).join('');
    if (focusKey) $$('#messages [data-action]').find(b => b.dataset.action === focusKey.action && b.dataset.id === focusKey.id && b.dataset.value === focusKey.value)?.focus({ preventScroll: true });
    const old = $('.followups'); if (old) old.remove();
    const wrap = $('.chat-composer-wrap'); if (wrap) wrap.insertAdjacentHTML('beforebegin', followupMarkup(chat));
    if (scroll) scrollToBottom();
  }
  function scrollToBottom(force = false) {
    if (route().page !== 'chat') return;
    const distance = main.scrollHeight - main.scrollTop - main.clientHeight;
    if (force || distance < 260) main.scrollTop = main.scrollHeight;
  }
  function updateSendButton() {
    const button = $('#send-button'); if (!button) return;
    const running = activeStream && activeStream.chatId === currentChat()?.id;
    button.dataset.action = running ? 'stop' : 'send'; button.setAttribute('aria-label', running ? 'Остановить ответ' : 'Отправить сообщение'); button.title = running ? 'Остановить ответ' : 'Отправить сообщение'; button.innerHTML = icon(running ? 'stop' : 'arrowUp');
    $$('[data-action="attach"], [data-action="attach-example"]').forEach(b => b.disabled = !!running);
    updateComposerState();
  }
  function sendMessage() {
    if (activeStream || pendingSend) { toast('Дождитесь ответа или остановите его.', 'error'); return; }
    const input = $('#prompt-input'); if (!input) return;
    const text = input.value.trim(); if (!text && !pendingAttachments.length) return;
    if (text.length > MAX_CHARS) { toast('Сообщение слишком длинное. Сократите его до 12 000 символов.', 'error'); return; }
    let chat = currentChat();
    const content = text || 'Посмотри вложения и предложи, с чего начать.';
    if (!chat) {
      chat = { id: uid('chat'), title: content.replace(/\s+/g, ' ').slice(0, 48) + (content.length > 48 ? '…' : ''), assistantId: state.selectedAssistant, messages: [], createdAt: Date.now(), updatedAt: Date.now(), favorite: false, isExample: false };
      if (state.settings.saveHistory) state.chats.unshift(chat);
      else { chat.ephemeral = true; state.chats.unshift(chat); }
      state.drafts[chat.id] = '';
    }
    chat.isExample = false;
    const user = { id: uid('msg'), role: 'user', content, createdAt: Date.now(), attachments: [...pendingAttachments] };
    chat.messages.push(user); chat.updatedAt = Date.now();
    pendingAttachments = []; state.drafts[draftKey()] = ''; clearTimeout(draftTimer); draftTimer = null;
    input.value = ''; pendingSend = true; persist(); navigate('chat/' + chat.id);
    requestAnimationFrame(() => { pendingSend = false; if (state.chats.includes(chat) && !activeStream) startResponse(chat, content, 0); });
  }
  function startResponse(chat, prompt, variant = 0, existing = null) {
    if (activeStream) return;
    const result = makeResponse(chat.assistantId, prompt, variant);
    const message = existing || { id: uid('msg'), role: 'assistant', assistantId: chat.assistantId, content: '', createdAt: Date.now(), status: 'streaming', variant, feedback: null };
    message.content = ''; message.status = 'streaming'; message.variant = variant; message.feedback = null;
    if (!existing) chat.messages.push(message);
    chat.updatedAt = Date.now();
    const fail = state.settings.simulateErrors;
    const attachmentNote = chat.messages.filter(m => m.role === 'user').at(-1)?.attachments?.length ? '> В этом демо вложения — заглушки: я вижу только их названия, но не содержимое.\n\n' : '';
    const fullText = attachmentNote + result.text;
    const stream = { chatId: chat.id, messageId: message.id, timer: null, index: 0, cancelled: false };
    activeStream = stream;
    persist(); renderSidebar(); if (route().page === 'chat' && route().id === chat.id) { refreshMessages(true); updateSendButton(); }
    const finish = (status) => {
      if (stream.cancelled) return;
      clearTimeout(stream.timer); message.status = status; stream.cancelled = true; activeStream = null;
      chat.updatedAt = Date.now(); if (fail && status !== 'stopped') { state.settings.simulateErrors = false; }
      persist(); renderSidebar();
      if (route().page === 'chat' && route().id === chat.id) { refreshMessages(); updateSendButton(); }
      if (route().page === 'settings') renderSettings();
      announce(status === 'complete' ? 'Демо-ответ готов.' : status === 'stopped' ? 'Ответ остановлен.' : 'Демонстрационная ошибка. Доступен повтор.');
    };
    if (chatLiveActive()) {
      stream.abort = window.BRIIX_CHAT_LIVE.respond({
        chat, message, prompt,
        onChunk: () => { if (route().page === 'chat' && route().id === chat.id) { refreshMessages(); scrollToBottom(); } },
        onFinish: status => finish(status),
        persist: () => persist()
      });
      return;
    }
    if (!state.settings.streaming || reducedMotion.matches) {
      stream.timer = setTimeout(() => { if (fail) { message.content = ''; finish('error'); return; } message.content = fullText; finish('complete'); }, 350); return;
    }
    stream.timer = setTimeout(() => {
      if (fail) { finish('error'); return; }
      const tick = () => {
        if (stream.cancelled) return;
        stream.index = Math.min(fullText.length, stream.index + 18 + Math.floor(Math.random() * 14));
        message.content = fullText.slice(0, stream.index);
        const nearBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 220;
        const visibleContent = message.status === 'error' ? '' : message.content;
        if (route().page === 'chat' && route().id === chat.id) {
          const holder = $(`[data-message-id="${message.id}"] .message-content`);
          if (holder) holder.innerHTML = `<div class="prose" data-prose-id="${message.id}">${markdown(visibleContent)}<span class="streaming-caret" aria-hidden="true"></span></div>`;
          if (nearBottom) scrollToBottom(true);
        }
        if (stream.index >= fullText.length) finish('complete'); else stream.timer = setTimeout(tick, 28);
      }; tick();
    }, 450);
  }
  function stopResponse() {
    if (!activeStream) return;
    const stream = activeStream; const chat = state.chats.find(c => c.id === stream.chatId); const message = chat?.messages.find(m => m.id === stream.messageId);
    clearTimeout(stream.timer); stream.abort?.(); stream.cancelled = true; activeStream = null;
    if (message) { message.status = 'stopped'; if (!message.content) message.content = 'Ответ остановлен до начала генерации. Попробуйте снова или задайте другой вопрос.'; }
    persist(); renderSidebar(); if (route().page === 'chat') { refreshMessages(); updateSendButton(); } announce('Ответ остановлен.');
  }
  function retryMessage(id, another = false) {
    if (activeStream) { toast('Сначала остановите текущий ответ.', 'error'); return; }
    const chat = currentChat(); if (!chat) return;
    const index = chat.messages.findIndex(m => m.id === id); const message = chat.messages[index]; if (!message || message.role !== 'assistant') return;
    const previous = [...chat.messages.slice(0, index)].reverse().find(m => m.role === 'user'); if (!previous) return;
    if (!another && index !== chat.messages.length - 1) return;
    const variant = Number.isSafeInteger(message.variant) ? message.variant : 0;
    if (another && variant >= 10000) { toast('Достигнут лимит вариантов ответа.', 'error'); return; }
    if (another) { chat.messages = chat.messages.slice(0, index); }
    startResponse(chat, previous.content, another ? variant + 1 : variant, another ? null : message);
  }
  function announce(text) { let el = $('#stream-announcement'); if (!el) { el = document.createElement('div'); el.id = 'stream-announcement'; el.className = 'sr-only'; el.setAttribute('role', 'status'); document.body.append(el); } el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); }
  /* Markdown: escape first, then only emit known tags. No raw HTML or remote links. */
  function inline(text) { return esc(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
  function markdown(source) {
    const lines = String(source).replace(/\r/g, '').split('\n'); let html = ''; let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (line.startsWith('```')) {
        const language = line.slice(3).trim().replace(/[^\w-]/g, '') || 'code'; const code = []; i++;
        while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
        if (i < lines.length) i++;
        const raw = code.join('\n');
        html += `<div class="code-block"><div class="code-head"><span>${esc(language)}</span><button data-action="copy-code" data-code="${esc(encodeURIComponent(raw))}" aria-label="Скопировать код">${icon('copy')}Копировать</button></div><pre><code>${esc(raw)}</code></pre></div>`; continue;
      }
      if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
        const cells = l => l.split('|').slice(1, -1).map(c => c.trim());
        const headers = cells(line); i += 2; let body = '';
        while (i < lines.length && lines[i].startsWith('|')) { body += '<tr>' + cells(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++; }
        html += '<div class="table-scroll"><table><thead><tr>' + headers.map(c => `<th scope="col">${inline(c)}</th>`).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>'; continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) { const tag = heading[1].length === 1 ? 'h2' : heading[1].length === 2 ? 'h2' : 'h3'; html += `<${tag}>${inline(heading[2])}</${tag}>`; i++; continue; }
      if (line.startsWith('> ')) { const quote = []; while (i < lines.length && lines[i].startsWith('> ')) quote.push(lines[i++].slice(2)); html += `<blockquote>${quote.map(inline).join('<br>')}</blockquote>`; continue; }
      if (/^[-*] /.test(line) || /^\d+\. /.test(line)) {
        const ordered = /^\d+\. /.test(line); const tag = ordered ? 'ol' : 'ul'; const items = [];
        while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]) : /^[-*] /.test(lines[i]))) items.push(lines[i++].replace(/^(\d+\. |[-*] )/, ''));
        html += `<${tag}>${items.map(item => `<li>${inline(item)}</li>`).join('')}</${tag}>`; continue;
      }
      const paragraph = [line]; i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,3} |```|> |[-*] |\d+\. |\|)/.test(lines[i])) paragraph.push(lines[i++]);
      html += `<p>${paragraph.map(inline).join('<br>')}</p>`;
    }
    return html;
  }
  /* Favorites */
  function renderFavorites() {
    const chats = state.chats.filter(c => c.favorite); const prompts = promptLibrary.filter(p => state.favoritePrompts.includes(p.id));
    main.innerHTML = `<section class="page" aria-label="Избранное">${pageHeader('К хорошему стоит возвращаться', 'Всё удачное — под рукой.', 'Любимые диалоги, сохранённые ответы и промпты. Ничего не теряется среди новых задач.')}<div class="filter-bar"><div class="tabs" role="group" aria-label="Тип избранного">${[['chats', 'Диалоги', chats.length], ['answers', 'Ответы', state.saved.length], ['prompts', 'Промпты', prompts.length]].map(([id, label, count]) => `<button class="tab ${favoriteFilter === id ? 'active' : ''}" data-action="filter-favorites" data-id="${id}" aria-pressed="${favoriteFilter === id}">${label} <span class="faint">${count}</span></button>`).join('')}</div></div><div class="saved-list">${favoriteFilter === 'chats' ? chats.length ? chats.map(c => savedChatMarkup(c)).join('') : emptyMarkup('star', 'Здесь будут любимые диалоги', 'Нажмите на звёздочку рядом с названием диалога, чтобы вернуться к нему в один клик.', 'Начать диалог', 'new-chat') : favoriteFilter === 'answers' ? state.saved.length ? state.saved.map(s => savedAnswerMarkup(s)).join('') : emptyMarkup('bookmark', 'Сохраните удачную мысль', 'Под ответом помощника нажмите на закладку. Ответ появится здесь, даже если вы начнёте новый диалог.', 'Открыть пример диалога', 'open-example') : prompts.length ? prompts.map(p => `<article class="saved-card tone-${assistant(p.assistant).tone}">${avatar(assistant(p.assistant))}<div class="saved-card-body"><h2>${esc(p.title)}</h2><p>${esc(p.text)}</p><button class="text-btn" data-action="use-prompt" data-id="${p.id}">Использовать ${icon('arrowRight')}</button></div><button class="icon-btn active" data-action="favorite-prompt" data-id="${p.id}" aria-label="Убрать промпт из избранного">${icon('star')}</button></article>`).join('') : emptyMarkup('library', 'Соберите свою отправную точку', 'Отмечайте звёздочкой промпты в библиотеке — они будут ждать вас здесь.', 'Открыть библиотеку', 'open-prompts')}</div></section>`;
  }
  function savedChatMarkup(c) { const a = assistant(c.assistantId); const last = c.messages.findLast(m => m.role === 'assistant'); return `<article class="saved-card tone-${a.tone}">${avatar(a)}<div class="saved-card-body"><h2><a href="#/chat/${esc(c.id)}">${esc(c.title)}</a></h2><p>${esc(last?.content.replace(/[#*>|`]/g, '').slice(0, 190) || 'Диалог без ответов')}</p><div class="saved-card-meta"><span>${esc(a.name)}</span><span>·</span><span>${dateLabel(c.updatedAt)}</span><span>·</span><span>${c.messages.length} сообщений</span></div></div><div class="saved-card-actions"><a class="icon-btn" href="#/chat/${esc(c.id)}" aria-label="Открыть диалог" title="Открыть">${icon('arrowRight')}</a><button class="icon-btn active" data-action="favorite-chat" data-id="${esc(c.id)}" aria-label="Убрать диалог из избранного">${icon('star')}</button></div></article>`; }
  function savedAnswerMarkup(s) { const a = assistant(s.assistantId); return `<article class="saved-card tone-${a.tone}">${avatar(a)}<div class="saved-card-body"><h2>${esc(s.title)}</h2><p>${esc(s.content.replace(/[#*>|`]/g, '').slice(0, 220))}</p><div class="saved-card-meta"><span>${esc(a.name)}</span><span>·</span><span>${dateLabel(s.createdAt)}</span><button class="text-btn" data-action="view-saved" data-id="${esc(s.id)}">Читать ответ ${icon('arrowRight')}</button></div></div><div class="saved-card-actions"><button class="icon-btn" data-action="copy-saved" data-id="${esc(s.id)}" aria-label="Скопировать сохранённый ответ">${icon('copy')}</button><button class="icon-btn active" data-action="remove-saved" data-id="${esc(s.id)}" aria-label="Убрать ответ из избранного">${icon('bookmark')}</button></div></article>`; }
  function toggleFavoriteChat(id) { const c = state.chats.find(c => c.id === id); if (!c) return; c.favorite = !c.favorite; persist(); renderSidebar(); render(); toast(c.favorite ? 'Диалог добавлен в избранное' : 'Диалог убран из избранного'); }
  function toggleSavedMessage(id) {
    const chat = currentChat(); const m = chat?.messages.find(m => m.id === id); if (!m || m.role !== 'assistant') return;
    const index = state.saved.findIndex(s => s.chatId === chat.id && s.messageId === id);
    if (index >= 0) state.saved.splice(index, 1);
    else state.saved.unshift({ id: uid('saved'), chatId: chat.id, messageId: id, title: chat.title, content: m.content, assistantId: m.assistantId, createdAt: Date.now() });
    persist(); renderSidebar(); refreshMessages(); toast(index >= 0 ? 'Ответ убран из избранного' : 'Ответ сохранён в избранном');
  }
  /* Settings */
  function settingToggle(key, label, help) { return `<div class="setting-row"><div><div class="setting-label" id="label-${key}">${label}</div><div class="setting-help">${help}</div></div><label class="switch"><input type="checkbox" data-setting="${key}" aria-labelledby="label-${key}" ${state.settings[key] ? 'checked' : ''}><span class="switch-track"></span></label></div>`; }
  function settingSelect(key, label, help, options) { return `<div class="setting-row"><div><label class="setting-label" for="setting-${key}">${label}</label><div class="setting-help">${help}</div></div><select id="setting-${key}" data-setting="${key}">${options.map(([value, text]) => `<option value="${value}" ${state.settings[key] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`; }
  function renderSettings() {
    const focusId = document.activeElement?.id;
    const bytes = new Blob([JSON.stringify(state)]).size;
    main.innerHTML = `<section class="page" aria-label="Настройки">${pageHeader('По вашим привычкам', 'Пусть пространство будет вашим.', 'Настройки применяются сразу и сохраняются в этом браузере. Здесь нет скрытых платных функций или обязательной регистрации.')}<div class="settings-layout"><nav class="settings-nav" aria-label="Разделы настроек"><a href="#settings-appearance" data-action="settings-anchor" data-id="settings-appearance">Внешний вид</a><a href="#settings-behavior" data-action="settings-anchor" data-id="settings-behavior">Поведение</a><a href="#settings-profile" data-action="settings-anchor" data-id="settings-profile">Профиль</a><a href="#settings-stand" data-action="settings-anchor" data-id="settings-stand">Ключ стенда</a><a href="#settings-data" data-action="settings-anchor" data-id="settings-data">Данные и демо</a></nav><div>
      <section class="settings-section reveal" id="settings-appearance"><h2>Внешний вид</h2><p>Комфорт прежде всего — особенно в длинном диалоге.</p><div class="settings-card"><div class="setting-row"><div><div class="setting-label">Тема оформления</div><div class="setting-help">Светлая, тёмная или как в системе.</div></div><div class="theme-options" role="group" aria-label="Тема оформления">${[['light', 'sun', 'Светлая'], ['dark', 'moon', 'Тёмная'], ['system', 'monitor', 'Система']].map(([id, ic, label]) => `<button class="theme-option ${state.settings.theme === id ? 'active' : ''}" data-action="set-theme" data-id="${id}" aria-pressed="${state.settings.theme === id}">${icon(ic)}${label}</button>`).join('')}</div></div>${settingSelect('fontSize', 'Размер текста ответов', 'Чуть крупнее, если хочется читать спокойнее.', [['normal', 'Обычный'], ['large', 'Крупный']])}${settingSelect('density', 'Плотность диалога', 'Расстояние между сообщениями.', [['comfortable', 'Свободная'], ['compact', 'Компактная']])}</div></section>
      <section class="settings-section reveal" id="settings-behavior"><h2>Поведение</h2><p>Небольшие детали, которые убирают лишние движения.</p><div class="settings-card">${settingSelect('defaultAssistant', 'Помощник по умолчанию', 'С кого начинать новый диалог.', assistants.map(a => [a.id, esc(a.name)]))}${settingToggle('enterToSend', 'Отправлять по Enter', 'Shift Enter всегда переносит строку. Если выключено — отправлять по Ctrl / ⌘ Enter.')}${settingToggle('showSuggestions', 'Показывать идеи для старта', 'Примеры на главной и вопросы для продолжения диалога.')}${settingToggle('streaming', 'Постепенное появление ответа', 'Имитация потока. При системном уменьшении движения ответ появляется сразу.')}</div></section>
      <section class="settings-section reveal" id="settings-profile"><h2>Локальный профиль</h2><p>Это не аккаунт. Имя нужно только для приветствия.</p><div class="settings-card"><div class="setting-row"><div><label class="setting-label" for="setting-name">Как к вам обращаться</label><div class="setting-help">Останется на этом устройстве. Можно оставить пустым.</div></div><input type="text" id="setting-name" data-setting="name" maxlength="40" placeholder="Например, Саша" value="${esc(state.settings.name)}"></div></div></section>
      ${standSection()}
      <section class="settings-section reveal" id="settings-data"><h2>Данные и демо</h2><p>Всё под вашим контролем. Экспортируйте копию перед очисткой браузера.</p><div class="settings-card">${settingToggle('saveHistory', 'Сохранять историю диалогов', 'Если выключить, новые диалоги не сохраняются после перезагрузки. Уже сохранённые остаются, пока вы их не удалите.')}${settingToggle('simulateErrors', 'Ошибка в следующем ответе', 'Проверить состояние ошибки и повтор. Сработает один раз, затем выключится автоматически.')}<div class="setting-row"><div style="flex:1"><div class="setting-label">Локальное хранилище</div><div class="setting-help">${state.chats.length} диалогов · ${state.saved.length} сохранённых ответов · ${storageProtected ? 'исходные данные защищены, работа в памяти' : storageAvailable ? 'доступно' : 'недоступно, работа в памяти'}</div><div class="storage-meter"><span style="width:${Math.min(100, bytes / (5 * 1024 * 1024) * 100)}%"></span></div><div class="storage-caption"><span>${(bytes / 1024).toFixed(1)} КБ данных</span><span>Ориентир браузера: ~5 МБ</span></div><div class="data-actions"><button class="btn small" data-action="export-all">${icon('download')}Экспорт JSON</button><button class="btn small" data-action="import-all">${icon('upload')}Импорт JSON</button></div></div></div><div class="setting-row"><div><div class="setting-label">Начать с чистого листа</div><div class="setting-help">Удалить диалоги, избранное и черновики. Настройки останутся.</div></div><button class="btn small danger" data-action="clear-data">${icon('trash')}Очистить</button></div><div class="setting-row"><div><div class="setting-label">Вернуть начальное демо</div><div class="setting-help">Три примера диалогов и настройки по умолчанию.</div></div><button class="btn small" data-action="reset-demo">${icon('refresh')}Сбросить</button></div></div></section>
      <footer class="settings-footer"><span>BRIIX · UI-демо 2.0 · без backend</span><button class="text-btn" data-action="about">Что работает, а что имитируется ${icon('arrowRight')}</button></footer>
    </div></div></section>`;
    setupReveals(); updateSettingsSpy();
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  function changeSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    state.settings[key] = value;
    if (key === 'defaultAssistant') state.selectedAssistant = value;
    persist(); applySettings(); renderSidebar();
    if (key === 'theme') renderTopbar();
    if (['theme', 'fontSize', 'density', 'defaultAssistant'].includes(key) && route().page === 'settings') renderSettings();
    if (key === 'saveHistory') toast(value ? 'Новые диалоги будут сохраняться.' : 'Новые диалоги будут жить только до перезагрузки.');
    if (key === 'simulateErrors') toast(value ? 'Следующий ответ покажет демонстрационную ошибку.' : 'Ошибки выключены.');
  }
  function durableState() { return { ...state, chats: state.chats.filter(c => !c.ephemeral), drafts: Object.fromEntries(Object.entries(state.drafts).filter(([key]) => !state.chats.some(c => c.ephemeral && c.id === key))) }; }
  function exportAll() { download('briix-demo-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(durableState(), null, 2), 'application/json'); toast('Резервная копия подготовлена'); }
  function exportChat(id) {
    const c = state.chats.find(c => c.id === id); if (!c) return;
    const text = '# ' + c.title + '\n\nПомощник: ' + assistant(c.assistantId).name + '\nРежим: локальное демо, сценарные ответы\n\n' + c.messages.map(m => '## ' + (m.role === 'user' ? 'Вы' : assistant(m.assistantId).name) + '\n\n' + (m.status === 'error' ? '[Демонстрационная ошибка]' : m.content) + (m.attachments?.length ? '\n\nВложения-заглушки: ' + m.attachments.map(f => f.name).join(', ') : '')).join('\n\n---\n\n');
    download('briix-' + c.id.slice(0, 30) + '.md', text, 'text/markdown;charset=utf-8'); toast('Диалог экспортирован в Markdown');
  }
  async function importAll(file) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast('Копия больше 3 МБ. Для этого демо нужен файл поменьше.', 'error'); return; }
    try {
      const imported = validateState(JSON.parse(await file.text()));
      openModal('Заменить данные из копии?', `<p>В копии: <strong>${imported.chats.length} диалогов</strong>, <strong>${imported.saved.length} сохранённых ответов</strong>. Текущие данные будут заменены. Перед импортом можно скачать текущую копию.</p>`, [{ label: 'Отмена', action: closeModal }, { label: 'Скачать текущую копию', action: exportAll }, { label: 'Импортировать', primary: true, action: () => { if (activeStream) stopResponse(); state = imported; pendingAttachments = []; pendingSend = false; storageAvailable = true; storageProtected = false; storageWarning = ''; persist(); applySettings(); closeModal(); navigate('home'); toast('Копия импортирована'); } }]);
    } catch (error) { toast('Не удалось импортировать: ' + (error instanceof SyntaxError ? 'файл не является корректным JSON.' : error.message), 'error'); }
  }
  /* Modals */
  function openModal(title, body, actions = [], wide = false) {
    const version = ++modalVersion;
    if (!modal.open) modalReturnFocus = document.activeElement;
    modal.classList.toggle('wide', wide);
    modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="Закрыть окно">${icon('close')}</button></div><div class="modal-body">${body}</div>${actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-modal-action="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
    $$('[data-modal-action]', modal).forEach(button => button.addEventListener('click', () => actions[Number(button.dataset.modalAction)].action()));
    if (!modal.open) modal.showModal();
    requestAnimationFrame(() => { if (!modal.open || version !== modalVersion) return; const input = $('input:not([type=checkbox]), textarea:not([readonly])', modal); if (input) { input.focus(); if (input.select) input.select(); } else $('.modal-head button', modal)?.focus(); });
  }
  function closeModal() { if (modal.open) modal.close(); }
  function chooseAssistant() {
    const chat = currentChat(); const selected = chat?.assistantId || state.selectedAssistant;
    openModal('Кто поможет сегодня?', `<p>У каждого помощника свои примеры и тон ответа. В демо это сценарии, не разные модели.</p>${assistants.map(a => `<button class="assistant-option tone-${a.tone} ${selected === a.id ? 'selected' : ''}" data-action="modal-select-assistant" data-id="${a.id}">${avatar(a)}<span class="assistant-option-text"><strong>${esc(a.name)}</strong><span>${esc(a.short)}</span></span>${selected === a.id ? icon('check') : icon('chevronRight')}</button>`).join('')}`, [{ label: 'Все помощники', action: () => { closeModal(); navigate('assistants'); } }]);
  }
  function selectAssistant(id) {
    const a = assistant(id); const chat = currentChat();
    if (chat) { chat.assistantId = a.id; } else state.selectedAssistant = id;
    persist(); closeModal(); renderSidebar(); render(); toast('Теперь помогает: ' + a.name);
  }
  function assistantDetails(id) {
    const a = assistant(id);
    openModal('Знакомьтесь, ' + a.name.toLowerCase(), `<div class="modal-detail-top tone-${a.tone}">${avatar(a, 'large')}<div><h3>${esc(a.name)}</h3><p>${esc(a.short)}</p></div></div><p>${esc(a.description)}</p><div class="skill-list tone-${a.tone}">${a.skills.map(s => `<span class="skill">${esc(s)}</span>`).join('')}</div><div class="eyebrow" style="margin-top:22px">Попробуйте на примере</div><div class="detail-prompts">${a.prompts.map((p, i) => `<button class="detail-prompt" data-action="use-assistant-prompt" data-id="${a.id}" data-index="${i}"><span>${esc(p.title)}</span>${icon('arrowRight')}</button>`).join('')}</div><div class="catalog-note">${icon('flask')}<span>Ответы сценарные. Помощник не подключён к модели и не выполняет действия во внешних сервисах.</span></div>`, [{ label: 'Закрыть', action: closeModal }, { label: 'Начать диалог', primary: true, action: () => { state.selectedAssistant = a.id; closeModal(); navigate('home'); requestAnimationFrame(() => $('#prompt-input')?.focus()); } }]);
  }
  function about() {
    openModal('Место для идей. Пока — демо.', `<p>Это интерактивный прототип пользовательского опыта BRIIX. Можно исследовать весь интерфейс без регистрации и backend.</p><div class="about-grid"><div class="about-item">${icon('check')}<div><strong>Работает по-настоящему</strong><p>Выбор помощника, диалоги, поиск, история, избранное, экспорт, настройки, тёмная тема и мобильная версия. Данные сохраняются в вашем браузере.</p></div></div><div class="about-item">${icon('flask')}<div><strong>Имитируется честно</strong><p>Ответы — заранее подготовленные сценарии, а не работа нейросети. Раздел «Изображения» использует локальные картинки и анимации, а «Музыка» — синтезированную в браузере звуковую заглушку без вокала. Это не inference. Знакомые примеры раскрываются подробно; на другой текст помощник даёт демонстрационный ответ своего профиля.</p></div></div><div class="about-item">${icon('paperclip')}<div><strong>Файлы — визуальные заглушки</strong><p>Сохраняются только имя, тип и размер. Содержимое не читается, никуда не загружается и не анализируется.</p></div></div><div class="about-item">${icon('shield')}<div><strong>Локально не значит навсегда</strong><p>Очистка данных браузера удалит историю. Для переноса или резервной копии используйте экспорт JSON в настройках. Не вводите чувствительные данные на общем устройстве.</p></div></div></div><div class="eyebrow" style="margin-top:20px">Вопросы о демо</div><div class="faq-list">${faqItem('model', 'Это настоящая нейросеть?', 'Нет. Ответы заранее подготовлены под примеры и профили помощников. Так можно проверять интерфейс, не подключая модель и не отправляя данные наружу.')}${faqItem('storage', 'Куда сохраняются диалоги?', 'Только в localStorage этого браузера. На другом устройстве или после очистки данных браузера история не появится. Для переноса есть экспорт и импорт JSON в настройках.')}${faqItem('files', 'Что происходит с файлами?', 'Это визуальные заглушки. Сохраняются имя, тип и размер, чтобы проверить интерфейс вложений. Содержимое не читается, не анализируется и не загружается на сервер.')}${faqItem('policy', 'Есть ли проверка контента?', 'Генерации проходят проверку контента: без порнографии. Художественная нагота — допустима. Если запрос не проходит, сервер объясняет причину: измените формулировку и отправьте снова — это не сбой сервиса.')}${faqItem('backend', 'Можно ли потом подключить backend?', 'Да. Экраны, состояние и сценарные ответы отделены друг от друга. Позже сценарный генератор можно заменить реальным API, сохранив пользовательский интерфейс.')}</div>`, [{ label: 'Понятно, попробуем', primary: true, action: closeModal }], true);
  }
  function shortcuts() {
    openModal('Меньше кликов, больше мысли', `<p>Работает на macOS, Windows и Linux. Вместо ⌘ можно использовать Ctrl.</p>${[['Поиск по пространству', isMac ? '⌘ K' : 'Ctrl K'], ['Новый диалог', isMac ? '⌘ ⇧ O' : 'Ctrl ⇧ O'], ['Отправить сообщение', state.settings.enterToSend ? 'Enter' : (isMac ? '⌘ Enter' : 'Ctrl Enter')], ['Перенести строку', 'Shift Enter'], ['Закрыть окно или меню', 'Esc'], ['Перейти по результатам поиска', '↑ / ↓ / Enter']].map(([label, keys]) => `<div class="shortcut-row"><span>${label}</span><kbd>${keys}</kbd></div>`).join('')}<div class="catalog-note">${icon('info')}<span>Настройки отправки можно поменять в разделе «Поведение». На телефоне используйте кнопку со стрелкой.</span></div>`, [{ label: 'Открыть настройки', action: () => { closeModal(); navigate('settings'); } }, { label: 'Закрыть', primary: true, action: closeModal }]);
  }
  function renameChat(id) {
    const c = state.chats.find(c => c.id === id); if (!c) return;
    openModal('Название, по которому легко найти', `<label class="modal-field" for="rename-input">Название диалога</label><input class="modal-input" id="rename-input" maxlength="80" value="${esc(c.title)}">`, [{ label: 'Отмена', action: closeModal }, { label: 'Сохранить', primary: true, action: () => { const value = $('#rename-input').value.trim(); if (!value) { $('#rename-input').setCustomValidity('Добавьте название'); $('#rename-input').reportValidity(); return; } c.title = value; state.saved.forEach(s => { if (s.chatId === id) s.title = value; }); persist(); closeModal(); renderSidebar(); renderTopbar(); if (route().page === 'favorites') renderFavorites(); toast('Название обновлено'); } }]);
    $('#rename-input').addEventListener('input', e => e.target.setCustomValidity(''));
    $('#rename-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-modal-action="1"]', modal).click(); } });
  }
  function confirmDeleteChat(id) {
    const c = state.chats.find(c => c.id === id); if (!c) return;
    openModal('Удалить этот диалог?', `<p>«${esc(c.title)}» будет удалён из истории. Сохранённые отдельно ответы останутся в избранном. Действие нельзя отменить.</p>`, [{ label: 'Оставить', action: closeModal }, { label: 'Удалить диалог', danger: true, action: () => { if (activeStream?.chatId === id) stopResponse(); state.chats = state.chats.filter(c => c.id !== id); delete state.drafts[id]; storageAvailable = true; persist(); closeModal(); navigate('home'); toast('Диалог удалён'); } }]);
  }
  /* Search */
  function openSearch() {
    if (modal.open) closeModal(); closeSidebar(false); searchReturnFocus = document.activeElement; searchQuery = '';
    searchModal.innerHTML = `<div class="search-input-row">${icon('search')}<input id="global-search" type="search" autocomplete="off" placeholder="Диалоги, помощники, промпты, изображения, музыка…" aria-label="Поиск по диалогам, помощникам, промптам, изображениям и музыке" aria-controls="search-results"><button class="icon-btn small" data-action="close-search" aria-label="Закрыть поиск">${icon('close')}</button></div><div class="search-results" id="search-results"></div><div class="search-footer"><span>↑ ↓ — выбрать · Enter — открыть</span><span>Esc — закрыть</span></div>`;
    updateSearchResults(); if (!searchModal.open) searchModal.showModal(); $('#global-search').focus();
  }
  function closeSearch() { if (searchModal.open) searchModal.close(); }
  function updateSearchResults() {
    const q = searchQuery.trim().toLowerCase();
    const chats = state.chats.filter(c => !q || (c.title + ' ' + c.messages.map(m => m.content).join(' ')).toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
    const people = assistants.filter(a => !q || (a.name + ' ' + a.description + ' ' + a.skills.join(' ')).toLowerCase().includes(q)).slice(0, q ? 6 : 3);
    const prompts = q ? promptLibrary.filter(p => (p.title + ' ' + p.description + ' ' + p.text).toLowerCase().includes(q)).slice(0, 5) : [];
    const group = (label, rows) => rows.length ? `<div class="search-group-label">${label}</div>${rows.join('')}` : '';
    const result = (action, id, ic, title, subtitle) => `<button class="search-result" data-action="${action}" data-id="${esc(id)}">${icon(ic)}<span class="search-result-text"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></span>${icon('arrowRight')}</button>`;
    const media = !q || 'изображения медиа-студия медиа фото видео картинки генерация контент'.includes(q) ? [result('search-media', '', 'image', 'Изображения', 'Фото, видео и рецепты · локальный мок')] : [];
    const music = !q || 'музыка песни песня вокал инструментал джингл трек звук музыкальный'.includes(q) ? [result('search-music', '', 'music', 'Музыка', 'Песни, инструменталы и джинглы · локальный мок')] : [];
    $('#search-results').innerHTML = chats.length || people.length || prompts.length || media.length || music.length ? group('Разделы', media.concat(music)) + group('Диалоги', chats.map(c => result('search-chat', c.id, 'chat', c.title, assistant(c.assistantId).name + ' · ' + dateLabel(c.updatedAt)))) + group('Помощники', people.map(a => result('search-assistant', a.id, a.icon, a.name, a.short))) + group('Промпты', prompts.map(p => result('use-prompt', p.id, 'library', p.title, p.category + ' · ' + assistant(p.assistant).name))) : `<div class="search-empty">По запросу «${esc(searchQuery)}» ничего нет.<br><span class="faint">Попробуйте «план», «письмо» или «код».</span></div>`;
  }
  /* Patterns reused from site/: reveal on scroll, sticky header shadow, settings scroll-spy */
  function setupReveals() {
    if (revealObserver) revealObserver.disconnect();
    const els = $$('.reveal:not(.in)', main);
    if (reducedMotion.matches || !('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('in')); return; }
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); } });
    }, { root: main, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
    els.forEach(el => revealObserver.observe(el));
  }
  function updateTopbarShadow() { $('#topbar').classList.toggle('scrolled', main.scrollTop > 8); }
  function updateSettingsSpy() {
    const links = $$('.settings-nav a'); const sections = $$('.settings-section');
    if (!links.length || !sections.length) return;
    const offset = main.getBoundingClientRect().top + 130;
    let current = sections[0].id;
    for (const sec of sections) if (sec.getBoundingClientRect().top <= offset) current = sec.id;
    if (main.scrollHeight > main.clientHeight + 4 && main.scrollTop + main.clientHeight >= main.scrollHeight - 4) current = sections.at(-1).id;
    links.forEach(a => { const on = a.dataset.id === current; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
  }
  function onMainScroll() { updateTopbarShadow(); if (route().page === 'settings') updateSettingsSpy(); }
  /* Ключ стенда: один раз в Настройках — и чат, музыка и изображения работают на стенде.
   * Ключ остаётся в localStorage этого браузера и уходит только на адрес вашей шины. */
  function standSection() {
    const bus = window.BRIIX_BUS;
    const hasKey = !!bus?.hasToken();
    const address = bus?.server() || 'http://127.0.0.1:8300';
    // На опубликованном сайте шина ходит через same-origin /api (PR #39) — поле только показывает адрес.
    const proxyMode = !['127.0.0.1', 'localhost'].includes(location.hostname);
    return `<section class="settings-section reveal" id="settings-stand"><h2>Ключ доступа к стенду</h2><p>Один ключ на все разделы: вставили — чат, музыка и изображения сразу считают на вашем стенде, без переключателей.</p><div class="settings-card"><div class="setting-row stand-key-row"><div><label class="setting-label" for="stand-token">Ключ доступа к стенду</label><div class="setting-help">Bearer-токен media-bff. Хранится только в этом браузере и не попадает в экспорт диалогов.</div></div><div class="stand-key-controls"><input type="password" id="stand-token" autocomplete="off" spellcheck="false" placeholder="${hasKey ? '•••••••• ключ сохранён' : 'Вставьте ключ стенда'}" aria-describedby="stand-status"><button type="button" class="btn small" data-action="stand-reveal" aria-pressed="false">${icon('eye')}Показать</button></div></div><div class="setting-row"><div><label class="setting-label" for="stand-server">Адрес шины</label><div class="setting-help">${proxyMode ? 'Сайт опубликован: запросы идут через same-origin /api этого же домена, адрес менять не нужно.' : 'Локальный туннель к вашему стенду. По умолчанию ' + esc(address) + '.'}</div></div><input type="url" id="stand-server" value="${esc(address)}" spellcheck="false" ${proxyMode ? 'readonly aria-readonly="true"' : ''} placeholder="http://127.0.0.1:8300"></div><div class="setting-row"><div><div class="setting-label">Проверка соединения</div><div class="setting-help">GET /health и каталог моделей: сколько моделей готово считать.</div></div><div class="stand-key-actions"><button type="button" class="btn small primary" data-action="stand-save">${icon('check')}Сохранить и проверить</button><button type="button" class="btn small" data-action="stand-check">${icon('refresh')}Проверить</button><button type="button" class="btn small danger" data-action="stand-clear" ${hasKey ? '' : 'disabled'}>${icon('trash')}Убрать ключ</button></div></div><p class="stand-status" id="stand-status" role="status">${esc(standStatusText)}</p></div></section>`;
  }

  async function standCheck(save) {
    const bus = window.BRIIX_BUS;
    const status = $('#stand-status');
    if (!bus) { standStatusText = 'Модуль шины не загрузился. Обновите страницу.'; if (status) status.textContent = standStatusText; return; }
    const address = $('#stand-server')?.value.trim();
    // На опубликованном сайте адрес задаёт same-origin /api — не сохраняем его в настройку браузера.
    if (address !== undefined && ['127.0.0.1', 'localhost'].includes(location.hostname)) bus.setServer(address || '');
    const entered = $('#stand-token')?.value.trim();
    if (save && entered) { bus.setToken(entered); const field = $('#stand-token'); if (field) { field.value = ''; field.placeholder = '•••••••• ключ сохранён'; } }
    standStatusText = 'Проверяем стенд…';
    if (status) status.textContent = standStatusText;
    const result = await bus.checkStand();
    standStatusText = result.message + (result.ok ? ' Разделы перейдут на live автоматически.' : '');
    if (status) { status.textContent = standStatusText; status.dataset.state = result.ok ? 'ok' : 'error'; }
    const clear = $('[data-action="stand-clear"]'); if (clear) clear.disabled = !bus.hasToken();
    // Режим применяется сразу: не заставляем пользователя перезаходить в разделы.
    window.BRIIX_CHAT_LIVE?.autoStart({ force: true });
    window.BRIIX_MUSIC_LIVE?.autoStart({ force: true });
    window.BRIIX_MEDIA_LIVE?.autoStart({ force: true });
    toast(result.ok ? 'Стенд доступен: ' + result.ready + ' моделей ready.' : result.message, result.ok ? 'success' : 'error');
  }

  function faqItem(id, question, answer) {
    return `<div class="faq-item"><button class="faq-q" type="button" data-action="toggle-faq" aria-expanded="false" aria-controls="faq-a-${id}" id="faq-q-${id}"><span>${esc(question)}</span><span class="pm" aria-hidden="true">+</span></button><div class="faq-a" id="faq-a-${id}" role="region" aria-labelledby="faq-q-${id}" aria-hidden="true"><div class="inner">${esc(answer)}</div></div></div>`;
  }
  /* Rendering and events */
  function render() {
    const r = route();
    if (r.page !== 'music') window.BRIIX_MUSIC?.pause();
    renderSidebar(); renderTopbar();
    if (r.page === 'home') renderHome();
    else if (r.page === 'assistants') renderAssistants();
    else if (r.page === 'prompts') renderPrompts();
    else if (r.page === 'favorites') renderFavorites();
    else if (r.page === 'settings') renderSettings();
    else if (r.page === 'music') { if (window.BRIIX_MUSIC) window.BRIIX_MUSIC.render(main, { icon, esc, toast, openModal, closeModal, download, copyText, navigate, reducedMotion }); else main.innerHTML = '<section class="page"><h1>Музыка</h1><p>Модуль не загрузился. Обновите страницу или проверьте локальные файлы.</p></section>'; }
    else if (r.page === 'media') { if (window.BRIIX_MEDIA) window.BRIIX_MEDIA.render(main, { icon, esc, toast, openModal, closeModal, download, copyText, navigate, reducedMotion }); else main.innerHTML = '<section class="page"><h1>Изображения</h1><p>Модуль не загрузился. Обновите страницу или проверьте локальные файлы.</p></section>'; }
    else renderChat();
    updateStorageNotice();
    if (window.BRIIX_CHAT_LIVE) window.BRIIX_CHAT_LIVE.setBanner(window.BRIIX_CHAT_LIVE.bannerText());
    if (r.page === 'chat') scrollToBottom(true); else main.scrollTop = 0;
    setupReveals(); updateTopbarShadow(); if (r.page === 'settings') updateSettingsSpy();
    document.title = (r.page === 'chat' && currentChat() ? currentChat().title + ' — BRIIX' : ({ home: 'Ваше пространство для идей', assistants: 'Помощники', prompts: 'Библиотека промптов', favorites: 'Избранное', media: 'Изображения', music: 'Музыка', settings: 'Настройки' }[r.page] || 'Диалог')) + ' — BRIIX';
  }
  const actions = {
    'new-chat': () => { pendingAttachments = []; state.selectedAssistant = state.settings.defaultAssistant; navigate('home'); requestAnimationFrame(() => $('#prompt-input')?.focus()); },
    'send': sendMessage, 'stop': stopResponse,
    'attach': () => $('#file-input').click(),
    'attach-example': () => { addAttachments([{ name: 'brief-kofeynya.pdf', size: 248320, type: 'application/pdf' }]); },
    'remove-attachment': el => { pendingAttachments = pendingAttachments.filter(f => f.id !== el.dataset.id); renderAttachments(); },
    'choose-assistant': chooseAssistant, 'select-assistant': el => selectAssistant(el.dataset.id), 'modal-select-assistant': el => selectAssistant(el.dataset.id),
    'start-assistant': el => { state.selectedAssistant = el.dataset.id; persist(); navigate('home'); requestAnimationFrame(() => $('#prompt-input')?.focus()); },
    'assistant-details': el => assistantDetails(el.dataset.id),
    'use-assistant-prompt': el => { const a = assistant(el.dataset.id); const p = a.prompts[Number(el.dataset.index)]; if (p) fillPrompt(p.text, a.id); },
    'use-prompt': el => { const p = promptLibrary.find(p => p.id === el.dataset.id); if (p) { closeSearch(); fillPrompt(p.text, p.assistant); } },
    'shuffle-prompts': () => { const a = assistant(state.selectedAssistant); const next = assistants[(assistants.indexOf(a) + 1) % assistants.length]; state.selectedAssistant = next.id; persist(); renderHome(); toast('Идеи от помощника «' + next.name + '»'); },
    'filter-assistants': el => { catalogFilter = el.dataset.id; renderAssistants(); },
    'reset-assistants': () => { catalogFilter = 'all'; catalogQuery = ''; renderAssistants(); },
    'filter-prompts': el => { promptFilter = el.dataset.id; renderPrompts(); },
    'reset-prompts': () => { promptFilter = 'Все'; promptQuery = ''; renderPrompts(); },
    'favorite-prompt': el => { const id = el.dataset.id; const index = state.favoritePrompts.indexOf(id); if (index >= 0) state.favoritePrompts.splice(index, 1); else state.favoritePrompts.push(id); persist(); renderSidebar(); if (route().page === 'prompts') updatePromptGrid(); else renderFavorites(); toast(index >= 0 ? 'Промпт убран из избранного' : 'Промпт сохранён'); },
    'favorite-chat': el => toggleFavoriteChat(el.dataset.id),
    'filter-favorites': el => { favoriteFilter = el.dataset.id; renderFavorites(); },
    'save-message': el => toggleSavedMessage(el.dataset.id),
    'remove-saved': el => { state.saved = state.saved.filter(s => s.id !== el.dataset.id); persist(); renderSidebar(); renderFavorites(); toast('Ответ убран из избранного'); },
    'copy-saved': el => { const s = state.saved.find(s => s.id === el.dataset.id); if (s) copyText(s.content); },
    'view-saved': el => { const s = state.saved.find(s => s.id === el.dataset.id); if (s) openModal(s.title, `<div class="prose">${markdown(s.content)}</div>`, [{ label: 'Скопировать', action: () => copyText(s.content) }, { label: 'Закрыть', primary: true, action: closeModal }], true); },
    'open-example': () => { const c = state.chats.find(c => c.isExample); if (c) navigate('chat/' + c.id); else { resetDemo(false); navigate('home'); } },
    'open-prompts': () => navigate('prompts'),
    'copy-message': el => { const m = currentChat()?.messages.find(m => m.id === el.dataset.id); if (m) copyText(m.content); },
    'copy-code': el => { try { copyText(decodeURIComponent(el.dataset.code), 'Код скопирован'); } catch { toast('Не удалось прочитать блок кода.', 'error'); } },
    'feedback': el => { const m = currentChat()?.messages.find(m => m.id === el.dataset.id); if (!m) return; m.feedback = m.feedback === el.dataset.value ? null : el.dataset.value; persist(); refreshMessages(); toast(m.feedback ? 'Спасибо, отметка сохранена в этом браузере' : 'Отметка убрана'); },
    'regenerate': el => retryMessage(el.dataset.id, true), 'retry': el => retryMessage(el.dataset.id),
    'followup': el => { const input = $('#prompt-input'); if (input) { input.value = el.dataset.text; setDraft(input.value); updateComposerState(); input.focus(); } },
    'rename-chat': el => renameChat(el.dataset.id), 'delete-chat': el => confirmDeleteChat(el.dataset.id), 'export-chat': el => exportChat(el.dataset.id),
    'set-theme': el => changeSetting('theme', el.dataset.id),
    'toggle-theme': () => changeSetting('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
    'settings-anchor': el => { const target = document.getElementById(el.dataset.id); if (target) target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' }); },
    'export-all': exportAll, 'import-all': () => $('#import-input').click(),
    'clear-data': () => openModal('Начать с чистого листа?', '<p>Все диалоги, сохранённые ответы, избранные промпты и черновики будут удалены из этого браузера. Настройки оформления останутся. Сначала можно экспортировать копию.</p>', [{ label: 'Отмена', action: closeModal }, { label: 'Скачать копию', action: exportAll }, { label: 'Очистить данные', danger: true, action: () => { if (activeStream) stopResponse(); state.chats = []; state.saved = []; state.favoritePrompts = []; state.drafts = {}; pendingAttachments = []; storageWarning = ''; storageProtected = false; storageAvailable = true; persist(); closeModal(); navigate('settings'); toast('Данные очищены. Можно начать заново.'); } }]),
    'reset-demo': () => openModal('Вернуть начальное демо?', '<p>Текущие диалоги, избранное и настройки будут заменены начальным набором. Это действие нельзя отменить; сохраните копию, если она нужна.</p>', [{ label: 'Отмена', action: closeModal }, { label: 'Скачать копию', action: exportAll }, { label: 'Вернуть демо', primary: true, action: () => resetDemo(true) }]),
    'about': about, 'shortcuts': shortcuts, 'close-modal': closeModal,
    'search': openSearch, 'close-search': closeSearch,
    'search-media': () => { closeSearch(); navigate('media'); },
    'search-music': () => { closeSearch(); navigate('music'); },
    'stand-save': () => standCheck(true),
    'stand-check': () => standCheck(false),
    'stand-reveal': el => { const field = $('#stand-token'); if (!field) return; const show = field.type === 'password'; field.type = show ? 'text' : 'password'; el.setAttribute('aria-pressed', String(show)); el.innerHTML = icon(show ? 'eyeOff' : 'eye') + (show ? 'Скрыть' : 'Показать'); },
    'stand-clear': () => {
      window.BRIIX_BUS?.setToken('');
      standStatusText = 'Ключ удалён: разделы вернулись в сценарный режим.';
      const status = $('#stand-status'); if (status) { status.textContent = standStatusText; status.dataset.state = ''; }
      const field = $('#stand-token'); if (field) { field.value = ''; field.placeholder = 'Вставьте ключ стенда'; }
      const clear = $('[data-action="stand-clear"]'); if (clear) clear.disabled = true;
      window.BRIIX_CHAT_LIVE?.autoStart({ force: true });
      window.BRIIX_MUSIC_LIVE?.autoStart({ force: true });
      window.BRIIX_MEDIA_LIVE?.autoStart({ force: true });
      toast('Ключ удалён из этого браузера.');
    },
    'toggle-chat-live': () => { if (window.BRIIX_CHAT_LIVE) window.BRIIX_CHAT_LIVE.toggle(); else toast('Live-модуль не загрузился. Обновите страницу.', 'error'); },
    'search-chat': el => { closeSearch(); navigate('chat/' + el.dataset.id); },
    'search-assistant': el => { closeSearch(); assistantDetails(el.dataset.id); },
    'toggle-sidebar': () => $('#sidebar').classList.contains('open') ? closeSidebar() : openSidebar(),
    'toggle-faq': el => {
      const item = el.closest('.faq-item'); const answer = item.querySelector('.faq-a'); const isOpen = item.classList.contains('open');
      $$('.faq-item.open', item.closest('.faq-list')).forEach(other => { if (other !== item) { other.classList.remove('open'); other.querySelector('.faq-a').style.maxHeight = '0px'; other.querySelector('.faq-q').setAttribute('aria-expanded', 'false'); other.querySelector('.faq-a').setAttribute('aria-hidden', 'true'); } });
      item.classList.toggle('open', !isOpen); el.setAttribute('aria-expanded', String(!isOpen)); answer.setAttribute('aria-hidden', String(isOpen)); answer.style.maxHeight = isOpen ? '0px' : answer.scrollHeight + 'px';
    }
  };
  function resetDemo(notify) { if (activeStream) stopResponse(); state = freshState(); pendingAttachments = []; pendingSend = false; storageAvailable = true; storageProtected = false; storageWarning = ''; persist(); applySettings(); closeModal(); navigate('home'); if (notify) toast('Начальное демо восстановлено'); }
  document.addEventListener('click', event => {
    if (event.target.closest('.media-page, .media-modal, .music-page, .music-modal')) return;
    const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
    const action = actions[el.dataset.action]; if (action) { event.preventDefault(); action(el); }
  });
  document.addEventListener('input', event => {
    const el = event.target;
    if (el.id === 'prompt-input') { setDraft(el.value); updateComposerState(); }
    if (el.id === 'assistant-search') { catalogQuery = el.value; updateAssistantGrid(); }
    if (el.id === 'prompt-search') { promptQuery = el.value; updatePromptGrid(); }
    if (el.id === 'global-search') { searchQuery = el.value; updateSearchResults(); }
    if (el.id === 'setting-name') { state.settings.name = el.value.slice(0, 40); clearTimeout(draftTimer); draftTimer = setTimeout(() => { draftTimer = null; persist(); renderSidebar(); }, 300); }
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.dataset.setting && el.dataset.setting !== 'name') changeSetting(el.dataset.setting, el.type === 'checkbox' ? el.checked : el.value);
    if (el.id === 'file-input') { addAttachments(el.files); el.value = ''; }
    if (el.id === 'import-input') { importAll(el.files[0]); el.value = ''; }
  });
  document.addEventListener('keydown', event => {
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 'k') { event.preventDefault(); if (searchModal.open) closeSearch(); else openSearch(); return; }
    if (command && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); if (modal.open) closeModal(); if (searchModal.open) closeSearch(); actions['new-chat'](); return; }
    if (event.key === 'Escape' && $('#sidebar').classList.contains('open')) { event.preventDefault(); closeSidebar(); return; }
    if (event.target.id === 'prompt-input' && event.key === 'Enter' && !event.isComposing) {
      const send = state.settings.enterToSend ? !event.shiftKey : command;
      if (send) { event.preventDefault(); if (!activeStream && !pendingSend) sendMessage(); }
    }
    if (searchModal.open && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      const results = $$('.search-result', searchModal); const index = results.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); results[Math.min(results.length - 1, index + 1)]?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); if (index <= 0) $('#global-search').focus(); else results[index - 1]?.focus(); }
      if (event.key === 'Enter' && event.target.id === 'global-search') { event.preventDefault(); results[0]?.click(); }
    }
    if (mobileQuery.matches && $('#sidebar').classList.contains('open') && event.key === 'Tab') {
      const focusable = $$('a, button:not(:disabled)', $('#sidebar')).filter(el => el.getClientRects().length); const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('dragover', event => { const composer = event.target.closest('#composer'); if (composer && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); composer.classList.add('dragging'); } });
  document.addEventListener('dragleave', event => { const composer = event.target.closest('#composer'); if (composer && !composer.contains(event.relatedTarget)) composer.classList.remove('dragging'); });
  document.addEventListener('drop', event => { const composer = event.target.closest('#composer'); if (composer && event.dataTransfer?.files.length) { event.preventDefault(); composer.classList.remove('dragging'); if (!activeStream) addAttachments(event.dataTransfer.files); } });
  $('#file-input').addEventListener('click', event => event.stopPropagation());
  $('#import-input').addEventListener('click', event => event.stopPropagation());
  $('#sidebar-scrim').addEventListener('click', () => closeSidebar());
  modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); } });
  modal.addEventListener('close', () => { if (modalReturnFocus?.isConnected) modalReturnFocus.focus(); });
  searchModal.addEventListener('click', event => { if (event.target === searchModal) { const rect = searchModal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSearch(); } });
  searchModal.addEventListener('close', () => { if (searchReturnFocus?.isConnected && !searchReturnFocus.closest('[inert]')) searchReturnFocus.focus(); });
  window.addEventListener('hashchange', () => { closeSidebar(false); pendingAttachments = []; if (draftTimer) flushDraft(); render(); });
  window.addEventListener('resize', () => { updateComposerState(); $$('.faq-item.open .faq-a').forEach(a => { a.style.maxHeight = a.scrollHeight + 'px'; }); });
  main.addEventListener('scroll', onMainScroll, { passive: true });
  window.BRIIX_UI = {
    toast,
    refreshChat: () => { const r = route(); if (r.page === 'chat') { renderChat(); updateSendButton(); } else if (r.page === 'home') renderHome(); renderSidebar(); renderTopbar(); if (window.BRIIX_CHAT_LIVE) window.BRIIX_CHAT_LIVE.setBanner(window.BRIIX_CHAT_LIVE.bannerText()); }
  };
  window.BRIIX_CHAT_LIVE?.onHostReady();
  window.addEventListener('pagehide', () => { flushDraft(); window.BRIIX_MEDIA?.suspend(); window.BRIIX_MUSIC?.suspend(); window.BRIIX_CHAT_LIVE?.stop(); });
  mobileQuery.addEventListener('change', () => { closeSidebar(false); updateSidebarAccess(); });
  systemTheme.addEventListener('change', () => { if (state.settings.theme === 'system') { applySettings(); renderTopbar(); } });
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY || activeStream || pendingSend) return;
    if (draftTimer) { const saved = flushDraft(); toast(saved ? 'Текущие изменения сохранены. Обновления другой вкладки не применены поверх вашей работы.' : 'Обновления другой вкладки не применены поверх вашей работы. Сохраните текущую копию через экспорт.', saved ? 'success' : 'error'); return; }
    state = loadState(); applySettings(); render(); toast('Данные обновлены из другой вкладки');
  });
  $('.skip-link').addEventListener('click', event => { event.preventDefault(); main.focus(); main.scrollTop = 0; });
  applySettings(); if (!skipInitialPersist) persist(); render();
})();
