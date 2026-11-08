/* BRIIX private bus transport — shared by music-live.js and chat-live.js.
 * Talks to the user's own media-bff through the SSH tunnel (default 127.0.0.1:8300).
 * Same localStorage keys as media-live.js: one token entry serves every section.
 * No server code, no secrets in git, no silent substitution of mock and live.
 * Contract: tools/media-bff-config/ (bff.py, /v1/models, jobs schema).
 */
(() => {
  'use strict';
  const DEFAULT_SERVER = 'http://127.0.0.1:8300';
  const TOKEN_KEY = 'briix-media-live-token';
  const SERVER_KEY = 'briix-media-live-server';
  const MODELS_TTL = 30000;
  let modelsCache = { ts: 0, data: null };

  class BusError extends Error {
    constructor(code, message, status = 0) { super(message || code); this.code = code; this.status = status; }
  }

  const server = () => { try { return JSON.parse(localStorage.getItem(SERVER_KEY)) || DEFAULT_SERVER; } catch { return DEFAULT_SERVER; } };
  function setServer(value) {
    const v = String(value || '').trim().replace(/\/+$/, '');
    if (v) localStorage.setItem(SERVER_KEY, JSON.stringify(v)); else localStorage.removeItem(SERVER_KEY);
    modelsCache = { ts: 0, data: null };
  }
  const token = () => localStorage.getItem(TOKEN_KEY) || '';
  function setToken(value) {
    const v = String(value || '').trim();
    if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY);
    modelsCache = { ts: 0, data: null };
  }
  const headers = (extra = {}) => ({ Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json', ...extra });

  async function request(path, options = {}) {
    let response;
    try { response = await fetch(server() + path, options); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new BusError('network', 'Сервер недоступен.');
    }
    if (response.status === 401) throw new BusError('unauthorized', 'Сервер отклонил токен.', 401);
    if (response.status === 404) throw new BusError('gone', 'Объект не найден или срок хранения истёк.', 404);
    // 422 — не сбой, а отказ по политике контента: текст сервера показываем дословно.
    if (response.status === 422 || response.status === 400) {
      let payload = null;
      try { payload = await response.json(); } catch { /* тело может быть пустым */ }
      const code = payload?.error?.code || (response.status === 422 ? 'content_blocked' : 'bad_params');
      const message = payload?.error?.message || (response.status === 422
        ? 'Запрос нарушает политику контента.' : 'Сервер отклонил параметры запроса.');
      throw new BusError(code, message, response.status);
    }
    if (response.status === 429) throw new BusError('queue_full', 'Очередь сервера заполнена.', 429);
    if (response.status === 503) throw new BusError('unavailable', 'Сервер или бэкенд недоступен.', 503);
    if (!response.ok) throw new BusError('http', 'Сервер ответил ' + response.status + '.', response.status);
    return response;
  }

  async function health() {
    try {
      const r = await fetch(server() + '/health', { method: 'GET' });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function models(force = false) {
    const now = Date.now();
    if (!force && modelsCache.data && now - modelsCache.ts < MODELS_TTL) return modelsCache.data;
    const response = await request('/v1/models', { headers: headers() });
    const payload = await response.json();
    const data = Array.isArray(payload?.data) ? payload.data : [];
    modelsCache = { ts: now, data };
    return data;
  }

  // Catalog is the only source of truth for what may look active in the UI.
  async function capability(name, force = false) {
    const list = await models(force);
    const entry = list.find(m => Array.isArray(m.capabilities) && m.capabilities.includes(name));
    if (!entry) return { status: 'unavailable', model: null, entry: null };
    return { status: entry.status === 'ready' ? 'ready' : 'unavailable', model: entry.id, entry };
  }

  // Каталог отдаёт две модели на одну capability (Flash и Pro) — нужен поиск по id.
  async function modelById(id, force = false) {
    const list = await models(force);
    const entry = list.find(m => m.id === id);
    if (!entry) return { id, status: 'unavailable', limits: null, latency: null, entry: null };
    return { id, status: entry.status === 'ready' ? 'ready' : 'unavailable', limits: entry.limits || null, latency: entry.latency || null, entry };
  }

  async function submitJob({ type, prompt, params = {}, idempotencyKey }) {
    const response = await request('/jobs', {
      method: 'POST', headers: headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      body: JSON.stringify({ type, prompt, params })
    });
    const payload = await response.json();
    if (!payload?.job_id) throw new BusError('bad_response', 'Сервер не вернул job_id.');
    return payload.job_id;
  }

  async function getJob(id) {
    const response = await request('/jobs/' + encodeURIComponent(id), { headers: headers() });
    return await response.json();
  }

  async function cancelJob(id) {
    try {
      await request('/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST', headers: headers() });
      return true;
    } catch (error) {
      if (error instanceof BusError && error.status === 409) return true; // settled on the server: its truth wins
      throw error;
    }
  }

  async function fileBlob(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : server() + pathOrUrl;
    let response;
    try { response = await fetch(url, { headers: { Authorization: 'Bearer ' + token() } }); }
    catch { throw new BusError('network', 'Файл не получен: сервер недоступен.'); }
    if (response.status === 404) throw new BusError('gone', 'Результат истёк: файл удалён с сервера.', 404);
    if (response.status === 401) throw new BusError('unauthorized', 'Сервер отклонил токен.', 401);
    if (!response.ok) throw new BusError('http', 'Файл не получен (' + response.status + ').', response.status);
    return await response.blob();
  }

  function parseEvent(raw) {
    const line = raw.split('\n').find(l => l.startsWith('data:'));
    if (!line) return null;
    const payload = line.slice(5).trim();
    if (!payload) return null;
    if (payload === '[DONE]') return { done: true };
    try { return JSON.parse(payload); } catch { return null; }
  }

  async function chatNonStream({ messages, signal }) {
    const response = await request('/v1/chat/completions', {
      method: 'POST', headers: headers(), body: JSON.stringify({ messages, stream: false }), signal
    });
    const payload = await response.json();
    if (payload?.error) throw new BusError(payload.error.code || 'upstream_error', payload.error.message);
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new BusError('bad_response', 'Сервер вернул ответ без текста.');
    return { text, model: payload.model || null, usage: payload.usage || null };
  }

  /* Streaming chat. Returns {streamed, model, fallbackReason}.
   * If the stream cannot even start (CORS on SSE, proxy buffering, no body), we fall back
   * to a non-stream request and report it — the caller must show that honestly.
   * Once any text has arrived we never fall back: that would duplicate the answer.
   */
  async function chat({ messages, signal, onChunk }) {
    const started = Date.now();
    let delivered = '';
    let model = null;
    let streamFailure = null;
    try {
      const response = await request('/v1/chat/completions', {
        method: 'POST', headers: headers(), body: JSON.stringify({ messages, stream: true }), signal
      });
      if (!response.body) throw new BusError('stream_unsupported', 'Браузер не отдал тело потока.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
          model = event.model || model;
          const piece = event.choices?.[0]?.delta?.content;
          if (piece) { delivered += piece; onChunk?.(piece); }
        }
      }
      if (!delivered) throw new BusError('empty_stream', 'Сервер закрыл поток без текста.');
      return { streamed: true, model, wallMs: Date.now() - started, fallbackReason: null };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (delivered) throw error;                      // partial answer stays partial, never duplicated
      // Отказ по политике, по параметрам или по токену — вердикт сервера, а не транспорт:
      // повторять его без стрима бессмысленно и вредно.
      if (error instanceof BusError && ['content_blocked', 'bad_params', 'unauthorized'].includes(error.code)) throw error;
      streamFailure = error;
    }
    const fallback = await chatNonStream({ messages, signal });
    onChunk?.(fallback.text);
    return {
      streamed: false, model: fallback.model, wallMs: Date.now() - started,
      fallbackReason: streamFailure instanceof BusError ? streamFailure.code : 'network'
    };
  }

  window.BRIIX_BUS = {
    BusError, server, setServer, token, setToken, hasToken: () => !!token(),
    health, models, capability, modelById, submitJob, getJob, cancelJob, fileBlob, chat,
    invalidate: () => { modelsCache = { ts: 0, data: null }; }
  };
})();
