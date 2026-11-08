/* BRIIX — галерея сохранённых результатов стенда.
 * Это НЕ live: файлы лежат в assets/media/showcase/ и отдаются тем же ориджином.
 * Manifest.json — источник правды о названии, модели, дате, промпте и происхождении.
 * Текст песни и обложку достаём из самого M4A (атомы ©lyr и covr): никаких внешних
 * библиотек тегов и никаких выдуманных данных. Нет файла — так и пишем.
 */
(() => {
  'use strict';
  const BASE = 'assets/media/showcase/';
  const MANIFESTS = ['manifest.json', 'images.json'];
  const AUDIO_RE = /^[\w.-]{1,80}\.(m4a|mp3|wav)$/;
  const IMAGE_RE = /^[\w.-]{1,80}\.(png|jpg|jpeg|webp)$/;
  const MAX_ITEMS = 60;
  const FETCH_TIMEOUT_MS = 8000;   // зависший запрос не должен держать вкладку в «Читаем каталог» вечно

  // Мягкая загрузка: любой сбой (сеть, 404, 500, таймаут, не-JSON) — это «нет данных»,
  // а не сломанный раздел. Вкладка галереи рисуется всегда и не зависит от этого запроса.
  async function fetchSoft(url, asJson) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
      if (!response.ok) return null;
      return asJson ? await response.json() : await response.arrayBuffer();
    } catch { return null; }
    finally { clearTimeout(timer); }
  }
  let cache = null;
  let loading = null;
  const tagCache = new Map();

  const clean = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

  function normalize(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const file = clean(entry.file, 100);
    const kind = AUDIO_RE.test(file) ? 'audio' : IMAGE_RE.test(file) ? 'image' : null;
    if (!kind || file.includes('..') || file.includes('/')) return null;   // никаких путей наружу каталога
    const title = clean(entry.title, 120).trim();
    if (!title) return null;
    const duration = Number(entry.duration_seconds);
    return {
      id: file, kind, file, url: BASE + file, title,
      model: clean(entry.model, 80) || 'модель не указана',
      prompt: clean(entry.prompt, 4000),
      lyricsSource: clean(entry.lyrics_source, 300),
      lyricsEmbedded: clean(entry.lyrics_embedded, 120),
      date: /^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') ? entry.date : '',
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      bytes: Number.isFinite(Number(entry.size_bytes)) ? Number(entry.size_bytes) : null
    };
  }

  async function load(force = false) {
    if (cache && !force) return cache;
    if (loading && !force) return loading;
    loading = (async () => {
      const items = [];
      let meta = { license: '', branding: null, format: '' };
      let found = false;
      for (const name of MANIFESTS) {
        const payload = await fetchSoft(BASE + name, true);
        if (!payload || typeof payload !== 'object') continue;
        found = true;
        const list = Array.isArray(payload?.data) ? payload.data : [];
        for (const raw of list) {
          const item = normalize(raw);
          if (item && !items.some(x => x.id === item.id)) items.push(item);
          if (items.length >= MAX_ITEMS) break;
        }
        meta = {
          license: clean(payload?.license_scope, 60) || meta.license,
          branding: payload?.branding || meta.branding,
          format: clean(payload?.format, 200) || meta.format
        };
      }
      cache = { found, items, meta };
      loading = null;
      return cache;
    })();
    return loading;
  }

  /* Минимальный читатель атомов MP4: moov → udta → meta → ilst → ©lyr / covr.
   * Читаем только то, что положила наша же сборка ffmpeg; чужие форматы не угадываем. */
  function atoms(buffer, start, end, onAtom) {
    const view = new DataView(buffer);
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) break;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end) break;
      onAtom(type, offset + header, offset + size, header);
      offset += size;
    }
  }

  function readTags(buffer) {
    const out = { lyrics: '', title: '', artist: '', cover: null };
    const decoder = new TextDecoder('utf-8');
    const readData = (from, to) => {
      // атом данных: 4 байта размера + 4 байта типа ('data') + 4 флага + 4 locale
      const view = new DataView(buffer);
      let payloadFrom = from;
      let payloadTo = to;
      if (to - from >= 16) {
        const type = decoder.decode(new Uint8Array(buffer, from + 4, 4));
        if (type === 'data') { payloadFrom = from + 16; }
      }
      if (payloadTo <= payloadFrom) return { bytes: new Uint8Array(0), view };
      return { bytes: new Uint8Array(buffer, payloadFrom, payloadTo - payloadFrom), view };
    };
    const ilst = (from, to) => {
      atoms(buffer, from, to, (type, a, b) => {
        if (type === '©lyr') out.lyrics = decoder.decode(readData(a, b).bytes).trim();
        else if (type === '©nam') out.title = decoder.decode(readData(a, b).bytes).trim();
        else if (type === '©ART') out.artist = decoder.decode(readData(a, b).bytes).trim();
        else if (type === 'covr') {
          const { bytes } = readData(a, b);
          if (bytes.length) {
            const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
            out.cover = URL.createObjectURL(new Blob([bytes], { type: mime }));
          }
        }
      });
    };
    atoms(buffer, 0, buffer.byteLength, (type, a, b) => {
      if (type !== 'moov') return;
      atoms(buffer, a, b, (t2, a2, b2) => {
        if (t2 !== 'udta') return;
        atoms(buffer, a2, b2, (t3, a3, b3) => {
          if (t3 !== 'meta') return;
          atoms(buffer, a3 + 4, b3, (t4, a4, b4) => { if (t4 === 'ilst') ilst(a4, b4); });
        });
      });
    });
    return out;
  }

  async function tagsFor(item) {
    if (!item || item.kind !== 'audio') return null;
    if (tagCache.has(item.id)) return tagCache.get(item.id);
    const buffer = await fetchSoft(item.url, false);
    if (!buffer) return null;
    let tags = null;
    try { tags = readTags(buffer); }
    catch { tags = null; }
    if (tags) tagCache.set(item.id, tags);
    return tags;
  }

  const fmtTime = seconds => {
    if (!Number.isFinite(seconds)) return '—';
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  };
  const fmtDate = iso => {
    if (!iso) return 'дата не указана';
    const [y, m, d] = iso.split('-');
    return d + '.' + m + '.' + y;
  };
  const fmtSize = bytes => Number.isFinite(bytes) ? (bytes / 1048576).toFixed(1) + ' МБ' : '';

  window.BRIIX_SHOWCASE = {
    load, tagsFor, normalize, readTags, fmtTime, fmtDate, fmtSize,
    base: BASE,
    badge: 'Реальная генерация стенда (сохранённый результат)',
    items: () => cache?.items || [],
    state: () => ({ loaded: !!cache, found: !!cache?.found, items: cache?.items.length || 0, timeoutMs: FETCH_TIMEOUT_MS }),
    release() { for (const tags of tagCache.values()) if (tags?.cover) URL.revokeObjectURL(tags.cover); tagCache.clear(); }
  };
})();
