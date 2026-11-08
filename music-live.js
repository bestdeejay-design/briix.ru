/* BRIIX Music — optional "Приватный live (эксперимент)" mode.
 * Briefs go to the user's own media-bff as type=music jobs; the returned M4A/MP3/WAV is
 * fetched with the bearer token and played by the studio player.
 * Three routes: MusicGen instrumental (no model), ACE-Step Flash and Pro (params.model +
 * params.lyrics + params.language). Every route stays honest-unavailable until the catalog
 * says ready — no instrumental substitution for a song, ever.
 * Audio lives in memory as a blob URL; localStorage keeps only the brief and provenance.
 */
(() => {
  'use strict';
  const POLL_MS = 2500;
  const MAX_SERVER_DURATION = 30;   // MusicGen route: backend clamps, keep the old cap
  const VOCAL_SPECS = {
    flash: { model: 'ace-step-flash', max: 30, seconds: 111 },
    pro: { model: 'ace-step-pro', max: 150, seconds: 596 }
  };
  const MAX_LYRICS = 8000;
  const polls = new Map();      // serverJobId -> timer
  const audioCache = new Map(); // track id -> {url, blob, peaks, duration}
  let active = false;
  let autoCheckedAt = 0;    // не дёргаем /health на каждый рендер раздела
  let catalog = { status: 'unavailable', model: null };
  let vocal = { status: 'unavailable', model: null };
  let vocalModels = { flash: { status: 'unavailable' }, pro: { status: 'unavailable' } };
  const api = () => window.BRIIX_MUSIC && window.BRIIX_MUSIC._api;
  const bus = () => window.BRIIX_BUS;
  const banner = text => api()?.setLiveBanner(text || '');
  const toast = (text, kind) => api()?.toast(text, kind);

  // Ключ вводится один раз в Настройках — здесь только маршрут туда.
  function goSettings() {
    banner(bus().mockBanner('no_token'));
    api()?.refresh();
    location.hash = '#/settings';
    setTimeout(() => document.querySelector('#stand-token')?.focus(), 60);
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
      const entries = {};
      for (const [id, spec] of Object.entries(VOCAL_SPECS)) {
        let entry = { status: 'unavailable', limits: null, latency: null };
        try { entry = await bus().modelById(spec.model, force); } catch { /* каталог уже упал — статус ниже */ }
        entries[id] = {
          id, status: entry.status === 'ready' ? 'ready' : 'unavailable', model: spec.model,
          limits: entry.limits || null,
          latency: entry.latency?.seconds ? entry.latency : { seconds: spec.seconds, note: 'замер стенда' },
          maxDuration: Number(entry.limits?.max_duration_seconds ?? entry.limits?.max_duration) || spec.max
        };
      }
      vocalModels = entries;
      if (Object.values(entries).some(e => e.status === 'ready')) vocal = { status: 'ready', model: entries.pro.status === 'ready' ? VOCAL_SPECS.pro.model : VOCAL_SPECS.flash.model };
    } catch (error) {
      catalog = { status: 'unavailable', model: null };
      vocal = { status: 'unavailable', model: null };
      vocalModels = { flash: { status: 'unavailable' }, pro: { status: 'unavailable' } };
      if (error.code === 'unauthorized') { throw error; }
    }
    return catalog;
  }

  async function toggle() {
    if (active) {
      const pending = api().readTracks().filter(t => t.mode === 'live' && ['queued', 'running'].includes(t.status)).length;
      active = false; stopAllPolls(); bus().setLiveOff('music', true);
      banner(pending ? `Мок: live выключен вручную. На сервере остаётся задач: ${pending} — они продолжают считаться, но браузер их больше не опрашивает. Включите live, чтобы возобновить опрос.` : bus().mockBanner('manual_off'));
      api().refresh(); toast('Live-режим выключен. Музыка вернулась в локальный мок.');
      return;
    }
    if (!bus().hasToken()) { goSettings(); return; }
    bus().setLiveOff('music', false);
    const started = await autoStart({ force: true });
    if (!started) { toast('Live не включился: смотрите пояснение в разделе.', 'error'); return; }
    const readyModes = Object.entries(vocalModels).filter(([, e]) => e.status === 'ready').map(([id]) => id === 'flash' ? 'Flash' : 'Pro');
    toast('Live-режим включён. Инструментал и джингл: ' + (catalog.status === 'ready' ? catalog.model || 'сервер' : 'недоступны') + '. Вокал: ' + (readyModes.length ? readyModes.join(' + ') : 'не подключён') + '.');
  }

  /* Live по умолчанию: ключ есть и стенд здоров — музыка считает на стенде без кликов. */
  async function autoStart({ force = false } = {}) {
    if (!force && Date.now() - autoCheckedAt < 10000) { api()?.refresh(); return active; }
    autoCheckedAt = Date.now();
    if (bus().isLiveOff('music') && !force) { active = false; banner(bus().mockBanner('manual_off')); api()?.refresh(); return false; }
    if (!bus().hasToken()) { active = false; banner(bus().mockBanner('no_token')); api()?.refresh(); return false; }
    const health = await bus().health();
    if (!health) { active = false; banner(bus().mockBanner('unreachable')); api()?.refresh(); return false; }
    try { await refreshCatalog(true); }
    catch (error) {
      active = false;
      banner(error?.code === 'unauthorized' ? bus().mockBanner('unauthorized') : 'Мок: каталог моделей не получен — проверьте ключ в Настройках.');
      api()?.refresh(); return false;
    }
    if (catalog.status !== 'ready' && vocal.status !== 'ready') {
      active = false;
      banner('Мок: музыкальные модели на стенде недоступны (music.generate и вокальные модели: unavailable). Раздел остаётся в локальном моке.');
      api()?.refresh(); return false;
    }
    active = true; banner('');
    api()?.refresh();
    recover();
    return true;
  }

  async function submit({ kind, prompt, project, duration, genre, mood, key, bpm, vocalMode = 'flash', lyrics = '', language = 'ru' }) {
    if (!bus().hasToken()) { goSettings(); return; }
    api()?.setRefusal(null);
    const isSong = kind === 'song';
    const spec = VOCAL_SPECS[vocalMode] || VOCAL_SPECS.flash;
    const entry = vocalModels[vocalMode] || { status: 'unavailable' };
    if (isSong && entry.status !== 'ready') { toast('Режим вокала недоступен: задача не отправляется на сервер.', 'error'); return; }
    if (isSong && !String(lyrics || '').trim()) { toast('Для песни нужна лирика — сервер принимает её в params.lyrics.', 'error'); return; }
    if (!isSong && catalog.status !== 'ready') { toast('Инструментальная модель недоступна: задача не отправляется на сервер.', 'error'); return; }
    const cap = isSong ? (entry.maxDuration || spec.max) : MAX_SERVER_DURATION;
    const seconds = Math.min(cap, Math.max(5, Number(duration) || (isSong ? 30 : 15)));
    const params = isSong
      ? { model: spec.model, lyrics: String(lyrics).slice(0, MAX_LYRICS), language: language === 'en' ? 'en' : 'ru', duration: seconds }
      : { duration: seconds };
    banner('');
    const localId = 'live-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    let serverJobId;
    try {
      serverJobId = await bus().submitJob({
        type: 'music', prompt,
        params,
        idempotencyKey: localId
      });
    } catch (error) {
      if (error.code === 'unauthorized') { goSettings(); toast('Стенд отклонил ключ — обновите его в Настройках.', 'error'); return; }
      if (error.code === 'content_blocked') {
        // Отказ модерации — не сбой сервера: мок не включаем, задачу не создаём, повтор не предлагаем.
        api()?.setRefusal({ message: error.message, prompt, kind, at: new Date().toISOString() });
        api().refresh();
        return;
      }
      if (error.code === 'bad_params') { toast(error.message || 'Сервер отклонил параметры брифа.', 'error'); return; }
      if (error.code === 'queue_full') { toast('Очередь сервера заполнена. Попробуйте позже.', 'error'); return; }
      if (error.code === 'unavailable') { goMock('Музыкальный бэкенд недоступен — включён локальный мок.'); return; }
      goMock('Сервер недоступен — включён локальный мок.');
      return;
    }
    api().addTrack({
      id: localId, kind, genre, mood, key, goal: 'social', duration: seconds,
      bpm, project, prompt, status: 'queued', serverJobId, resultUrl: null, provenance: null,
      vocalMode: isSong ? (vocalMode === 'pro' ? 'pro' : 'flash') : null,
      lyrics: isSong ? String(lyrics).slice(0, MAX_LYRICS) : '', language: isSong ? language : null,
      serverModel: isSong ? spec.model : catalog.model || 'musicgen-small'
    });
    startPoll(localId, serverJobId);
    toast(isSong
      ? 'Бриф ушёл на сервер. Ждём песню от ' + spec.model + ' — это минуты, а не секунды.'
      : 'Бриф ушёл на сервер. Ждём аудио от ' + (catalog.model || 'musicgen-small') + '.');
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
      if (data.mime) patch.serverMime = data.mime;
      if (data.status === 'ready' && data.result_url) { patch.resultUrl = data.result_url; stopPoll(serverJobId); }
      else if (data.status === 'ready' && !data.result_url) { patch.error = 'Сервер сообщил о готовности, но не отдал ссылку на файл.'; stopPoll(serverJobId); }
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
      toast('Не удалось скачать аудиофайл с сервера.', 'error');
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
    await submit({ kind: track.kind, prompt: track.prompt, project: track.project, duration: track.duration, genre: track.genre, mood: track.mood, key: track.key, bpm: track.bpm, vocalMode: track.vocalMode || 'flash', lyrics: track.lyrics || '', language: track.language || 'ru' });
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
    toggle, submit, cancel, resubmit, ensureAudio, release, recover, autoStart, goSettings,
    catalog: () => catalog,
    vocalStatus: () => vocal.status,
    vocalModels: () => vocalModels,
    clearRefusal: () => api()?.setRefusal(null),
    vocalModel: () => vocal.model,
    audioFor: id => audioCache.get(id) || null,
    refreshCatalog,
    onHostReady() {
      const pending = api().readTracks().some(t => t.mode === 'live' && ['queued', 'running'].includes(t.status));
      autoStart().then(ok => {
        if (!ok && pending) goMock('Мок-режим (live недоступен): стенд не подтвердил режим после перезагрузки страницы.');
      });
    }
  };
})();
