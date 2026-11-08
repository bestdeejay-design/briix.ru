/* BRIIX Music — optional "Приватный live (эксперимент)" mode.
 * Instrumental and jingle briefs go to the user's own media-bff as type=music jobs;
 * the returned WAV is fetched with the bearer token and played by the studio player.
 * Vocals are never faked: song.vocal stays honest-unavailable until the catalog says ready.
 * Audio lives in memory as a blob URL; localStorage keeps only the brief and provenance.
 */
(() => {
  'use strict';
  const POLL_MS = 2500;
  const MAX_SERVER_DURATION = 30;
  const polls = new Map();      // serverJobId -> timer
  const audioCache = new Map(); // track id -> {url, blob, peaks, duration}
  let active = false;
  let catalog = { status: 'unavailable', model: null };
  let vocal = { status: 'unavailable', model: null };
  const api = () => window.BRIIX_MUSIC && window.BRIIX_MUSIC._api;
  const bus = () => window.BRIIX_BUS;
  const banner = text => api()?.setLiveBanner(text || '');
  const toast = (text, kind) => api()?.toast(text, kind);

  function askToken() {
    const value = window.prompt('Bearer-токен media-bff (хранится только в этом браузере, ключ briix-media-live-token):');
    if (value && value.trim()) { bus().setToken(value); toast('Токен сохранён локально.'); }
  }

  function goMock(reason) {
    active = false;
    stopAllPolls();
    banner(reason);
    for (const t of api().readTracks()) {
      if (t.mode === 'live' && ['queued', 'running'].includes(t.status)) api().patchTrack(t.id, { status: 'interrupted', error: reason });
    }
    api().refresh();
    toast(reason, 'error');
  }

  async function refreshCatalog(force = false) {
    try {
      catalog = await bus().capability('music.generate', force);
      vocal = await bus().capability('song.vocal', force);
    } catch (error) {
      catalog = { status: 'unavailable', model: null };
      vocal = { status: 'unavailable', model: null };
      if (error.code === 'unauthorized') { askToken(); throw error; }
    }
    return catalog;
  }

  async function toggle() {
    if (active) {
      const pending = api().readTracks().filter(t => t.mode === 'live' && ['queued', 'running'].includes(t.status)).length;
      active = false; stopAllPolls();
      banner(pending ? `Live выключен. На сервере остаётся задач: ${pending} — они продолжают считаться, но браузер их больше не опрашивает. Включите live, чтобы возобновить опрос.` : '');
      api().refresh(); toast('Live-режим выключен. Музыка вернулась в локальный мок.');
      return;
    }
    const health = await bus().health();
    if (!health) { banner('Live недоступен: сервер не отвечает. Проверьте туннель (tools/briix-media-live-up.sh).'); toast('Live недоступен: сервер не отвечает по /health.', 'error'); api().refresh(); return; }
    if (!bus().hasToken()) { askToken(); if (!bus().hasToken()) return; }
    try { await refreshCatalog(true); }
    catch { banner('Каталог моделей не получен: проверьте bearer-токен.'); api().refresh(); return; }
    if (catalog.status !== 'ready') {
      banner('Музыкальный бэкенд на сервере недоступен (music.generate: unavailable). Раздел остаётся в локальном моке.');
      toast('Сервер ответил, но music.generate помечен unavailable — включаю мок.', 'error');
      api().refresh(); return;
    }
    active = true; banner('');
    api().refresh();
    toast('Live-режим включён. Инструментал и джингл считает ' + (catalog.model || 'сервер') + '. Вокал: ' + (vocal.status === 'ready' ? 'готов' : 'не подключён') + '.');
    recover();
  }

  async function submit({ kind, prompt, project, duration, genre, mood, key, bpm }) {
    if (!bus().hasToken()) { askToken(); if (!bus().hasToken()) return; }
    if (kind === 'song') { toast('Вокал не подключён: задача не отправляется на сервер.', 'error'); return; }
    banner('');
    const localId = 'live-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    let serverJobId;
    try {
      serverJobId = await bus().submitJob({
        type: 'music', prompt,
        params: { duration: Math.min(MAX_SERVER_DURATION, Math.max(1, Number(duration) || 15)) },
        idempotencyKey: localId
      });
    } catch (error) {
      if (error.code === 'unauthorized') { askToken(); toast('Сервер отклонил токен.', 'error'); return; }
      if (error.code === 'queue_full') { toast('Очередь сервера заполнена. Попробуйте позже.', 'error'); return; }
      if (error.code === 'unavailable') { goMock('Музыкальный бэкенд недоступен — включён локальный мок.'); return; }
      goMock('Сервер недоступен — включён локальный мок.');
      return;
    }
    api().addTrack({
      id: localId, kind, genre, mood, key, goal: 'social', duration: Math.min(MAX_SERVER_DURATION, Number(duration) || 15),
      bpm, project, prompt, status: 'queued', serverJobId, resultUrl: null, provenance: null
    });
    startPoll(localId, serverJobId);
    toast('Бриф ушёл на сервер. Ждём WAV от ' + (catalog.model || 'musicgen-small') + '.');
  }

  function startPoll(trackId, serverJobId) {
    if (polls.has(serverJobId)) return;
    const timer = setInterval(async () => {
      let data;
      try { data = await bus().getJob(serverJobId); }
      catch (error) {
        stopPoll(serverJobId);
        if (error.code === 'gone') { api().patchTrack(trackId, { status: 'expired', error: 'Задача исчезла с сервера (retention 24 часа).' }); api().refresh(); return; }
        if (error.code === 'unauthorized') { goMock('Токен отклонён сервером — включён локальный мок.'); return; }
        goMock('Мок-режим (live недоступен): связь с сервером потеряна.');
        return;
      }
      const patch = { status: data.status, provenance: data.provenance || null };
      if (data.stage) patch.stage = data.stage;
      if (data.status === 'ready' && data.result_url) { patch.resultUrl = data.result_url; stopPoll(serverJobId); }
      else if (['error', 'cancelled', 'interrupted', 'expired'].includes(data.status)) { patch.error = data.error || null; stopPoll(serverJobId); }
      const track = api().patchTrack(trackId, patch);
      api().refresh();
      if (track?.status === 'ready') { toast('Live-трек готов.'); ensureAudio(track); }
    }, POLL_MS);
    polls.set(serverJobId, timer);
  }

  const stopPoll = id => { const t = polls.get(id); if (t) { clearInterval(t); polls.delete(id); } };
  const stopAllPolls = () => { for (const id of [...polls.keys()]) stopPoll(id); };

  async function peaksFrom(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    let ctx = null;
    try {
      ctx = new Ctx();
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      const channel = buffer.getChannelData(0);
      const buckets = 128;
      const size = Math.max(1, Math.floor(channel.length / buckets));
      const peaks = [];
      for (let i = 0; i < buckets; i++) {
        let peak = 0;
        for (let j = i * size; j < Math.min(channel.length, (i + 1) * size); j += 4) peak = Math.max(peak, Math.abs(channel[j]));
        peaks.push(peak);
      }
      const max = Math.max(...peaks, 0.0001);
      return { peaks: peaks.map(p => Math.max(6, Math.round(p / max * 100))), duration: Math.round(buffer.duration * 10) / 10 };
    } catch { return null; }
    finally { try { await ctx?.close(); } catch { /* already closed */ } }
  }

  async function ensureAudio(track) {
    if (!track || track.mode !== 'live' || track.status !== 'ready' || !track.resultUrl) return null;
    if (audioCache.has(track.id)) return audioCache.get(track.id);
    let blob;
    try { blob = await bus().fileBlob(track.resultUrl); }
    catch (error) {
      if (error.code === 'gone') { api().patchTrack(track.id, { status: 'expired', resultUrl: null, error: 'Результат истёк: файл удалён с сервера (хранение 24 часа).' }); api().refresh(); toast('Результат истёк — файл удалён с сервера.', 'error'); return null; }
      if (error.code === 'unauthorized') { goMock('Токен отклонён при скачивании — включён локальный мок.'); return null; }
      toast('Не удалось скачать WAV с сервера.', 'error');
      return null;
    }
    const decoded = await peaksFrom(blob);
    const entry = {
      url: URL.createObjectURL(blob), blob,
      peaks: decoded?.peaks || Array.from({ length: 128 }, () => 40),
      duration: decoded?.duration || track.duration,
      bytes: blob.size
    };
    audioCache.set(track.id, entry);
    if (decoded?.duration) api().patchTrack(track.id, { duration: decoded.duration });
    api().setAudio(track.id, entry);
    return entry;
  }

  async function cancel(track) {
    if (!track?.serverJobId) return;
    stopPoll(track.serverJobId);
    try { await bus().cancelJob(track.serverJobId); api().patchTrack(track.id, { status: 'cancelled' }); }
    catch { api().patchTrack(track.id, { status: 'interrupted', error: 'Не удалось отменить: сервер недоступен.' }); goMock('Отмена не подтверждена сервером — включён локальный мок.'); return; }
    api().refresh(); toast('Задача остановлена на сервере.');
  }

  async function resubmit(track) {
    if (!active) { toast('Включите live-режим, чтобы повторить серверную задачу.', 'error'); return; }
    await submit({ kind: track.kind, prompt: track.prompt, project: track.project, duration: track.duration, genre: track.genre, mood: track.mood, key: track.key, bpm: track.bpm });
  }

  function release(id) {
    const entry = audioCache.get(id);
    if (entry) { URL.revokeObjectURL(entry.url); audioCache.delete(id); }
  }

  function recover() {
    let count = 0;
    for (const t of api().readTracks()) {
      if (t.mode === 'live' && t.serverJobId && ['queued', 'running'].includes(t.status)) { startPoll(t.id, t.serverJobId); count++; }
    }
    if (count) toast('Восстановлено live-задач: ' + count + ' — продолжаю опрос сервера.');
  }

  window.BRIIX_MUSIC_LIVE = {
    active: () => active,
    toggle, submit, cancel, resubmit, ensureAudio, release, recover,
    catalog: () => catalog,
    vocalStatus: () => vocal.status,
    vocalModel: () => vocal.model,
    audioFor: id => audioCache.get(id) || null,
    refreshCatalog,
    onHostReady() {
      const pending = api().readTracks().some(t => t.mode === 'live' && ['queued', 'running'].includes(t.status));
      if (!pending) return;
      bus().health().then(async health => {
        if (!health || !bus().hasToken()) { goMock('Мок-режим (live недоступен): сервер не отвечает после перезагрузки страницы.'); return; }
        try { await refreshCatalog(true); } catch { return; }
        active = true; recover(); api().refresh();
      });
    }
  };
})();
