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
  // media.js загружен раньше: live может стартовать с мобильной главной,
  // до первого открытия полной студии.
  let host = window.BRIIX_MEDIA?._api || null;
  let autoCheckedAt = 0;
  let autoStarting = null;
  let bannerText = '';
  const OFF_KEY = 'briix-live-off-v1';
  // Тот же ключ, что у bus-live.js, но модуль остаётся самостоятельным.
  function isOff() { try { return !!JSON.parse(localStorage.getItem(OFF_KEY) || '{}').media; } catch { return false; } }
  function setOff(off) {
    let map = {}; try { map = JSON.parse(localStorage.getItem(OFF_KEY) || '{}') || {}; } catch { map = {}; }
    if (off) map.media = true; else delete map.media;
    try { localStorage.setItem(OFF_KEY, JSON.stringify(map)); } catch { /* приватный режим */ }
  }
  const MOCK = {
    no_token: 'Мок: стенд не подключён — вставьте ключ в Настройках, и раздел сразу перейдёт на live.',
    unreachable: 'Мок: стенд недоступен — проверьте ключ и адрес шины в Настройках.',
    manual_off: 'Мок: live выключен вручную. Включите кнопкой «Приватный live» в заголовке раздела.'
  };

  const api = () => window.BRIIX_MEDIA && window.BRIIX_MEDIA._api;
  const server = () => {
    const host = location.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return location.origin + '/api';
    try { return JSON.parse(localStorage.getItem('briix-media-live-server')) || DEFAULT_SERVER; } catch { return DEFAULT_SERVER; }
  };
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

  function banner(text) { bannerText = text || ''; host && host.setLiveBanner(bannerText); }

  function goSettings() {
    banner(MOCK.no_token);
    host?.refresh();
    location.hash = '#/settings';
    setTimeout(() => document.querySelector('#stand-token')?.focus(), 60);
  }

  async function submit({ type, prompt, project, ratio }) {
    if (!token()) { goSettings(); return; }
    api().setRefusal(null);
    banner('');
    let payload;
    try {
      const r = await fetch(server() + '/jobs', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ type, prompt, params: ratio && type === 'image' ? { ratio } : {} })
      });
      if (r.status === 401) { api().toast('Стенд отклонил ключ. Обновите его в Настройках.', 'error'); goSettings(); return; }
      // 422 — вердикт модерации, а не сбой: карточка с текстом сервера, без мока и без retry.
      if (r.status === 422 || r.status === 400) {
        let payload = null;
        try { payload = await r.json(); } catch { /* пустое тело */ }
        if (r.status === 422 || payload?.error?.code === 'content_blocked') {
          api().setRefusal({ message: payload?.error?.message || 'Запрос нарушает политику контента.', prompt, type, at: Date.now() });
          host.refresh();
          return;
        }
        api().toast(payload?.error?.message || 'Сервер отклонил параметры запроса.', 'error');
        return;
      }
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
    let reachable = false;
    try {
      const r = await fetch(server() + '/jobs/' + encodeURIComponent(j.serverJobId) + '/cancel', { method: 'POST', headers: headers() });
      reachable = r.ok || r.status === 409; // сервер ответил: его правда принимаем
    } catch { /* сеть/туннель умерли: C2 — это НЕ «отменено» */ }
    stopPoll(j.serverJobId);
    if (reachable) {
      host.patchJob(j.id, { status: 'cancelled' });
      api().toast('Live-задача остановлена.');
    } else {
      // C2: сетевая ошибка отмены ≠ отменено. Прерываем и показываем баннер.
      host.patchJob(j.id, { status: 'interrupted', error: 'Не удалось отменить: сервер недоступен.' });
      banner('Связь с сервером потеряна при отмене. Задача помечена как прерванная; повтор доступен в очереди.');
      api().toast('Отменить не удалось: сервер недоступен. Задача прервана.', 'error');
    }
  }

  async function resubmit(j) {
    // C3: повтор прерванной/истёкшей live-задачи — новый серверный джоб.
    if (!token()) { askToken(); host.patchJob(j.id, { status: 'interrupted', error: 'Нет bearer-токена.' }); return; }
    banner('');
    let payload;
    try {
      const r = await fetch(server() + '/jobs', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ type: j.type, prompt: j.prompt, params: j.ratio && j.type === 'image' ? { ratio: j.ratio } : {} })
      });
      if (!r.ok) { host.patchJob(j.id, { status: 'error', error: 'Сервер не принял повтор (' + r.status + ').' }); api().toast('Сервер не принял повтор задачи.', 'error'); return; }
      payload = await r.json();
    } catch {
      host.patchJob(j.id, { status: 'interrupted', error: 'Сервер недоступен при повторе.' });
      banner('Мок-режим (live недоступен): повтор не отправлен.');
      return;
    }
    host.patchJob(j.id, { serverJobId: payload.job_id, status: 'queued', error: null });
    api().toast('Live-задача повторно отправлена на сервер.');
    startPoll(j.id, payload.job_id);
  }

  // Ключ вводится один раз в Настройках, window.prompt больше не используется.
  function askToken() { goSettings(); }

  async function toggle() {
    if (!active) {
      if (!token()) { goSettings(); return; }
      setOff(false);
      const ok = await autoStart({ force: true });
      if (ok) api().toast('Live-режим включён. Изображения считает ваш стенд.');
      else api().toast('Live не включился: смотрите пояснение в разделе.', 'error');
    } else {
      active = false;
      setOff(true);
      stopAllPolls();
      banner(MOCK.manual_off);
      api().toast('Live-режим выключен. Студия вернулась в локальный мок.');
    }
    host.refresh();
  }

  /* Live по умолчанию: ключ есть и стенд здоров — раздел живёт сам, без кликов. */
  async function performAutoStart({ force = false } = {}) {
    if (!force && Date.now() - autoCheckedAt < 10000) { host?.refresh(); return active; }
    autoCheckedAt = Date.now();
    if (isOff() && !force) { active = false; banner(MOCK.manual_off); host?.refresh(); return false; }
    if (!token()) { active = false; banner(MOCK.no_token); host?.refresh(); return false; }
    const health = await checkHealth();
    if (!health) { active = false; banner(MOCK.unreachable); host?.refresh(); return false; }
    active = true;
    banner('');
    host?.refresh();
    recover();
    return true;
  }
  function autoStart(options = {}) {
    if (autoStarting) return autoStarting;
    autoStarting = performAutoStart(options).finally(() => { autoStarting = null; });
    return autoStarting;
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
    resubmit,
    download,
    displayUrl,
    settings: () => ({ server: server(), hasToken: !!token() }),
    setToken,
    askToken,
    autoStart,
    goSettings,
    onHostReady() {
      host = window.BRIIX_MEDIA._api;
      banner(bannerText || (!token() ? MOCK.no_token : ''));
      const hadLive = readJobs().some(j => j.mode === 'live' && ['queued', 'running'].includes(j.status));
      autoStart().then(ok => {
        if (!ok && hadLive) goMock('Мок-режим (live недоступен): стенд не подтвердил режим после перезагрузки страницы.');
      });
    }
  };
})();
