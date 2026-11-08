/* BRIIX Music Studio — isolated, deterministic local mock.
 * No provider requests, API keys, credits, uploads or model inference.
 * Sound is synthesised in the browser from sine/noise primitives: it is a placeholder,
 * not a generated song. Vocals are never synthesised in the demo.
 * The host supplies only UI helpers. Music state has its own storage key and schema.
 */
(() => {
  'use strict';
  const STORAGE_KEY = 'briix-music-v1';
  const MAX_TRACKS = 24;
  const MAX_ACTIVE = 4;
  const MAX_PROMPT = 1200;
  const MIN_PROMPT = 12;
  const SAMPLE_RATE = 32000;
  const PEAK_BUCKETS = 128;
  const KINDS = [
    { id: 'song', title: 'Песня с вокалом', short: 'Песня', capability: 'song.vocal', icon: 'mic', hint: 'В демо — минусовка и структура трека. Вокал и текст появятся только на live-модели.', defaultDuration: 20 },
    { id: 'instrumental', title: 'Инструментал', short: 'Инструментал', capability: 'music.generate', icon: 'music', hint: 'Фоновая музыка без вокала: подложка под видео, подкаст или презентацию.', defaultDuration: 20 },
    { id: 'jingle', title: 'Джингл и фон', short: 'Джингл', capability: 'music.generate', icon: 'sparkles', hint: 'Короткая заставка или спокойный фон для интерфейса и рекламы.', defaultDuration: 10 }
  ];
  const GENRES = [
    { id: 'lofi', name: 'Lo-fi hip-hop', bpm: 82, mode: 'minor', pad: .30, bass: .34, pluck: .26, decay: 7, drums: 'soft' },
    { id: 'ambient', name: 'Ambient', bpm: 68, mode: 'major', pad: .44, bass: .18, pluck: .14, decay: 3, drums: 'none' },
    { id: 'cinematic', name: 'Cinematic', bpm: 90, mode: 'minor', pad: .40, bass: .30, pluck: .20, decay: 5, drums: 'pulse' },
    { id: 'pop', name: 'Pop', bpm: 112, mode: 'major', pad: .26, bass: .32, pluck: .28, decay: 9, drums: 'full' },
    { id: 'electronic', name: 'Electronic', bpm: 124, mode: 'minor', pad: .24, bass: .34, pluck: .30, decay: 11, drums: 'full' },
    { id: 'acoustic', name: 'Acoustic', bpm: 96, mode: 'major', pad: .24, bass: .28, pluck: .32, decay: 12, drums: 'soft' }
  ];
  const MOODS = [
    { id: 'calm', name: 'Спокойное', bpm: -8, bright: 0, progression: 0 },
    { id: 'warm', name: 'Тёплое', bpm: -2, bright: 0, progression: 1 },
    { id: 'bright', name: 'Светлое и бодрое', bpm: 8, bright: 12, progression: 2 },
    { id: 'dramatic', name: 'Напряжённое', bpm: 4, bright: 0, progression: 3 }
  ];
  const KEYS = [
    { id: 'am', name: 'A minor', root: 45, mode: 'minor' },
    { id: 'cm', name: 'C minor', root: 48, mode: 'minor' },
    { id: 'c', name: 'C major', root: 48, mode: 'major' },
    { id: 'g', name: 'G major', root: 43, mode: 'major' }
  ];
  const GOALS = [['social', 'Соцсети и Reels'], ['video', 'Видео и реклама'], ['podcast', 'Подкаст и подложка'], ['product', 'Продукт и интерфейс'], ['personal', 'Личный проект']];
  const DURATIONS = [10, 20, 30];
  // Vocal-route (контракт bff): type=music + params.model. Лимиты и тайминги — из /v1/models.
  const VOCAL_MODES = [
    { id: 'flash', model: 'ace-step-flash', title: 'Flash', sub: 'LM 1.7B · быстро', max: 30, durations: [15, 30], fallbackSeconds: 111 },
    { id: 'pro', model: 'ace-step-pro', title: 'Pro', sub: 'LM 4B · максимум качества', max: 150, durations: [30, 60, 90, 150], fallbackSeconds: 596 }
  ];
  const MAX_LYRICS = 8000;
  const LYRIC_TAGS = ['intro', 'verse', 'chorus', 'bridge', 'outro'];
  const vocalMode = id => VOCAL_MODES.find(m => m.id === id) || VOCAL_MODES[0];
  const isVocalForm = () => liveActive() && form.kind === 'song';
  const durationsFor = () => isVocalForm() ? vocalMode(form.vocalMode).durations : DURATIONS;
  const PROGRESSIONS = {
    minor: [[[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], [[0, 3, 7], [10, 14, 17], [8, 12, 15], [10, 14, 17]], [[0, 3, 7], [3, 7, 10], [10, 14, 17], [5, 8, 12]], [[0, 3, 7], [5, 8, 12], [8, 12, 15], [7, 11, 14]]],
    major: [[[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], [[0, 4, 7], [5, 9, 12], [9, 12, 16], [7, 11, 14]], [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], [[0, 4, 7], [4, 7, 11], [5, 9, 12], [7, 11, 14]]]
  };
  const MODELS = [
    { id: 'ace-step', name: 'ACE-Step 1.5', maker: 'ACE Studio / StepFun', kind: 'song', access: 'Открытые веса', use: 'Песни с вокалом, инструменталы, длинные формы', note: 'Код распространяется по MIT; лицензию конкретных весов проверяют отдельно. Кандидат на CPU-пилот через GGUF-сборку.', url: 'https://github.com/ace-step/ACE-Step' },
    { id: 'stable-audio', name: 'Stable Audio Open Small', maker: 'Stability AI', kind: 'instrumental', access: 'Открытые веса', use: 'Короткие инструментальные фрагменты и звуки', note: 'Оптимизирована под короткие сэмплы; вокал не генерирует. Условия использования — по карточке модели.', url: 'https://huggingface.co/stabilityai/stable-audio-open-small' },
    { id: 'musicgen', name: 'MusicGen / AudioCraft', maker: 'Meta', kind: 'instrumental', access: 'Открытые веса', use: 'Инструментальные подложки по тексту', note: 'Только инструментал: вокал не является целевым сценарием. Код и веса имеют разные условия.', url: 'https://github.com/facebookresearch/audiocraft' },
    { id: 'yue', name: 'YuE', maker: 'Multimodal Art Projection', kind: 'song', access: 'Открытые веса', use: 'Песни с вокалом по тексту и лирике', note: 'Требовательна к ресурсам; часть весов распространяется на некоммерческих условиях — коммерческое применение проверяют отдельно.', url: 'https://github.com/multimodal-art-projection/YuE' },
    { id: 'diffrhythm', name: 'DiffRhythm', maker: 'ASLP-lab', kind: 'song', access: 'Открытые веса', use: 'Быстрые черновики песен с вокалом', note: 'Подходит для экспериментов с латентной диффузией; качество и лицензию проверяют на пилоте.', url: 'https://github.com/ASLP-lab/DiffRhythm' }
  ];
  const $ = (s, scope = document) => scope.querySelector(s);
  const $$ = (s, scope = document) => [...scope.querySelectorAll(s)];
  let host = null;
  let root = null;
  let liveBannerText = '';
  let liveRefusal = null;   // отказ политики контента: карточка, а не тост
  let tab = 'create';
  let libraryFilter = 'all';
  let libraryQuery = '';
  let modelKind = 'all';
  let timer = null;
  let storageOkay = true;
  let storageProtected = false;
  let detailId = null;
  let selectedId = null;
  let form = { kind: 'instrumental', genre: 'lofi', mood: 'calm', key: 'am', goal: 'social', duration: 20, bpm: 74, project: '', prompt: '', failNext: false, vocalMode: 'flash', lyrics: '', language: 'ru' };
  const audio = typeof Audio === 'function' ? new Audio() : null;
  if (audio) { audio.id = 'music-audio'; audio.preload = 'auto'; audio.hidden = true; document.body.append(audio); }
  const cache = new Map();
  const synths = new Map();
  let playing = false;
  const live = () => window.BRIIX_MUSIC_LIVE || null;
  const liveActive = () => !!(live() && live().active());
  const originLabel = () => liveActive() ? 'Приватный live' : 'Локальный мок';
  const LIVE_STATUSES = ['queued', 'running', 'ready', 'error', 'cancelled', 'interrupted', 'expired'];
  const kind = id => KINDS.find(k => k.id === id) || KINDS[1];
  const genre = id => GENRES.find(g => g.id === id) || GENRES[0];
  const mood = id => MOODS.find(m => m.id === id) || MOODS[0];
  const key = id => KEYS.find(k => k.id === id) || KEYS[0];
  const track = id => state.tracks.find(t => t.id === id);
  const esc = value => host.esc(value);
  const icon = name => host.icon(name);
  const uid = () => 'music-' + (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const readyTracks = () => state.tracks.filter(t => t.status === 'ready');
  const activeCount = () => state.tracks.filter(t => ['queued', 'running'].includes(t.status)).length;
  const clampBpm = value => Math.max(60, Math.min(160, Math.round(Number(value) || 90)));
  function suggestedBpm(genreId, moodId) { return clampBpm(genre(genreId).bpm + mood(moodId).bpm); }
  function fresh() { return { version: 1, tracks: [] }; }
  function validate(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.tracks) || raw.tracks.length > MAX_TRACKS) throw new Error('Неверный формат музыкального хранилища.');
    const ids = new Set();
    return { version: 1, tracks: raw.tracks.map(t => {
      const isLive = t.mode === 'live';
      const statuses = isLive ? LIVE_STATUSES : ['queued', 'running', 'ready', 'error', 'cancelled'];
      if (!t || typeof t.id !== 'string' || !/^[\w-]{1,100}$/.test(t.id) || ids.has(t.id) || !KINDS.some(k => k.id === t.kind) || !GENRES.some(g => g.id === t.genre) || !MOODS.some(m => m.id === t.mood) || !KEYS.some(k => k.id === t.key) || typeof t.prompt !== 'string' || typeof t.project !== 'string' || !statuses.includes(t.status)) throw new Error('Повреждена музыкальная задача.');
      if (isLive && (typeof t.serverJobId !== 'string' || !/^[\w-]{1,100}$/.test(t.serverJobId))) throw new Error('Повреждена live-задача: нет serverJobId.');
      ids.add(t.id);
      return {
        id: t.id, kind: t.kind, genre: t.genre, mood: t.mood, key: t.key,
        goal: GOALS.some(([id]) => id === t.goal) ? t.goal : 'social',
        duration: Number.isFinite(t.duration) ? Math.min(150, Math.max(5, Math.round(t.duration))) : 20,
        vocalMode: t.vocalMode === 'pro' ? 'pro' : 'flash',
        language: t.language === 'en' ? 'en' : 'ru',
        lyrics: typeof t.lyrics === 'string' ? t.lyrics.slice(0, MAX_LYRICS) : '',
        bpm: clampBpm(t.bpm), project: t.project.slice(0, 80), prompt: t.prompt.slice(0, MAX_PROMPT),
        status: ['queued', 'running'].includes(t.status) ? 'queued' : t.status,
        progress: t.status === 'ready' ? 100 : 0, favorite: !!t.favorite,
        seed: Number.isSafeInteger(t.seed) && t.seed >= 0 ? t.seed >>> 0 : seedFrom(t.prompt + t.genre + t.bpm),
        createdAt: Number.isFinite(t.createdAt) && t.createdAt > 0 && t.createdAt <= 8640000000000000 ? t.createdAt : Date.now(),
        fail: false,
        ...(isLive ? {
          mode: 'live', serverJobId: t.serverJobId,
          resultUrl: typeof t.resultUrl === 'string' && /^\/files\/[\w-]{1,100}$/.test(t.resultUrl) ? t.resultUrl : null,
          stage: typeof t.stage === 'string' ? t.stage.slice(0, 40) : null,
          error: typeof t.error === 'string' ? t.error.slice(0, 300) : null,
          provenance: t.provenance && typeof t.provenance === 'object' ? {
            model: typeof t.provenance.model === 'string' ? t.provenance.model.slice(0, 80) : null,
            capability: typeof t.provenance.capability === 'string' ? t.provenance.capability.slice(0, 40) : null,
            wall_clock_ms: Number.isFinite(t.provenance.wall_clock_ms) ? t.provenance.wall_clock_ms : null,
            queued_ms: Number.isFinite(t.provenance.queued_ms) ? t.provenance.queued_ms : null
          } : null
        } : { mode: 'mock' })
      };
    }) };
  }
  function load() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? validate(JSON.parse(raw)) : fresh(); }
    catch { storageProtected = true; return fresh(); }
  }
  let state = load();
  function persist() {
    if (!storageOkay || storageProtected) return false;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tracks: state.tracks.map(t => ({ ...t, status: t.status === 'running' ? 'queued' : t.status, progress: t.status === 'ready' ? 100 : 0 })) })); return true; }
    catch { storageOkay = false; updateNotice(); host?.toast('Музыкальная библиотека работает в памяти. Скачайте нужные черновики до закрытия страницы.', 'error'); return false; }
  }
  function updateNotice() {
    const el = $('#music-storage-notice', root || document); if (!el) return;
    el.hidden = storageOkay && !storageProtected;
    el.textContent = storageProtected ? 'Сохранённая библиотека повреждена. Исходные данные не перезаписаны; новые черновики доступны только в этой вкладке.' : 'Хранилище недоступно или заполнено. Черновики живут до закрытия страницы; скачайте нужные файлы.';
  }
  /* Deterministic placeholder synthesis: additive tones plus seeded noise, no samples, no network. */
  function seedFrom(text) {
    let h = 2166136261 >>> 0;
    for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const freq = midi => 440 * Math.pow(2, (midi - 69) / 12);
  function synthContext(t) {
    const g = genre(t.genre), m = mood(t.mood), k = key(t.key);
    const random = rng(t.seed);
    const mode = k.mode || g.mode;
    const chords = PROGRESSIONS[mode][m.progression];
    const beat = 60 / t.bpm, bar = beat * 4, eighth = beat / 2;
    const pattern = Array.from({ length: 8 }, () => Math.floor(random() * 3));
    const rests = Array.from({ length: 8 }, () => random() > (t.kind === 'jingle' ? .22 : .34));
    const noise = Float32Array.from({ length: 4096 }, () => random() * 2 - 1);
    return { t, g, m, k, chords, beat, bar, eighth, pattern, rests, noise, lead: t.kind === 'song' ? 1.18 : 1, total: Math.round(SAMPLE_RATE * t.duration) };
  }
  function sampleAt(c, index) {
    const time = index / SAMPLE_RATE;
    const barPos = time % c.bar;
    const chord = c.chords[Math.floor(time / c.bar) % c.chords.length];
    const rootMidi = c.k.root;
    const padEnv = Math.min(1, barPos / .35) * Math.min(1, (c.bar - barPos) / .35);
    let value = 0;
    for (let n = 0; n < chord.length; n++) {
      const f = freq(rootMidi + chord[n] + 12);
      value += (Math.sin(2 * Math.PI * f * time) * .6 + Math.sin(2 * Math.PI * f * 1.004 * time) * .4) * c.g.pad * padEnv / chord.length;
    }
    const beatPos = time % c.beat;
    const bassF = freq(rootMidi + chord[0] - 12);
    const bassEnv = c.g.drums === 'none' ? padEnv * .8 : Math.exp(-beatPos * 2.6);
    value += Math.sin(2 * Math.PI * bassF * time) * c.g.bass * bassEnv;
    const stepIndex = Math.floor(time / c.eighth) % 8;
    if (c.rests[stepIndex]) {
      const stepPos = time % c.eighth;
      const noteF = freq(rootMidi + chord[c.pattern[stepIndex]] + 24 + c.m.bright);
      const env = Math.exp(-stepPos * c.g.decay);
      value += (Math.sin(2 * Math.PI * noteF * time) + .32 * Math.sin(4 * Math.PI * noteF * time) + .12 * Math.sin(6 * Math.PI * noteF * time)) * c.g.pluck * env * c.lead;
    }
    if (c.g.drums !== 'none') {
      const beatIndex = Math.floor(time / c.beat) % 4;
      const soft = c.g.drums === 'soft' ? .55 : c.g.drums === 'pulse' ? .4 : 1;
      if (beatIndex === 0 || beatIndex === 2) value += Math.sin(2 * Math.PI * (52 + 70 * Math.exp(-beatPos * 30)) * beatPos) * Math.exp(-beatPos * 13) * .42 * soft;
      const hatPos = time % c.eighth;
      const n = c.noise[index % c.noise.length] - c.noise[(index + 1) % c.noise.length];
      value += n * Math.exp(-hatPos * 85) * .07 * soft;
      if (c.g.drums === 'full' && beatIndex === 2) value += c.noise[(index * 7) % c.noise.length] * Math.exp(-beatPos * 20) * .12;
    }
    const fade = Math.min(1, time / .06) * Math.min(1, (c.t.duration - time) / .8);
    return Math.tanh(value * 1.15) * Math.max(0, fade);
  }
  function wavBlob(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const text = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0, offset = 44; i < samples.length; i++, offset += 2) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }
  function peaksOf(samples) {
    const size = Math.max(1, Math.floor(samples.length / PEAK_BUCKETS));
    const peaks = [];
    for (let i = 0; i < PEAK_BUCKETS; i++) {
      let peak = 0;
      for (let j = i * size; j < Math.min(samples.length, (i + 1) * size); j += 3) peak = Math.max(peak, Math.abs(samples[j]));
      peaks.push(peak);
    }
    const max = Math.max(...peaks, .0001);
    return peaks.map(p => Math.max(.06, Math.round(p / max * 100)));
  }
  function createSynth(t) {
    const context = synthContext(t);
    const samples = new Float32Array(context.total);
    let index = 0;
    return {
      step(budget) {
        const end = Math.min(context.total, index + budget);
        for (; index < end; index++) samples[index] = sampleAt(context, index);
        return index / context.total;
      },
      finish() {
        let peak = 0;
        for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
        const gain = peak > 0 ? .89 / peak : 1;
        for (let i = 0; i < samples.length; i++) samples[i] *= gain;
        const blob = wavBlob(samples);
        return { url: URL.createObjectURL(blob), blob, peaks: peaksOf(samples), bytes: blob.size };
      }
    };
  }
  function ensureAudio(t) {
    if (cache.has(t.id)) return Promise.resolve(cache.get(t.id));
    if (t.mode === 'live') return live() ? live().ensureAudio(t).then(entry => entry || null) : Promise.resolve(null);
    return new Promise(resolve => {
      const synth = createSynth(t);
      const run = () => {
        const started = performance.now();
        let done = false;
        while (!done && performance.now() - started < 24) done = synth.step(SAMPLE_RATE / 4) >= 1;
        if (!done) { setTimeout(run, 0); return; }
        const result = synth.finish();
        cache.set(t.id, result);
        resolve(result);
      };
      run();
    });
  }
  function releaseAudio(id) {
    const entry = cache.get(id);
    if (entry) { URL.revokeObjectURL(entry.url); cache.delete(id); }
    if (selectedId === id) { stopPlayback(); selectedId = null; }
  }
  /* Queue: progress reflects real local synthesis of the placeholder, not a model. */
  function ensureTimer() { if (!timer && state.tracks.some(t => t.status === 'queued' && t.mode !== 'live')) timer = setInterval(tick, 220); }
  function tick() {
    let changed = false;
    for (const t of state.tracks) {
      if (t.mode === 'live') continue;
      if (t.status === 'queued') {
        if (state.tracks.filter(x => x.status === 'running').length >= MAX_ACTIVE) continue;
        if (t.fail) { t.status = 'error'; t.progress = 0; t.fail = false; changed = true; persist(); continue; }
        t.status = 'running'; t.progress = 0; synths.set(t.id, createSynth(t)); changed = true;
      }
      if (t.status !== 'running') continue;
      const synth = synths.get(t.id);
      if (!synth) { t.status = 'queued'; changed = true; continue; }
      const started = performance.now();
      let ratio = t.progress / 100;
      while (ratio < 1 && performance.now() - started < 26) ratio = synth.step(SAMPLE_RATE / 2);
      t.progress = Math.min(99, Math.round(ratio * 100));
      if (ratio >= 1) {
        const result = synth.finish();
        synths.delete(t.id);
        cache.set(t.id, result);
        t.status = 'ready'; t.progress = 100;
        if (playing) stopPlayback();
        selectedId = t.id;
        persist(); changed = true;
        host?.toast('Черновик готов: ' + (t.project || kind(t.kind).short) + ' · локальный мок');
      } else updateProgressRow(t);
    }
    if (changed) {
      persist(); renderPanel();
      // On stacked layouts the player sits under a long form: bring the finished draft into view.
      if (tab === 'create' && matchMedia('(max-width: 1150px)').matches) $('#music-preview', root)?.scrollIntoView({ behavior: host.reducedMotion?.matches ? 'auto' : 'smooth', block: 'start' });
    }
    updateCounts();
    if (!state.tracks.some(t => t.mode !== 'live' && ['queued', 'running'].includes(t.status))) { clearInterval(timer); timer = null; }
  }
  function updateProgressRow(t) {
    const bar = $(`[data-music-progress="${t.id}"]`, root || document);
    if (bar) { bar.style.width = t.progress + '%'; bar.parentElement?.setAttribute('aria-valuenow', String(t.progress)); }
    const inline = $(`[data-music-inline="${t.id}"]`, root || document);
    if (inline) inline.textContent = statusLabel(t);
  }
  function submit() {
    syncForm();
    const error = $('#music-form-error', root);
    const input = $('#music-prompt', root);
    if (form.prompt.trim().length < MIN_PROMPT) {
      if (error) { error.hidden = false; error.textContent = `Опишите задумку хотя бы ${MIN_PROMPT} символами — так бриф будет понятен и вам, и модели.`; }
      input?.setAttribute('aria-invalid', 'true'); input?.focus(); return;
    }
    if (state.tracks.length >= MAX_TRACKS) { host?.toast('В библиотеке уже 24 черновика. Удалите лишние, чтобы собрать новый.', 'error'); return; }
    if (activeCount() >= MAX_ACTIVE) { host?.toast('Одновременно собирается до четырёх черновиков. Дождитесь очереди.', 'error'); return; }
    if (error) error.hidden = true;
    input?.removeAttribute('aria-invalid');
    if (liveActive()) {
      if (form.kind === 'song') {
        const entry = live().vocalModels()[form.vocalMode];
        if (entry?.status !== 'ready') { host.toast('Этот режим вокала сейчас недоступен на сервере.', 'error'); return; }
        if (!form.lyrics.trim()) {
          if (error) { error.hidden = false; error.textContent = 'Для песни нужна лирика: сервер принимает её в params.lyrics (теги [verse], [chorus] и т. д.).'; }
          const area = $('#music-lyrics', root); area?.setAttribute('aria-invalid', 'true'); area?.focus(); return;
        }
      }
      live().submit({ kind: form.kind, prompt: form.prompt.trim(), project: form.project.trim(), duration: form.duration, genre: form.genre, mood: form.mood, key: form.key, bpm: form.bpm,
        vocalMode: form.vocalMode, lyrics: form.lyrics.trim(), language: form.language });
      return;
    }
    const t = {
      id: uid(), kind: form.kind, genre: form.genre, mood: form.mood, key: form.key, goal: form.goal,
      duration: form.duration, bpm: clampBpm(form.bpm), project: form.project.slice(0, 80), prompt: form.prompt.slice(0, MAX_PROMPT),
      status: 'queued', progress: 0, favorite: false, fail: form.failNext, seed: seedFrom(form.prompt + form.genre + form.mood + form.key + form.bpm + form.duration), createdAt: Date.now()
    };
    state.tracks.unshift(t);
    form.failNext = false;
    const failBox = $('#music-fail', root); if (failBox) failBox.checked = false;
    persist(); renderPanel(); updateCounts(); ensureTimer();
    host?.toast('Задача в очереди. Собираем локальную заглушку.');
  }
  function statusLabel(t) {
    if (t.mode === 'live') {
      const stages = { 'model-warmup': 'Сервер греет модель', generating: 'Генерация на сервере', 'writing-lyrics': 'Пишем лирику и вокал', synthesizing: 'Синтезируем звук', 'album-cover': 'Рисуем обложку' };
      return ({ queued: 'В очереди на сервере', running: stages[t.stage] || 'Работает на сервере', ready: 'Готово · live', error: 'Ошибка сервера', cancelled: 'Остановлено', interrupted: 'Прервано: связь с сервером потеряна', expired: 'Результат истёк на сервере' })[t.status] || t.status;
    }
    return ({ queued: 'В очереди', running: 'Собираем звук · ' + t.progress + '%', ready: 'Готово', error: 'Демо-ошибка', cancelled: 'Остановлено' })[t.status];
  }
  function date(value) { return new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function time(value) { const s = Math.max(0, Math.floor(value || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function metaLine(t) { return [kind(t.kind).short, genre(t.genre).name, mood(t.mood).name, t.bpm + ' BPM', key(t.key).name, t.duration + ' с'].join(' · '); }
  function structure(t) {
    const parts = t.kind === 'song' ? [['Интро', .15], ['Куплет 1', .25], ['Припев', .25], ['Куплет 2 / бридж', .2], ['Финал', .15]] : t.kind === 'jingle' ? [['Атака', .2], ['Основная тема', .5], ['Логотип-аккорд', .3]] : [['Вступление', .2], ['Развитие', .45], ['Спад', .2], ['Хвост', .15]];
    let cursor = 0;
    return parts.map(([name, share]) => {
      const from = cursor; const to = Math.min(t.duration, cursor + t.duration * share); cursor = to;
      return { name, from: time(from), to: time(to) };
    });
  }
  function heading() {
    return `<div class="page-header music-heading"><div><div class="eyebrow">Звуковая мастерская</div><h1>Музыка</h1><p>От идеи до чернового звучания. Спокойно, наглядно, в одном месте.</p></div><div class="music-heading-actions"><button class="btn music-live-toggle ${liveActive() ? 'active' : ''}" data-music-action="live" aria-pressed="${liveActive()}">${icon('route')}<span>${liveActive() ? 'Приватный live включён' : 'Приватный live (эксперимент)'}</span></button><button class="btn music-help" data-music-action="help">${icon('help')}<span>Как это работает</span></button></div></div>
      <div id="music-live-banner" class="storage-banner live-mode-banner" role="status" ${liveBannerText ? '' : 'hidden'}><span data-live-banner-text>${esc(liveBannerText)}</span><a class="text-btn" href="#/settings" data-live-settings ${/Настройках/.test(liveBannerText) ? '' : 'hidden'}>${icon('settings')}Ключ в Настройках</a></div>
      <div class="music-mode-note">${icon(liveActive() ? 'route' : 'flask')}<span>${liveActive()
        ? `<strong>Приватный live: считает ваш сервер.</strong> Три режима: инструментал и джингл (MusicGen), песня <strong>Flash</strong> (ACE-Step LM 1.7B, до 30 с) и песня <strong>Pro</strong> (LM 4B, до 150 с, полная структура). Вокалу нужна лирика — она уходит в <code>params.lyrics</code>. Результат приходит <strong>M4A (AAC 192k) с обложкой и встроенным текстом</strong>. Длительность инструментала задаёт модель: MusicGen даёт около 15 секунд, параметр отправляется, но бэкендом пока не учитывается. Доступность режимов и тайминги — из каталога шины.`
        : `<strong>Локальный мок, не нейросеть.</strong> Звук собирается в браузере из простых тонов и шума по жанру, темпу и настроению. Текст брифа влияет только на вариант заглушки. <strong>Вокал в демо не синтезируется:</strong> для песни вы получите минусовку и структуру трека. Без API, кредитов и загрузки файлов.`}</span></div>
      <div id="music-storage-notice" class="storage-banner" role="status" hidden></div>
      <div class="music-tabs" role="tablist" aria-label="Разделы музыкальной мастерской">${[['create', 'Создание', 'sparkles'], ['library', 'Треки', 'music'], ['queue', 'Очередь', 'clock'], ['models', 'Модели и рецепты', 'route']].map(([id, label, ic]) => `<button id="music-tab-${id}" role="tab" aria-selected="${tab === id}" aria-controls="music-panel" tabindex="${tab === id ? 0 : -1}" class="music-tab ${tab === id ? 'active' : ''}" data-music-action="tab" data-id="${id}">${icon(ic)}<span>${label}</span>${id === 'library' ? `<span class="music-count" id="music-library-count">${readyTracks().length}</span>` : id === 'queue' ? `<span class="music-count" id="music-queue-count">${activeCount()}</span>` : ''}</button>`).join('')}</div><section id="music-panel" role="tabpanel" aria-labelledby="music-tab-${tab}" tabindex="0"><div id="music-panel-content"></div></section>`;
  }
  function render() {
    if (!root || !host) return;
    root.innerHTML = `<div class="page music-page">${heading()}</div>`;
    renderPanel(); updateNotice(); updateCounts();
  }
  function renderPanel() {
    const container = $('#music-panel-content', root || document); if (!container) return;
    const focused = document.activeElement;
    const focusKey = focused?.closest('#music-panel [data-music-action]') ? { action: focused.dataset.musicAction, id: focused.dataset.id } : focused?.id ? { id: focused.id } : null;
    const panel = $('#music-panel', root); panel?.setAttribute('aria-labelledby', 'music-tab-' + tab);
    $$('.music-tab', root).forEach(b => { const on = b.dataset.id === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    container.innerHTML = tab === 'create' ? createMarkup() : tab === 'library' ? libraryMarkup() : tab === 'queue' ? queueMarkup() : modelsMarkup();
    if (tab === 'library') updateLibrary();
    if (tab === 'create') paintPlayer();
    if (focusKey) { const target = focusKey.action ? $$('#music-panel [data-music-action]', root).find(b => b.dataset.musicAction === focusKey.action && b.dataset.id === focusKey.id) : document.getElementById(focusKey.id); target?.focus({ preventScroll: true }); }
  }
  function createMarkup() {
    const k = kind(form.kind);
    const vocalCatalog = isVocalForm() ? live().vocalModels() : null;
    const vm = vocalMode(form.vocalMode);
    const vocalEntry = vocalCatalog ? vocalCatalog[vm.id] : null;
    const vocalBlocked = isVocalForm() && vocalEntry?.status !== 'ready';
    const current = track(selectedId) || readyTracks()[0] || null;
    if (current && current.status === 'ready') selectedId = current.id;
    return `<div class="music-create-layout"><form id="music-brief-form" class="music-brief" novalidate>
      <div class="music-section-title"><span class="eyebrow">01 / Бриф</span><span class="badge">Сохраняется локально</span></div>
      <div class="music-kind-switch" role="group" aria-label="Что нужно сделать">${KINDS.map(item => `<button type="button" class="${form.kind === item.id ? 'active' : ''}" aria-pressed="${form.kind === item.id}" data-music-action="kind" data-id="${item.id}">${icon(item.icon)}<span>${item.title}</span></button>`).join('')}</div>
      <p class="music-kind-hint" id="music-kind-hint">${icon('info')}<span>${esc(isVocalForm() ? 'ACE-Step поёт по вашей лирике. Flash — быстрый черновик до 30 секунд, Pro — полная структура до 150 секунд.' : k.hint)}</span></p>
      ${isVocalForm() ? `<div class="music-field"><span id="music-vocal-mode-label">Режим вокала</span><div class="music-vocal-modes" role="group" aria-labelledby="music-vocal-mode-label">${VOCAL_MODES.map(m => {
        const entry = vocalCatalog?.[m.id];
        const ready = entry?.status === 'ready';
        const seconds = Number.isFinite(entry?.latency?.seconds) ? entry.latency.seconds : m.fallbackSeconds;
        return `<button type="button" class="music-vocal-mode ${form.vocalMode === m.id ? 'active' : ''} ${ready ? '' : 'unavailable'}" data-music-action="vocal-mode" data-id="${m.id}" aria-pressed="${form.vocalMode === m.id}"><strong>${m.title}</strong><span>${esc(m.sub)}</span><small>до ${m.max} с · ≈${Math.round(seconds / 60 * 10) / 10} мин${ready ? '' : ' · недоступен'}</small></button>`;
      }).join('')}</div><p class="music-mode-timing">${icon('clock')}Тайминги — замер стенда из каталога шины, не обещание: очередь и холодный старт добавляют время.</p></div>` : ''}
      <label class="music-field">Задача<select id="music-goal">${GOALS.map(([id, name]) => `<option value="${id}" ${form.goal === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
      <label class="music-field">Название проекта <span class="muted">· необязательно</span><input id="music-project" maxlength="80" value="${esc(form.project)}" placeholder="Например, заставка для подкаста" autocomplete="off"></label>
      <label class="music-field" for="music-prompt">Опишите задумку</label><textarea id="music-prompt" class="music-prompt" rows="4" maxlength="${MAX_PROMPT}" aria-describedby="music-prompt-hint music-form-error" placeholder="Какое настроение, для чего звук, что должно происходить в треке?">${esc(form.prompt)}</textarea><div class="music-field-hint" id="music-prompt-hint"><span>Бриф для будущей модели и вариант заглушки</span><span id="music-prompt-count">${form.prompt.length} / ${MAX_PROMPT}</span></div>
      <div class="music-grid-2"><label class="music-field">Жанр<select id="music-genre">${GENRES.map(g => `<option value="${g.id}" ${form.genre === g.id ? 'selected' : ''}>${g.name}</option>`).join('')}</select></label><label class="music-field">Настроение<select id="music-mood">${MOODS.map(m => `<option value="${m.id}" ${form.mood === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label></div>
      <div class="music-grid-2"><label class="music-field">Тональность<select id="music-key">${KEYS.map(item => `<option value="${item.id}" ${form.key === item.id ? 'selected' : ''}>${item.name}</option>`).join('')}</select></label><label class="music-field" for="music-bpm">Темп <span class="muted">· BPM</span><span class="music-bpm-row"><input id="music-bpm" type="range" min="60" max="160" step="1" value="${form.bpm}"><output id="music-bpm-value" for="music-bpm">${form.bpm}</output></span></label></div>
      ${isVocalForm() ? `<label class="music-field" for="music-lyrics">Лирика <span class="muted">· обязательна для вокала</span><textarea id="music-lyrics" class="music-lyrics" rows="6" maxlength="${MAX_LYRICS}" placeholder="[verse]\nТёплый вечер за окном\n[chorus]\nМы ещё успеем домой">${esc(form.lyrics)}</textarea></label>
      <div class="music-lyric-tools"><span class="muted">Вставить тег:</span>${LYRIC_TAGS.map(t => `<button type="button" class="music-tag-btn" data-music-action="lyric-tag" data-id="${t}">[${t}]</button>`).join('')}<span class="music-lyrics-count" id="music-lyrics-count">${form.lyrics.length} / ${MAX_LYRICS}</span></div>
      <label class="music-field">Язык вокала<select id="music-language"><option value="ru" ${form.language === 'ru' ? 'selected' : ''}>Русский</option><option value="en" ${form.language === 'en' ? 'selected' : ''}>English</option></select></label>` : ''}
      <div class="music-field"><span id="music-duration-label">${isVocalForm() ? 'Длительность трека' : 'Длительность черновика'}</span><div class="music-durations" role="group" aria-labelledby="music-duration-label">${durationsFor().map(d => `<button type="button" class="${form.duration === d ? 'active' : ''}" aria-pressed="${form.duration === d}" data-music-action="duration" data-id="${d}">${d} с</button>`).join('')}</div></div>
      <details class="music-extra"><summary>Дополнительно</summary><label class="music-check"><input type="checkbox" id="music-fail" ${form.failNext ? 'checked' : ''}><span>Смоделировать ошибку очереди — чтобы проверить повтор</span></label><p class="music-extra-note">Заглушка собирается локально и занимает несколько секунд. Одновременно — до четырёх задач, в библиотеке — до 24 черновиков.</p></details>
      <div id="music-form-error" class="music-form-error" role="alert" hidden></div>
      ${liveRefusal ? `<div class="music-refusal" id="music-refusal" role="status">${icon('shield')}<div><strong>Не пройдена проверка контента</strong><p>${esc(liveRefusal.message || 'Запрос нарушает политику контента.')} Художественная нагота допустима, порнография — нет.</p><button type="button" class="btn small" data-music-action="edit-blocked">${icon('edit')}Изменить промпт</button></div></div>` : ''}
      ${vocalBlocked ? `<div class="music-unavailable" id="music-vocal-unavailable">${icon('mic')}<div><strong>Режим ${esc(vm.title)} сейчас недоступен</strong><p>Каталог шины отдаёт <code>${esc(vm.model)}: unavailable</code>. Инструментальные модели вокал не заменяют, поэтому задача не отправляется и подменять её минусовкой мы не будем. ${vocalCatalog && Object.values(vocalCatalog).some(v => v.status === 'ready') ? 'Другой режим вокала доступен — переключитесь выше.' : 'Инструментал работает.'}</p></div></div>` : ''}
      <button type="submit" class="btn primary music-submit" id="music-generate" ${vocalBlocked ? 'disabled aria-disabled="true"' : ''}>${icon(vocalBlocked ? 'mic' : 'sparkles')}${vocalBlocked ? 'Режим недоступен' : liveActive() ? (form.kind === 'song' ? 'Отправить песню на сервер' : 'Отправить на сервер') : 'Собрать черновик'}</button>
      <p class="music-submit-note">${icon('lock')}${liveActive() ? 'На ваш сервер уходит только бриф. Токен живёт в этом браузере.' : 'Ничего не отправляется наружу: ни текст, ни звук.'}</p>
    </form>
    <div class="music-output" id="music-preview">${previewMarkup(current)}</div></div>`;
  }
  function previewMarkup(t) {
    if (!t || t.status !== 'ready') {
      const pending = state.tracks.find(x => ['queued', 'running'].includes(x.status));
      const serverPending = pending?.mode === 'live';
      return `<div class="music-empty">${icon(pending ? 'clock' : 'music')}<h2>${pending ? 'Собираем черновик' : 'Здесь появится черновик'}</h2><p>${pending ? (serverPending ? 'Задача выполняется на вашем сервере. Ждём готовый WAV — прогресс показывает стадия сервера, а не проценты.' : 'Заглушка собирается прямо в браузере. Прогресс — реальная локальная работа, не скорость модели.') : 'Заполните бриф слева и нажмите «Собрать черновик». Результат можно послушать, скачать и сохранить в библиотеку.'}</p>${pending ? `<div class="music-progress" role="progressbar" aria-label="Сборка локальной заглушки" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pending.progress}"><span data-music-progress="${pending.id}" style="width:${pending.progress}%"></span></div><p class="music-empty-status" data-music-inline="${pending.id}">${statusLabel(pending)}</p>` : ''}</div>`;
    }
    const k = kind(t.kind);
    return `<article class="music-player-card">
      <div class="music-preview-head"><div><span class="eyebrow">02 / Черновик</span><h2>${esc(t.project || k.title)}</h2><p>${esc(metaLine(t))}</p></div><span class="badge ${t.mode === 'live' ? 'music-live-badge' : 'music-mock-badge'}">${icon(t.mode === 'live' ? 'route' : 'flask')}${t.mode === 'live' ? 'Live' : 'Мок'}</span></div>
      ${t.mode === 'live' ? `<div class="music-cover-row"><div class="music-cover-fallback" aria-hidden="true">${icon('music')}<span>BRIIX</span></div><p class="music-cover-note">Сервер отдаёт M4A (AAC 192k) со встроенной обложкой, текстом песни и тегами BRIIX. Текст и обложка видны в плеере и файловом менеджере; здесь — нейтральная заглушка, чтобы не тянуть парсер тегов.</p></div>` : ''}
      ${t.mode === 'live' ? provenanceMarkup(t) : ''}
      ${t.mode === 'live' && t.lyrics ? `<details class="music-lyrics-block"><summary>Текст песни</summary><p class="music-lyrics-view">${esc(t.lyrics)}</p></details>` : ''}
      ${t.kind === 'song' && t.mode !== 'live' ? `<div class="music-vocal-note">${icon('mic')}<span><strong>Это минусовка.</strong> Вокал, текст и живое исполнение появятся, когда к шине подключат модель с capability <code>song.vocal</code>.</span></div>` : ''}
      <div class="music-wave" id="music-wave" aria-hidden="true"><div class="music-wave-bars" data-music-bars></div><div class="music-wave-fill" id="music-wave-fill"><div class="music-wave-bars" data-music-bars></div></div></div>
      <div class="music-transport"><button class="music-play" data-music-action="play" data-id="${t.id}" aria-label="Прослушать черновик" aria-pressed="false">${icon('play')}</button><div class="music-seek"><label class="sr-only" for="music-seek">Позиция воспроизведения</label><input id="music-seek" type="range" min="0" max="${t.duration}" step="0.1" value="0"><div class="music-time"><span id="music-time-current">0:00</span><span id="music-time-total">${time(t.duration)}</span></div></div></div>
      <p class="music-player-note" id="music-player-status" role="status">Нажмите кнопку воспроизведения, чтобы послушать заглушку. Звук синтезируется локально.</p>
      <div class="music-preview-actions"><button class="btn small" data-music-action="download" data-id="${t.id}">${icon('download')}${fileLabel(t)}</button><button class="btn small" data-music-action="favorite" data-id="${t.id}" aria-pressed="${t.favorite}">${icon('star')}${t.favorite ? 'В избранном' : 'В избранное'}</button><button class="btn small" data-music-action="detail" data-id="${t.id}">${icon('file')}Бриф</button><button class="icon-btn small" data-music-action="delete" data-id="${t.id}" aria-label="Удалить черновик" title="Удалить черновик">${icon('trash')}</button></div>
      <div class="music-structure"><h3>Структура черновика</h3><ol>${structure(t).map(p => `<li><span>${esc(p.name)}</span><span class="music-structure-time">${p.from}–${p.to}</span></li>`).join('')}</ol><p class="music-structure-note">Разметка рассчитана по длительности и типу задачи. Это план для будущей модели, а не результат анализа звука.</p></div>
      <div class="music-next"><h3>Что дальше</h3><ul><li>Уточните жанр, темп и настроение в брифе.</li><li>Соберите два-три варианта и сравните направление.</li><li>Скачайте WAV и покажите команде как референс настроения.</li></ul></div>
    </article>`;
  }
  function provenanceMarkup(t) {
    const p = t.provenance || {};
    const seconds = Number.isFinite(p.wall_clock_ms) ? (p.wall_clock_ms / 1000).toFixed(1) + ' с' : '—';
    const queued = Number.isFinite(p.queued_ms) ? (p.queued_ms / 1000).toFixed(1) + ' с' : '—';
    return `<div class="music-provenance" data-music-provenance="${esc(t.id)}"><span class="eyebrow">Provenance · сервер</span><dl><div><dt>Модель</dt><dd>${esc(p.model || '—')}</dd></div><div><dt>Тип</dt><dd>${esc(p.capability || 'instrumental')}</dd></div><div><dt>Генерация</dt><dd>${seconds}</dd></div><div><dt>В очереди</dt><dd>${queued}</dd></div></dl><p class="music-provenance-note">${icon('route')}Файл получен с вашего сервера по bearer-токену и живёт в памяти вкладки. В хранилище браузера — только бриф и эти метаданные.</p></div>`;
  }
  function libraryMarkup() {
    return `<div class="music-library-head"><div><h2>Библиотека черновиков</h2><p>Всё живёт в этом браузере. Звук пересобирается по сохранённому брифу — файлы не хранятся в хранилище.</p></div><div class="music-library-actions"><button class="btn small" data-music-action="export">${icon('download')}Экспорт брифов</button><button class="btn small" data-music-action="clear">${icon('trash')}Очистить</button></div></div>
      <div class="music-library-controls"><div class="filter-tabs" role="group" aria-label="Фильтр треков">${[['all', 'Все'], ['song', 'Песни'], ['instrumental', 'Инструменталы'], ['jingle', 'Джинглы'], ['favorite', 'Избранные']].map(([id, label]) => `<button class="filter-tab ${libraryFilter === id ? 'active' : ''}" aria-pressed="${libraryFilter === id}" data-music-action="library-filter" data-id="${id}">${label}</button>`).join('')}</div><label class="inline-search">${icon('search')}<input id="music-library-search" type="search" placeholder="Поиск по названию и брифу" aria-label="Поиск по библиотеке треков" value="${esc(libraryQuery)}"></label></div>
      <div class="music-library-grid" id="music-library-grid"></div>`;
  }
  function updateLibrary() {
    const grid = $('#music-library-grid', root || document); if (!grid) return;
    const q = libraryQuery.trim().toLowerCase();
    const rows = readyTracks().filter(t => (libraryFilter === 'all' || (libraryFilter === 'favorite' ? t.favorite : t.kind === libraryFilter)) && (!q || (t.project + ' ' + t.prompt + ' ' + metaLine(t)).toLowerCase().includes(q)));
    grid.innerHTML = rows.length ? rows.map(t => `<article class="music-library-card" data-music-row="${t.id}"><div class="music-library-card-top"><span class="avatar tone-${t.kind === 'song' ? 'violet' : t.kind === 'jingle' ? 'amber' : 'teal'}">${icon(kind(t.kind).icon)}</span><button class="icon-btn small ${t.favorite ? 'is-favorite' : ''}" data-music-action="favorite" data-id="${t.id}" aria-pressed="${t.favorite}" aria-label="${t.favorite ? 'Убрать из избранного' : 'В избранное'}" title="${t.favorite ? 'Убрать из избранного' : 'В избранное'}">${icon('star')}</button></div><h3>${esc(t.project || kind(t.kind).title)}</h3><p class="music-library-meta">${esc(metaLine(t))}</p><p class="music-library-prompt">${esc(t.prompt.slice(0, 120))}${t.prompt.length > 120 ? '…' : ''}</p><div class="music-library-card-foot"><span class="music-library-date">${date(t.createdAt)}</span><div class="music-library-card-actions"><button class="icon-btn small" data-music-action="open" data-id="${t.id}" aria-label="Открыть черновик" title="Открыть">${icon('play')}</button><button class="icon-btn small" data-music-action="reuse" data-id="${t.id}" aria-label="Повторить бриф" title="Повторить бриф">${icon('refresh')}</button><button class="icon-btn small" data-music-action="detail" data-id="${t.id}" aria-label="Показать бриф" title="Бриф">${icon('file')}</button><button class="icon-btn small" data-music-action="delete" data-id="${t.id}" aria-label="Удалить черновик" title="Удалить">${icon('trash')}</button></div></div></article>`).join('') : `<div class="music-empty music-library-empty">${icon('music')}<h2>${readyTracks().length ? 'Ничего не нашлось' : 'Библиотека пока пуста'}</h2><p>${readyTracks().length ? 'Измените запрос или сбросьте фильтр.' : 'Соберите первый черновик на вкладке «Создание».'}</p><button class="btn small" data-music-action="${readyTracks().length ? 'reset-filter' : 'new'}">${icon(readyTracks().length ? 'refresh' : 'plus')}${readyTracks().length ? 'Сбросить фильтр' : 'Новый черновик'}</button></div>`;
  }
  function queueMarkup() {
    const rows = state.tracks.filter(t => t.status !== 'ready');
    return `<div class="music-queue-intro"><div><h2>Очередь сборки</h2><p>Прогресс показывает реальную локальную сборку заглушки. Это не скорость музыкальной модели.</p></div><button class="btn" data-music-action="new">${icon('plus')}Новый черновик</button></div><div class="music-queue-list">${rows.length ? rows.map(t => `<article class="music-queue-card" data-music-row="${t.id}"><span class="avatar tone-${t.kind === 'song' ? 'violet' : 'teal'}">${icon(kind(t.kind).icon)}</span><div class="music-queue-main"><div class="music-queue-title"><strong>${esc(t.project || kind(t.kind).title)}</strong><span class="badge ${t.status === 'error' ? 'music-status-error' : ''}" data-music-inline="${t.id}">${statusLabel(t)}</span></div><p>${esc(metaLine(t))} · ${date(t.createdAt)}</p>${['queued', 'running'].includes(t.status) ? `<div class="music-progress" role="progressbar" aria-label="Сборка локальной заглушки" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.progress}"><span data-music-progress="${t.id}" style="width:${t.progress}%"></span></div>` : `<p class="music-queue-note">${t.status === 'error' ? 'Демо-ошибка специально смоделирована. Повтор соберёт черновик заново.' : 'Задача остановлена. Бриф сохранён — можно повторить.'}</p>`}</div><div class="music-queue-actions">${['queued', 'running'].includes(t.status) ? `<button class="btn small" data-music-action="cancel" data-id="${t.id}">${icon('stop')}Остановить</button>` : `<button class="btn small" data-music-action="retry" data-id="${t.id}">${icon('refresh')}Повторить</button>`}<button class="icon-btn small" data-music-action="delete" data-id="${t.id}" aria-label="Удалить задачу" title="Удалить">${icon('trash')}</button></div></article>`).join('') : `<div class="music-empty">${icon('check')}<h2>Очередь пуста</h2><p>Все черновики собраны. Новые задачи появятся здесь.</p></div>`}</div>`;
  }
  function modelsMarkup() {
    return `<div class="music-model-intro"><div><h2>Модель — инструмент, а не весь продукт</h2><p>Справочный каталог направлений. Ни одна модель не подключена к демо. Вокал и инструментал — разные задачи и разные модели; условия лицензий проверяют по карточкам весов перед пилотом.</p></div><a class="btn" href="audits/task-23-model-bus-request.md" download>${icon('download')}Запрос к шине</a></div>
      <div class="filter-tabs music-model-filters" role="group" aria-label="Направление моделей">${[['all', 'Все направления'], ['song', 'Песни с вокалом'], ['instrumental', 'Инструментал']].map(([id, label]) => `<button class="filter-tab ${modelKind === id ? 'active' : ''}" aria-pressed="${modelKind === id}" data-music-action="model-filter" data-id="${id}">${label}</button>`).join('')}</div>
      <div class="music-model-grid">${MODELS.filter(m => modelKind === 'all' || m.kind === modelKind).map(m => `<article class="music-model-card"><div class="music-model-top"><span class="avatar tone-${m.kind === 'song' ? 'violet' : 'teal'}">${icon(m.kind === 'song' ? 'mic' : 'music')}</span><div><h3>${esc(m.name)}</h3><p>${esc(m.maker)}</p></div></div><div class="music-model-tags"><span class="skill">${m.kind === 'song' ? 'Вокал' : 'Инструментал'}</span><span class="skill">${esc(m.access)}</span></div><p class="music-model-use">${esc(m.use)}</p><p class="music-model-note">${esc(m.note)}</p><a class="text-btn" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Источник${icon('arrowRight')}</a></article>`).join('')}</div>
      <div class="music-recipe-note">${icon('flask')}<span>Как это станет рабочим: интерфейс отправляет бриф в шину моделей, шина ставит задачу в очередь и возвращает готовый файл. Экран, очередь и библиотека останутся такими же — заменится только источник звука.</span></div>`;
  }
  function updateCounts() {
    const library = $('#music-library-count', root || document); if (library) library.textContent = String(readyTracks().length);
    const queue = $('#music-queue-count', root || document); if (queue) queue.textContent = String(activeCount());
  }
  /* Player */
  function paintPlayer() {
    const t = track(selectedId);
    const holders = $$('[data-music-bars]', root || document);
    if (!t || t.status !== 'ready' || !holders.length) return;
    const draw = peaks => { holders.forEach(holder => { holder.innerHTML = peaks.map(p => `<span style="height:${p}%"></span>`).join(''); }); };
    const cached = cache.get(t.id);
    if (cached) draw(cached.peaks);
    else ensureAudio(t).then(result => { if (result && selectedId === t.id) draw(result.peaks); });
    syncTransport();
  }
  function syncTransport() {
    const button = $('#music-preview [data-music-action="play"]', root || document);
    if (button) { button.innerHTML = icon(playing ? 'stop' : 'play'); button.setAttribute('aria-pressed', String(playing)); button.setAttribute('aria-label', playing ? 'Остановить прослушивание' : 'Прослушать черновик'); }
    const t = track(selectedId);
    const seek = $('#music-seek', root || document);
    const current = $('#music-time-current', root || document);
    const fill = $('#music-wave-fill', root || document);
    const position = audio && t && audio.src ? Math.min(audio.currentTime, t.duration) : 0;
    if (seek && document.activeElement !== seek) seek.value = String(position);
    if (current) current.textContent = time(position);
    if (fill) fill.style.clipPath = 'inset(0 ' + (100 - (t ? Math.min(100, position / t.duration * 100) : 0)) + '% 0 0)';
  }
  function stopPlayback() {
    if (audio) { audio.pause(); audio.currentTime = 0; }
    playing = false; syncTransport();
  }
  async function togglePlayback(id) {
    const t = track(id); if (!t || t.status !== 'ready' || !audio) { host?.toast('Браузер не поддерживает воспроизведение звука.', 'error'); return; }
    if (playing && selectedId === id) { stopPlayback(); return; }
    const status = $('#music-player-status', root || document);
    if (selectedId !== id) { stopPlayback(); selectedId = id; if (tab === 'create') renderPanel(); }
    const entry = cache.get(id) || await ensureAudio(t);
    if (!entry) { host?.toast('Звук недоступен: файл не получен с сервера.', 'error'); return; }
    if (audio.src !== entry.url) { audio.src = entry.url; audio.currentTime = 0; }
    try {
      await audio.play();
      playing = true; syncTransport();
      if (status) status.textContent = 'Играет локальная заглушка. Это не работа нейросети.';
    } catch {
      playing = false; syncTransport();
      if (status) status.textContent = 'Браузер не дал запустить звук. Нажмите кнопку ещё раз или скачайте WAV.';
      host?.toast('Браузер ограничил воспроизведение. Попробуйте ещё раз или скачайте файл.', 'error');
    }
  }
  if (audio) {
    audio.addEventListener('timeupdate', syncTransport);
    audio.addEventListener('ended', () => { playing = false; audio.currentTime = 0; syncTransport(); const status = $('#music-player-status', root || document); if (status) status.textContent = 'Черновик закончился. Можно послушать снова или скачать WAV.'; });
    audio.addEventListener('error', () => { playing = false; syncTransport(); host?.toast('Не удалось воспроизвести заглушку. Скачайте WAV и откройте его плеером.', 'error'); });
  }
  /* Modals and data operations */
  function help() {
    host.openModal('Музыкальная мастерская без магии за кадром', `<div class="music-modal"><div class="music-help-steps"><div><span>01</span><strong>Соберите бриф</strong><p>Задача, название, описание, жанр, настроение, тональность, темп и длительность. Это реальное локальное состояние, а не декоративная форма.</p></div><div><span>02</span><strong>Послушайте заглушку</strong><p>Звук собирается в браузере из тонов и шума. Очередь, прогресс, отмена, ошибка и повтор работают по-настоящему.</p></div><div><span>03</span><strong>Сохраните направление</strong><p>Библиотека, избранное, поиск, скачивание WAV и экспорт брифов. Данные живут отдельно от диалогов и изображений.</p></div></div><h3>Чего здесь нет</h3><p>Нет нейросети, API-ключей, кредитов, загрузки файлов и отправки брифов провайдерам. <strong>Вокал не синтезируется:</strong> для песни с вокалом демо собирает минусовку и показывает структуру трека. Текст брифа не превращается в слова песни.</p><h3>Что будет на live-модели</h3><p>Бриф уйдёт в шину моделей, задача встанет в серверную очередь, а результат вернётся файлом. Песня с вокалом требует отдельной возможности <code>song.vocal</code>: инструментальные модели её не заменяют.</p></div>`, [{ label: 'Понятно, попробуем', primary: true, action: host.closeModal }], true);
  }
  function detail(id) {
    const t = track(id); if (!t) return;
    detailId = id;
    host.openModal(t.project || kind(t.kind).title, `<div class="music-modal"><div class="music-detail-meta">${esc(metaLine(t))}</div><div class="music-detail-block"><span class="eyebrow">Бриф</span><p>${esc(t.prompt)}</p></div><div class="music-detail-grid"><div><span class="eyebrow">Задача</span><p>${esc(GOALS.find(([gid]) => gid === t.goal)?.[1] || '—')}</p></div><div><span class="eyebrow">Создан</span><p>${date(t.createdAt)}</p></div><div><span class="eyebrow">Сид заглушки</span><p>${t.seed}</p></div><div><span class="eyebrow">Статус</span><p>${statusLabel(t)}</p></div></div><div class="music-detail-block"><span class="eyebrow">Структура</span><ol class="music-detail-structure">${structure(t).map(p => `<li>${esc(p.name)} — ${p.from}–${p.to}</li>`).join('')}</ol></div><p class="music-detail-disclaimer">${icon('flask')}Локальный мок: звук синтезирован в браузере, вокал не синтезируется. Скачанный WAV — референс настроения, а не готовый трек.</p></div>`, [
      { label: 'Закрыть', action: host.closeModal },
      { label: 'Повторить бриф', action: () => { host.closeModal(); reuse(id); } },
      { label: 'Скачать WAV', primary: true, action: () => downloadTrack(id) }
    ], true);
  }
  const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  // Chromium drops the suggested file name when it contains Cyrillic, so the download slug stays ASCII.
  function slug(value) {
    return String(value).toLowerCase().split('').map(ch => Object.hasOwn(TRANSLIT, ch) ? TRANSLIT[ch] : ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'draft';
  }
  // Название формата — из фактического ответа сервера, а не из привычки: стенд отдаёт M4A.
  function extOf(mime) { return /mp4|m4a|aac/.test(mime || '') ? 'm4a' : /mpeg|mp3/.test(mime || '') ? 'mp3' : 'wav'; }
  function fileLabel(t) { return t.mode === 'live' ? extOf(t.serverMime || 'audio/mp4').toUpperCase() : 'WAV'; }

  function saveBlob(entry, t) {
    const isServerFile = t.mode === 'live';
    const mime = entry.blob?.type || t.serverMime || (isServerFile ? 'audio/mp4' : 'audio/wav');
    const ext = mime.includes('wav') ? 'wav' : extOf(mime);
    const name = 'briix-music-' + slug(t.project || t.kind) + '-' + t.bpm + 'bpm.' + ext;
    host.download(name, entry.blob, mime);
    host.toast(isServerFile
      ? (ext === 'm4a' ? 'M4A сохранён — с обложкой, текстом и тегами BRIIX.' : ext === 'mp3' ? 'MP3 сохранён — с обложкой и тегами BRIIX.' : 'Файл сохранён с вашего сервера.')
      : 'WAV сохранён. Это локальная заглушка, не работа нейросети.');
  }
  function downloadTrack(id) {
    const t = track(id); if (!t || t.status !== 'ready') return;
    const cached = cache.get(id);
    if (cached) { saveBlob(cached, t); return; }
    ensureAudio(t).then(entry => { if (entry) saveBlob(entry, t); else host?.toast('Скачивание недоступно: файл не получен с сервера.', 'error'); });
  }
  function exportBriefs() {
    const hasLive = state.tracks.some(t => t.mode === 'live');
    const payload = {
      exportedAt: new Date().toISOString(),
      notice: hasLive
        ? 'Mixed export: local mock briefs plus private-live jobs from your own server. Live records carry server provenance; audio files are never exported.'
        : 'Local mock briefs. No model inference, no vocals, no provider requests.',
      tracks: state.tracks.map(({ id, kind: k, genre: g, mood: m, key: kk, goal, duration, bpm, project, prompt, seed, favorite, status, createdAt, mode, serverJobId, provenance }) => ({
        id, kind: k, genre: g, mood: m, key: kk, goal, duration, bpm, project, prompt, seed, favorite, status, createdAt,
        mode: mode || 'mock', ...(mode === 'live' ? { serverJobId, provenance: provenance || null } : {})
      }))
    };
    host.download('briix-music-briefs.json', JSON.stringify(payload, null, 2), 'application/json');
    host.toast('Брифы выгружены в JSON.');
  }

  function reuse(id) {
    const t = track(id); if (!t) return;
    form = { kind: t.kind, genre: t.genre, mood: t.mood, key: t.key, goal: t.goal, duration: t.duration, bpm: t.bpm, project: t.project, prompt: t.prompt, failNext: false, vocalMode: t.vocalMode || 'flash', lyrics: t.lyrics || '', language: t.language || 'ru' };
    tab = 'create'; renderPanel();
    $('#music-prompt', root)?.focus({ preventScroll: true });
    host.toast('Бриф перенесён в форму. Измените параметры и соберите новый вариант.');
  }
  function remove(id) {
    const t = track(id); if (!t) return;
    host.openModal('Удалить черновик?', `<div class="music-modal"><p>«${esc(t.project || kind(t.kind).title)}» будет удалён из этого браузера вместе с брифом. Скачанные файлы останутся на устройстве.</p></div>`, [{ label: 'Отмена', action: host.closeModal }, { label: 'Удалить', danger: true, action: () => { synths.delete(id); live()?.release(id); releaseAudio(id); state.tracks = state.tracks.filter(x => x.id !== id); persist(); host.closeModal(); renderPanel(); updateCounts(); host.toast('Черновик удалён.'); } }]);
  }
  function clearAll() {
    host.openModal('Очистить музыкальную мастерскую?', `<div class="music-modal"><p>Будут удалены все треки, брифы и отметки избранного. Активные задачи остановятся. Диалоги и изображения не затрагиваются.</p></div>`, [{ label: 'Отмена', action: host.closeModal }, { label: 'Скачать брифы', action: exportBriefs }, { label: 'Очистить', danger: true, action: () => { clearInterval(timer); timer = null; synths.clear(); [...cache.keys()].forEach(releaseAudio); stopPlayback(); selectedId = null; state = fresh(); storageProtected = false; storageOkay = true; persist(); host.closeModal(); render(); host.toast('Музыкальная мастерская очищена.'); } }]);
  }
  /* Form and events */
  function syncForm() {
    if (!root) return;
    const value = id => $('#' + id, root)?.value;
    if ($('#music-prompt', root)) form.prompt = value('music-prompt');
    if ($('#music-project', root)) form.project = value('music-project');
    if ($('#music-goal', root)) form.goal = value('music-goal');
    if ($('#music-genre', root)) form.genre = value('music-genre');
    if ($('#music-mood', root)) form.mood = value('music-mood');
    if ($('#music-key', root)) form.key = value('music-key');
    if ($('#music-bpm', root)) form.bpm = clampBpm(value('music-bpm'));
    if ($('#music-fail', root)) form.failNext = $('#music-fail', root).checked;
    if ($('#music-lyrics', root)) form.lyrics = value('music-lyrics').slice(0, MAX_LYRICS);
    if ($('#music-language', root)) form.language = value('music-language') === 'en' ? 'en' : 'ru';
    const count = $('#music-lyrics-count', root);
    if (count) count.textContent = form.lyrics.length + ' / ' + MAX_LYRICS;
  }
  const actions = {
    tab: el => { syncForm(); tab = el.dataset.id; renderPanel(); },
    kind: el => { syncForm(); form.kind = el.dataset.id; form.duration = isVocalForm() ? vocalMode(form.vocalMode).durations[0] : kind(form.kind).defaultDuration; renderPanel(); },
    'vocal-mode': el => { syncForm(); form.vocalMode = el.dataset.id; const d = vocalMode(form.vocalMode).durations; if (!d.includes(form.duration)) form.duration = d[0]; renderPanel(); },
    'lyric-tag': el => {
      syncForm();
      const area = $('#music-lyrics', root); if (!area) return;
      const tag = '[' + el.dataset.id + ']';
      const at = area.selectionStart ?? form.lyrics.length;
      form.lyrics = (form.lyrics.slice(0, at) + (at && !form.lyrics.slice(0, at).endsWith('\n') ? '\n' : '') + tag + '\n' + form.lyrics.slice(at)).slice(0, MAX_LYRICS);
      renderPanel();
      const next = $('#music-lyrics', root); if (next) { next.focus(); next.selectionStart = next.selectionEnd = next.value.length; }
    },
    'edit-blocked': () => { liveRefusal = null; live()?.clearRefusal(); renderPanel(); const area = $('#music-prompt', root); area?.focus(); area?.setSelectionRange(area.value.length, area.value.length); },
    duration: el => { syncForm(); form.duration = Number(el.dataset.id); renderPanel(); },
    'library-filter': el => { libraryFilter = el.dataset.id; renderPanel(); },
    'model-filter': el => { modelKind = el.dataset.id; renderPanel(); },
    'reset-filter': () => { libraryFilter = 'all'; libraryQuery = ''; renderPanel(); },
    new: () => { tab = 'create'; renderPanel(); $('#music-prompt', root)?.focus({ preventScroll: true }); },
    help,
    live: () => { if (live()) live().toggle(); else host.toast('Live-модуль не загрузился. Обновите страницу.', 'error'); },
    play: el => togglePlayback(el.dataset.id),
    open: el => { selectedId = el.dataset.id; tab = 'create'; renderPanel(); togglePlayback(el.dataset.id); },
    favorite: el => { const t = track(el.dataset.id); if (!t) return; t.favorite = !t.favorite; persist(); renderPanel(); host.toast(t.favorite ? 'Черновик в избранном' : 'Черновик убран из избранного'); },
    detail: el => detail(el.dataset.id),
    download: el => downloadTrack(el.dataset.id),
    reuse: el => reuse(el.dataset.id),
    delete: el => remove(el.dataset.id),
    export: exportBriefs,
    clear: clearAll,
    cancel: el => { const t = track(el.dataset.id); if (!t) return; if (t.mode === 'live') { live()?.cancel(t); return; } synths.delete(t.id); t.status = 'cancelled'; t.progress = 0; persist(); renderPanel(); updateCounts(); host.toast('Задача остановлена.'); },
    retry: el => { const t = track(el.dataset.id); if (!t) return; if (t.mode === 'live') { live()?.resubmit(t); return; } t.status = 'queued'; t.progress = 0; t.fail = false; persist(); renderPanel(); updateCounts(); ensureTimer(); }
  };
  document.addEventListener('click', event => {
    const el = event.target.closest?.('[data-music-action]');
    if (!el || !root || !host) return;
    const action = actions[el.dataset.musicAction];
    if (!action) return;
    event.preventDefault();
    action(el);
  });
  document.addEventListener('input', event => {
    if (!root || !host) return;
    const id = event.target.id;
    if (id === 'music-prompt') { form.prompt = event.target.value; const count = $('#music-prompt-count', root); if (count) count.textContent = form.prompt.length + ' / ' + MAX_PROMPT; const error = $('#music-form-error', root); if (error) error.hidden = true; event.target.removeAttribute('aria-invalid'); }
    if (id === 'music-project') form.project = event.target.value;
    if (id === 'music-bpm') { form.bpm = clampBpm(event.target.value); const out = $('#music-bpm-value', root); if (out) out.textContent = String(form.bpm); }
    if (id === 'music-library-search') { libraryQuery = event.target.value; updateLibrary(); }
    if (id === 'music-seek') { const t = track(selectedId); if (t && audio && audio.src) { audio.currentTime = Math.min(Number(event.target.value), t.duration); syncTransport(); } }
  });
  document.addEventListener('change', event => {
    if (!root || !host) return;
    const id = event.target.id;
    if (['music-genre', 'music-mood'].includes(id)) { syncForm(); form.bpm = suggestedBpm(form.genre, form.mood); renderPanel(); }
    if (['music-goal', 'music-key'].includes(id)) syncForm();
    if (id === 'music-fail') form.failNext = event.target.checked;
  });
  document.addEventListener('submit', event => { if (event.target.id === 'music-brief-form') { event.preventDefault(); submit(); } });
  document.addEventListener('keydown', event => {
    if (!event.target.closest?.('.music-tabs') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$('.music-tab', root); const index = tabs.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    syncForm(); tab = tabs[next].dataset.id; renderPanel(); tabs[next].focus();
  });
  $('#modal')?.addEventListener('close', () => { detailId = null; });
  window.addEventListener('pageshow', () => { if (state.tracks.some(t => t.status === 'queued')) ensureTimer(); });
  function suspend() {
    stopPlayback(); clearInterval(timer); timer = null; synths.clear();
    state.tracks.forEach(t => { if (t.mode !== 'live' && t.status === 'running') { t.status = 'queued'; t.progress = 0; } });
    persist();
  }
  window.BRIIX_MUSIC = {
    render(main, services) { host = services; root = main; render(); ensureTimer(); live()?.onHostReady(); },
    pause: stopPlayback,
    suspend,
    validate,
    // Narrow internal surface for music-live.js (optional live mode).
    _api: {
      toast: (text, kind) => host?.toast(text, kind),
      liveActive,
      originLabel,
      setRefusal: value => { liveRefusal = value || null; },
      setLiveBanner: text => {
        liveBannerText = text || '';
        const el = $('#music-live-banner', root || document); if (!el) return;
        el.hidden = !liveBannerText;
        const slot = $('[data-live-banner-text]', el); if (slot) slot.textContent = liveBannerText; else el.textContent = liveBannerText;
        const link = $('[data-live-settings]', el); if (link) link.hidden = !/Настройках/.test(liveBannerText);
      },
      readTracks: () => state.tracks.map(t => ({ ...t })),
      addTrack(data) {
        const t = validate({ version: 1, tracks: [{ ...data, mode: 'live', favorite: false, seed: seedFrom(data.prompt || ''), createdAt: Date.now(), progress: 0 }] }).tracks[0];
        state.tracks.unshift(t); persist(); updateCounts(); renderPanel();
        return t;
      },
      patchTrack(id, patch) {
        const t = track(id); if (!t) return null;
        Object.assign(t, patch);
        if (t.status === 'ready') t.progress = 100;
        persist(); updateCounts();
        return t;
      },
      setAudio(id, entry) { cache.set(id, entry); if (selectedId === id) paintPlayer(); },
      openPlayer(id) { selectedId = id; tab = 'create'; renderPanel(); },
      // Живём только на своём маршруте: автопроверка стенда из Настроек не должна
      // перерисовывать чужую страницу поверх формы ключа.
      refresh() { if (root && location.hash.split('?')[0].replace(/\/$/, '') === '#/music') { render(); updateCounts(); updateNotice(); } }
    }
  };
})();
