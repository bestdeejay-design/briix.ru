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
      return { enabled: !!raw.enabled, provenance };
    } catch { return { enabled: false, provenance: {} }; }
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ enabled: store.enabled, provenance: store.provenance })); }
    catch { /* provenance is optional; chat history is owned by demo.js */ }
  }
  const bus = () => window.BRIIX_BUS;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (text, kind) => window.BRIIX_UI?.toast(text, kind);
  const refresh = () => window.BRIIX_UI?.refreshChat();

  function setBanner(text) {
    bannerText = text || '';
    const el = document.querySelector('#chat-live-banner');
    if (el) { el.hidden = !bannerText; el.textContent = bannerText; }
  }

  function askToken() {
    const value = window.prompt('Bearer-токен media-bff (хранится только в этом браузере, ключ briix-media-live-token):');
    if (value && value.trim()) { bus().setToken(value); toast('Токен сохранён локально.'); }
  }

  async function toggle() {
    if (active) {
      current?.controller.abort();
      active = false; store.enabled = false; persist(); setBanner('');
      refresh(); toast('Live-чат выключен. Ответы снова сценарные.');
      return;
    }
    const health = await bus().health();
    if (!health) { setBanner('Live-чат недоступен: сервер не отвечает. Проверьте туннель (tools/briix-media-live-up.sh). Ответы остаются сценарными.'); refresh(); toast('Сервер не отвечает по /health.', 'error'); return; }
    if (!bus().hasToken()) { askToken(); if (!bus().hasToken()) return; }
    let capability;
    try { capability = await bus().capability('chat', true); }
    catch { setBanner('Каталог моделей не получен: проверьте bearer-токен. Ответы остаются сценарными.'); refresh(); return; }
    if (capability.status !== 'ready') {
      setBanner('Текстовый бэкенд на сервере недоступен (chat: unavailable). Ответы остаются сценарными.');
      refresh(); toast('Сервер ответил, но chat помечен unavailable.', 'error'); return;
    }
    model = capability.model;
    active = true; store.enabled = true; persist(); setBanner('');
    refresh(); toast('Live-чат включён. Отвечает ' + (model || 'ваш сервер') + '.');
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
    toggle, respond, badge, provenanceMarkup, setBanner,
    bannerText: () => bannerText,
    stop: () => current?.controller.abort(),
    provenanceFor: id => store.provenance[id] || null,
    onHostReady() {
      if (!store.enabled || !bus()) return;
      bus().health().then(async health => {
        if (!health || !bus().hasToken()) { store.enabled = false; persist(); setBanner('Мок-режим: сервер не отвечает после перезагрузки. Ответы снова сценарные.'); refresh(); return; }
        try {
          const capability = await bus().capability('chat', true);
          if (capability.status !== 'ready') { store.enabled = false; persist(); setBanner('Текстовый бэкенд недоступен — ответы снова сценарные.'); refresh(); return; }
          model = capability.model; active = true; refresh();
        } catch { store.enabled = false; persist(); refresh(); }
      });
    }
  };
})();
