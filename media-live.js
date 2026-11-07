/* BRIIX Media Studio — optional "Приватный live (эксперимент)" mode.
 * Talks to the user's own local media-bff (127.0.0.1:8300 through an SSH tunnel),
 * polls jobs, fetches results as in-memory blob URLs. The bearer token lives in a
 * separate localStorage key, is never exported, and is never embedded in job records.
 * Without media-live.js the studio remains a pure local mock (media.js).
 */
(() => {
  'use strict';
  const DEFAULT_SERVER = 'http://127.0.0.1:8300';
  const TOKEN_KEY = 'briix-media-live-token';
  const POLL_MS = 2500;
  const blobUrls = new Map();   // media job id -> object URL
  const inflight = new Set();   // media job ids being fetched
  const polls = new Map();      // serverJobId -> timer
  let active = false;
  let host = null;

  const api = () => window.BRIIX_MEDIA && window.BRIIX_MEDIA._api;
  const server = () => { try { return JSON.parse(localStorage.getItem('briix-media-live-server')) || DEFAULT_SERVER; } catch { return DEFAULT_SERVER; } };
  const token = () => localStorage.getItem(TOKEN_KEY) || '';
  function setToken(value) {
    const v = String(value || '').trim();
    if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY);
  }

  function headers(extra = {}) {
    return { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json', ...extra };
  }

  async function checkHealth() {
    try {
      const r = await fetch(server() + '/health', { method: 'GET' });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  function banner(text) { host && host.setLiveBanner(text || ''); }

  async function submit({ type, prompt, project, ratio }) {
    if (!token()) { askToken(); return; }
    banner('');
    let payload;
    try {
      const r = await fetch(server() + '/jobs', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ type, prompt, params: ratio && type === 'image' ? { ratio } : {} })
      });
      if (r.status === 401) { api().toast('Сервер отклонил токен. Проверьте bearer-токен в настройках live-режима.', 'error'); askToken(); return; }
      if (r.status === 429) { api().toast('Очередь сервера заполнена. Попробуйте позже.', 'error'); return; }
      if (r.status === 503) { api().toast('Сервер или нужный бэкенд недоступен.', 'error'); return; }
      if (!r.ok) { api().toast('Сервер не принял задачу (' + r.status + ').', 'error'); return; }
      payload = await r.json();
    } catch {
      goMock('Сервер недоступен — включён мок-режим.');
      return;
    }
    const job = api().addJob({
      id: 'live-' + payload.job_id, type, prompt, project: project || '',
      status: 'queued', serverJobId: payload.job_id, resultUrl: null,
      provenance: { model: null, params: null, wall_clock_ms: null, queued_ms: null }
    });
    if (job) { api().toast('Live-задача отправлена на сервер.'); startPoll(job.id, payload.job_id); }
  }

  function goMock(message) {
    // Server unreachable: live jobs never hang forever in queued.
    const state = window.BRIIX_MEDIA && window.BRIIX_MEDIA.validate ? readJobs() : [];
    for (const j of state) {
      if (j.mode === 'live' && ['queued', 'running'].includes(j.status)) {
        host.patchJob(j.id, { status: 'interrupted', provenance: j.provenance });
      }
    }
    banner(message || 'Мок-режим (live недоступен). Активные live-задачи помечены как прерванные.');
    stopAllPolls();
    host.refresh();
    api().toast(message || 'Мок-режим (live недоступен).', 'error');
  }

  function readJobs() {
    try {
      const parsed = JSON.parse(localStorage.getItem('briix-media-v1'));
      return Array.isArray(parsed && parsed.jobs) ? parsed.jobs : [];
    }
    catch { return []; }
  }

  function startPoll(mediaJobId, serverJobId) {
    if (polls.has(serverJobId)) return;
    const timer = setInterval(async () => {
      let data;
      try {
        const r = await fetch(server() + '/jobs/' + encodeURIComponent(serverJobId), { headers: headers() });
        if (!r.ok) { if (r.status === 401) { stopPoll(serverJobId); goMock('Токен отклонён сервером — включён мок-режим.'); } return; }
        data = await r.json();
      } catch { stopPoll(serverJobId); goMock('Мок-режим (live недоступен): связь с сервером потеряна.'); return; }
      const patch = { status: data.status, provenance: data.provenance };
      if (data.status === 'ready' && data.result_url) {
        patch.resultUrl = server() + data.result_url;
        stopPoll(serverJobId);
      } else if (['error', 'cancelled', 'interrupted', 'expired'].includes(data.status)) {
        patch.error = data.error || null;
        stopPoll(serverJobId);
      }
      const j = host.patchJob(mediaJobId, patch);
      if (j && j.status === 'ready') { api().toast('Live-результат готов.'); prefetchBlob(j); }
    }, POLL_MS);
    polls.set(serverJobId, timer);
  }

  function stopPoll(serverJobId) { const t = polls.get(serverJobId); if (t) { clearInterval(t); polls.delete(serverJobId); } }
  function stopAllPolls() { for (const id of [...polls.keys()]) stopPoll(id); }

  function displayUrl(j) {
    if (j.status === 'expired') return null;
    if (blobUrls.has(j.id)) return blobUrls.get(j.id);
    if (j.status === 'ready' && j.resultUrl && !inflight.has(j.id)) prefetchBlob(j);
    return null;
  }

  async function prefetchBlob(j) {
    if (inflight.has(j.id)) return;
    inflight.add(j.id);
    try {
      const r = await fetch(j.resultUrl, { headers: { Authorization: 'Bearer ' + token() } });
      if (r.status === 404) { // retention/cleanup removed the file
        host.patchJob(j.id, { status: 'expired', resultUrl: null });
        blobUrls.delete(j.id);
        api().toast('Результат истёк: файл удалён с сервера (хранение 24 часа).', 'error');
        return;
      }
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      blobUrls.set(j.id, url);
      host.refresh();
    } catch { /* keep placeholder; retry on next display */ }
    finally { inflight.delete(j.id); }
  }

  async function download(j) {
    let url = blobUrls.get(j.id);
    if (!url && j.resultUrl) { await prefetchBlob(j); url = blobUrls.get(j.id); }
    if (!url) { api().toast('Результат недоступен (истёк или сервер недоступен).', 'error'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = 'briix-live-' + (j.serverJobId || j.id) + ({ image: '.png', music: '.wav', text: '.txt' })[j.type];
    document.body.append(a); a.click(); a.remove();
    api().toast('Live-результат подготовлен к скачиванию.');
  }

  async function cancel(j) {
    try { await fetch(server() + '/jobs/' + encodeURIComponent(j.serverJobId) + '/cancel', { method: 'POST', headers: headers() }); }
    catch { /* server gone: mark interrupted below */ }
    stopPoll(j.serverJobId);
    host.patchJob(j.id, { status: 'cancelled' });
    api().toast('Live-задача остановлена.');
  }

  function askToken() {
    host.toast('Для live-режима нужен bearer-токен вашего сервера (media-bff .env). Он хранится только в этом браузере.', 'error');
    const value = window.prompt('Bearer-токен media-bff (хранится только в этом браузере, ключ ' + TOKEN_KEY + '):');
    if (value && value.trim()) { setToken(value); api().toast('Токен сохранён локально.'); }
  }

  async function toggle() {
    if (!active) {
      const health = await checkHealth();
      if (!health) { goMock('Live недоступен: сервер не отвечает. Проверьте туннель (tools/briix-media-live-up.sh).'); return; }
      if (!token()) { askToken(); if (!token()) return; }
      active = true;
      banner('');
      api().toast('Live-режим включён. Бэкенды: ' + Object.entries(health.backends).map(([k, v]) => k + '=' + (v ? 'ok' : 'нет')).join(', '));
      recover();
    } else {
      active = false;
      stopAllPolls();
      api().toast('Live-режим выключен. Студия вернулась в локальный мок.');
    }
    host.refresh();
  }

  function recover() {
    // Reload during running: resume polling via stored serverJobId (Т4).
    let count = 0;
    for (const j of readJobs()) {
      if (j.mode === 'live' && j.serverJobId && ['queued', 'running'].includes(j.status)) {
        startPoll(j.id, j.serverJobId); count++;
      } else if (j.mode === 'live' && j.status === 'ready' && j.resultUrl && !blobUrls.has(j.id)) {
        prefetchBlob(j);
      }
    }
    if (count) api().toast('Восстановлено live-задач: ' + count + ' — продолжаю опрос сервера.');
  }

  window.BRIIX_MEDIA_LIVE = {
    active: () => active,
    toggle,
    submit,
    cancel,
    download,
    displayUrl,
    settings: () => ({ server: server(), hasToken: !!token() }),
    setToken,
    askToken,
    onHostReady() {
      host = window.BRIIX_MEDIA._api;
      // After reload with live previously active, resume automatically (Т4).
      const hadLive = readJobs().some(j => j.mode === 'live' && ['queued', 'running'].includes(j.status));
      if (hadLive) {
        checkHealth().then(h => {
          if (h && token()) { active = true; recover(); host.refresh(); }
          else goMock('Мок-режим (live недоступен): сервер не отвечает после перезагрузки страницы.');
        });
      }
    }
  };
})();
