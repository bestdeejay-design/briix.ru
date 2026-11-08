/* BRIIX chat — optional "Приватный live (эксперимент)" mode.
 * The scripted demo stays untouched: when live is on, answers come from the user's own
 * media-bff via POST /v1/chat/completions (SSE). Every live answer is labelled and carries
 * provenance. If the stream cannot start, we say so and fetch the whole answer instead —
 * never a silent switch back to scripted text.
 */
(() => {
  'use strict';
  const STORE_KEY = 'briix-chat-live-v1';
  const MAX_HISTORY_MESSAGES = 12;
  const MAX_HISTORY_CHARS = 8000;
  let store = load();
  let active = false;
  let current = null;         // {controller, messageId}
  let bannerText = '';
  let autoCheckedAt = 0;
  let model = null;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      const provenance = {};
      if (raw.provenance && typeof raw.provenance === 'object') {
        for (const [id, p] of Object.entries(raw.provenance).slice(-200)) {
          if (!p || typeof p !== 'object') continue;
          provenance[id] = {
            model: typeof p.model === 'string' ? p.model.slice(0, 80) : null,
            wallMs: Number.isFinite(p.wallMs) ? p.wallMs : null,
            streamed: !!p.streamed,
            fallbackReason: typeof p.fallbackReason === 'string' ? p.fallbackReason.slice(0, 40) : null,
            errorMessage: typeof p.errorMessage === 'string' ? p.errorMessage.slice(0, 300) : null,
            at: Number.isFinite(p.at) ? p.at : Date.now()
          };
        }
      }
      return { enabled: !!raw.enabled, manualOff: !!raw.manualOff, provenance };
    } catch { return { enabled: false, manualOff: false, provenance: {} }; }
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ enabled: store.enabled, manualOff: store.manualOff, provenance: store.provenance })); }
    catch { /* provenance is optional; chat history is owned by demo.js */ }
  }
  const bus = () => window.BRIIX_BUS;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (text, kind) => window.BRIIX_UI?.toast(text, kind);
  const refresh = () => window.BRIIX_UI?.refreshChat();

  function setBanner(text) {
    bannerText = text || '';
    const el = document.querySelector('#chat-live-banner');
    if (!el) return;
    el.hidden = !bannerText;
    const slot = el.querySelector('[data-live-banner-text]');
    if (slot) slot.textContent = bannerText; else el.textContent = bannerText;
    const link = el.querySelector('[data-live-settings]');
    if (link) link.hidden = !/Настройках/.test(bannerText);
  }

  // Ключ живёт в Настройках: никаких window.prompt посреди диалога.
  function goSettings() {
    setBanner(bus()?.mockBanner('no_token') || 'Мок: вставьте ключ стенда в Настройках.');
    refresh();
    location.hash = '#/settings';
    setTimeout(() => document.querySelector('#stand-token')?.focus(), 60);
  }

  async function toggle() {
    if (active) {
      current?.controller.abort();
      active = false; store.enabled = false; store.manualOff = true; persist();
      setBanner(bus().mockBanner('manual_off') + ' Ответы сценарные.');
      refresh(); toast('Live-чат выключен. Ответы снова сценарные.');
      return;
    }
    if (!bus().hasToken()) { goSettings(); return; }
    store.manualOff = false; persist();
    const started = await autoStart({ force: true });
    if (started) toast('Live-чат включён. Отвечает ' + (model || 'ваш сервер') + '.');
    else toast('Live-чат не включился: смотрите пояснение над диалогом.', 'error');
  }

  /* Live по умолчанию: ключ есть и стенд здоров — раздел живёт сам, без кликов.
   * Любой отказ объясняется баннером, сценарный режим никогда не выдаётся за live. */
  async function autoStart({ force = false } = {}) {
    if (!bus()) return false;
    if (!force && Date.now() - autoCheckedAt < 10000) { setBanner(bannerText); return active; }
    autoCheckedAt = Date.now();
    if (store.manualOff && !force) { active = false; setBanner(bus().mockBanner('manual_off') + ' Ответы сценарные.'); refresh(); return false; }
    if (!bus().hasToken()) { active = false; setBanner(bus().mockBanner('no_token') + ' Ответы сценарные.'); refresh(); return false; }
    const health = await bus().health();
    if (!health) {
      active = false; store.enabled = false; persist();
      setBanner('Мок: стенд недоступен — ответы остаются сценарными. Проверьте ключ и адрес шины в Настройках.');
      refresh(); return false;
    }
    let capability;
    try { capability = await bus().capability('chat', true); }
    catch (error) {
      active = false; store.enabled = false; persist();
      setBanner(error?.code === 'unauthorized'
        ? bus().mockBanner('unauthorized') + ' Ответы сценарные.'
        : 'Мок: каталог моделей не получен — ответы остаются сценарными. Проверьте ключ в Настройках.');
      refresh(); return false;
    }
    if (capability.status !== 'ready') {
      active = false; store.enabled = false; persist();
      setBanner('Текстовый бэкенд на стенде недоступен (chat: unavailable). Ответы остаются сценарными.');
      refresh(); return false;
    }
    model = capability.model;
    active = true; store.enabled = true; store.manualOff = false; persist(); setBanner('');
    refresh();
    return true;
  }

  function buildMessages(chat, prompt) {
    const assistant = (window.BRIIX_DATA?.assistants || []).find(a => a.id === chat.assistantId);
    const messages = [{
      role: 'system',
      content: `Ты — ${assistant?.name || 'помощник'} в BRIIX. ${assistant?.description || ''} Отвечай по-русски, по делу, без выдуманных фактов.`
    }];
    const history = chat.messages.filter(m => ['user', 'assistant'].includes(m.role) && m.content && m.status !== 'error').slice(-MAX_HISTORY_MESSAGES);
    let budget = MAX_HISTORY_CHARS;
    const kept = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role === 'assistant' && m.id === current?.messageId) continue;
      const content = m.content.slice(0, Math.max(0, budget));
      if (!content) break;
      budget -= content.length;
      kept.unshift({ role: m.role, content });
    }
    messages.push(...kept);
    if (!kept.length || kept.at(-1).role !== 'user' || kept.at(-1).content !== prompt) messages.push({ role: 'user', content: prompt });
    return messages;
  }

  /* Called by demo.js instead of the scripted generator. Returns an abort function. */
  function respond({ chat, message, prompt, onChunk, onFinish, persist: persistChat }) {
    const controller = new AbortController();
    current = { controller, messageId: message.id };
    const started = Date.now();
    let received = false;
    const finish = status => {
      if (current?.messageId === message.id) current = null;
      onFinish(status);
    };
    bus().chat({
      messages: buildMessages(chat, prompt),
      signal: controller.signal,
      onChunk: piece => { received = true; message.content += piece; onChunk(); }
    }).then(result => {
      store.provenance[message.id] = {
        model: result.model || model, wallMs: result.wallMs ?? (Date.now() - started),
        streamed: result.streamed, fallbackReason: result.fallbackReason, at: Date.now()
      };
      persist();
      if (!result.streamed) {
        setBanner('Стрим недоступен (' + (result.fallbackReason || 'причина не указана') + ') — ответ получен целиком одним куском. Это по-прежнему ответ вашей модели, не сценарий.');
        toast('Стрим не открылся, ответ пришёл целиком. Причина: ' + (result.fallbackReason || 'неизвестна') + '.', 'error');
      } else setBanner('');
      persistChat();
      finish('complete');
    }).catch(error => {
      if (error?.name === 'AbortError') { finish('stopped'); return; }
      if (error?.code === 'content_blocked') {
        // Отказ политики — полноценный ответ, а не ошибка: статус complete, без «повторить».
        message.content = 'Этот запрос я генерировать не буду — политика контента briix.ru.'
          + (error.message ? '\n\n' + error.message : '')
          + '\n\nХудожественная нагота допустима, порнография — нет. Переформулируйте запрос — и продолжим.';
        delete message.liveError;
        store.provenance[message.id] = {
          model, wallMs: Date.now() - started, streamed: false, contentBlocked: true,
          policyMessage: error.message || null, at: Date.now()
        };
        persist();
        setBanner('Запрос не прошёл проверку контента на сервере. Это ответ политики, а не сбой: измените формулировку и отправьте снова.');
        persistChat();
        refresh();
        finish('complete');
        return;
      }
      const reason = error?.code === 'unauthorized' ? 'Сервер отклонил токен.'
        : error?.code === 'unavailable' ? 'Текстовый бэкенд недоступен.'
        : error?.code === 'network' ? 'Связь с сервером потеряна.'
        : error?.message || 'Ошибка бэкенда.';
      store.provenance[message.id] = { model, wallMs: Date.now() - started, streamed: false, fallbackReason: error?.code || 'error', errorMessage: reason, at: Date.now() };
      persist();
      message.liveError = reason;
      setBanner((received ? 'Ответ оборвался: ' : 'Live-чат не ответил: ') + reason + ' Повторите запрос — сценарный текст вместо ответа модели мы не подставляем.');
      persistChat();
      finish('error');
    });
    return () => controller.abort();
  }

  function badge(message) {
    const p = store.provenance[message.id];
    if (!p) return null;
    return `<span class="badge chat-live-badge">Live · ${esc(p.model || 'ваш сервер')}</span>`;
  }

  function provenanceMarkup(message) {
    const p = store.provenance[message.id];
    if (!p) return '';
    const seconds = Number.isFinite(p.wallMs) ? (p.wallMs / 1000).toFixed(1) + ' с' : '—';
    if (p.contentBlocked) return `<div class="chat-live-provenance chat-policy-note" data-chat-provenance="${esc(message.id)}">Проверка контента · отказ сервера · ${seconds} · это не ошибка связи</div>`;
    return `<div class="chat-live-provenance" data-chat-provenance="${esc(message.id)}">${esc(p.model || 'модель сервера')} · ${seconds} · ${p.streamed ? 'поток SSE' : 'ответ целиком' + (p.fallbackReason ? ' (' + esc(p.fallbackReason) + ')' : '')} · приватный live</div>`;
  }

  // A live failure is a server failure: never call it a scripted demo error.
  function errorNote(message) {
    const p = store.provenance[message.id];
    if (!p) return null;
    return `<p>${esc(p.errorMessage || 'Сервер не отдал ответ.')} Это сбой приватного live-режима, а не сценарная заглушка: сообщение сохранено, запрос можно повторить.</p>`;
  }

  window.BRIIX_CHAT_LIVE = {
    errorNote,
    active: () => active,
    toggle, respond, badge, provenanceMarkup, setBanner, autoStart, goSettings,
    bannerText: () => bannerText,
    stop: () => current?.controller.abort(),
    provenanceFor: id => store.provenance[id] || null,
    onHostReady() {
      if (!bus()) return;
      setBanner(bannerText);          // баннер живёт в разметке страницы — восстанавливаем текст
      autoStart();
    }
  };
})();
