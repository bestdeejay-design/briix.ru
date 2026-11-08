/* Творческая база владельца внутри «Музыки».
 *
 * Это НЕ нейросеть и НЕ генерация. Модуль подбирает промпты и лирику из личной
 * галереи DJ1 (8202 трека) и подставляет их в бриф. Источник всегда подписан,
 * каждую подстановку можно отменить.
 *
 * Бережём телефон: индекс (≈2.2 МБ) грузится только по первому обращению,
 * лирика — одним шардом (≈270 КБ) и только когда текст действительно нужен.
 * Ни одного внешнего запроса: файлы лежат рядом с сайтом.
 */
(function () {
  'use strict';
  const DIR = 'assets/creative-base/';
  const MIN_SONG_LYRICS = 200; // символов: ниже — не песня, а пометка или обрывок
  const STOP = new Set(('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам сказал ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее кажется сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это the a an and or of to in for with on at by from as is are was were be been it its this that these those you your i we they he she his her them my me do does did have has had not no so if then than there here what which who how all any some more most very just about into over under out up down new').split(/\s+/));
  // Русская задумка → термины, которыми написана база. Это словарь музыкальных
  // понятий, а не выдуманные тексты: сами промпты и лирика остаются из базы.
  const BRIDGE = {
    любовь: 'love romantic', ночь: 'night dark', ночной: 'night dark', дождь: 'rain', грусть: 'sad melancholy',
    грустный: 'sad melancholy minor', тоска: 'melancholy longing', радость: 'happy uplifting', весёлый: 'happy upbeat',
    веселый: 'happy upbeat', спокойный: 'calm chill mellow', спокойствие: 'calm ambient', тепло: 'warm', тёплый: 'warm',
    теплый: 'warm', утро: 'morning sunrise', вечер: 'evening sunset', город: 'city urban', дорога: 'road driving',
    танец: 'dance groove', танцевальный: 'dance club', мечта: 'dream dreamy', сон: 'dream sleepy', память: 'memory nostalgic',
    расставание: 'heartbreak breakup', одиночество: 'lonely solitary', надежда: 'hope hopeful', свобода: 'freedom open',
    космос: 'space cosmic', море: 'ocean sea', лето: 'summer sunny', зима: 'winter cold', огонь: 'fire burning',
    гитара: 'guitar', пианино: 'piano', скрипка: 'strings violin', барабаны: 'drums', бас: 'bass', саксофон: 'saxophone',
    женский: 'female vocal', мужской: 'male vocal', вокал: 'vocal', голос: 'voice vocal', хор: 'choir',
    джаз: 'jazz', рок: 'rock', рэп: 'rap hip-hop', поп: 'pop', электроника: 'electronic synth', техно: 'techno',
    хаус: 'house', фонк: 'phonk', лоуфай: 'lo-fi', лоу: 'lo-fi', фолк: 'folk', соул: 'soul', фанк: 'funk',
    быстрый: 'fast upbeat energetic', медленный: 'slow downtempo', мощный: 'powerful heavy', нежный: 'soft tender gentle',
    кино: 'cinematic', реклама: 'commercial', подкаст: 'podcast intro', игра: 'game', колыбельная: 'lullaby',
    ретро: 'retro vintage', восьмидесятые: '80s synthwave', девяностые: '90s'
  };
  const stem = w => (w.length > 6 ? w.slice(0, 6) : w);
  const tokens = text => {
    const out = new Set();
    for (const raw of String(text || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9-]+/)) {
      if (raw.length < 3 || STOP.has(raw)) continue;
      out.add(stem(raw));
      const bridge = BRIDGE[raw] || BRIDGE[raw.replace(/е/g, 'ё')];
      if (bridge) for (const b of bridge.split(/[\s-]+/)) if (b.length > 2) out.add(stem(b));
    }
    return out;
  };

  let index = null, loading = null, stats = null;
  const shardCache = new Map();
  const tokenCache = new WeakMap();

  async function load() {
    if (index) return stats;
    if (loading) return loading;
    loading = (async () => {
      const res = await fetch(DIR + 'index.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error('base-unavailable');
      const data = await res.json();
      if (!data || !Array.isArray(data.entries)) throw new Error('base-broken');
      index = data.entries.map((row, id) => ({ id, name: row[0], sound: row[1], lang: row[2], plays: row[3], favorites: row[4], lyricId: row[5], lyricLen: row[6] || 0 }));
      stats = { entries: index.length, shardSize: data.shardSize, source: data.source || {}, russian: index.filter(e => e.lang === 'ru').length };
      return stats;
    })().catch(error => { loading = null; throw error; });
    return loading;
  }

  // Вариации в галерее часто отличаются только хвостом промпта. Для подсказки это
  // один и тот же материал: схлопываем по началу, чтобы варианты были разными.
  const family = sound => String(sound || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);

  function entryTokens(entry) {
    let set = tokenCache.get(entry);
    if (!set) { set = tokens(entry.sound + ' ' + entry.name); tokenCache.set(entry, set); }
    return set;
  }

  /* Подбор по смыслу брифа: совпадение терминов + лёгкий вес любимых владельцем
     записей. Никакой случайности — на один и тот же бриф приходит один и тот же
     первый вариант, «Другой вариант» листает следующих. */
  function match(query, { lang, limit = 8, withLyrics = false, skip = 0 } = {}) {
    if (!index) return [];
    const query_ = tokens(query);
    const scored = [];
    for (const entry of index) {
      // Для вокала берём только настоящие тексты: «[Instrumental]» и обрывки
      // в базе есть, но петь по ним нечего.
      if (withLyrics && (entry.lyricId < 0 || entry.lyricLen < MIN_SONG_LYRICS)) continue;
      if (lang && entry.lang !== lang) continue;
      const set = entryTokens(entry);
      let score = 0;
      for (const token of query_) if (set.has(token)) score += 1;
      if (!score) continue;
      score += Math.min(0.9, Math.log10(1 + entry.plays + entry.favorites * 8) / 4);
      scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score || b.entry.plays - a.entry.plays);
    // В галерее много вариаций одного трека: показываем разные материалы, а не
    // пять карточек с одинаковым промптом.
    const seen = new Set(), unique = [];
    for (const item of scored) {
      const key = withLyrics ? 'l' + item.entry.lyricId : 's' + family(item.entry.sound);
      if (seen.has(key)) continue;
      seen.add(key); unique.push(item.entry);
    }
    return unique.slice(skip, skip + limit);
  }

  // Если бриф совсем не совпал с базой, честно берём любимое владельцем, а не молчим.
  function fallback({ lang, limit = 8, withLyrics = false, skip = 0 } = {}) {
    if (!index) return [];
    const seen = new Set(), unique = [];
    for (const e of index) {
      if (withLyrics && (e.lyricId < 0 || e.lyricLen < MIN_SONG_LYRICS)) continue;
      if (lang && e.lang !== lang) continue;
      const key = withLyrics ? 'l' + e.lyricId : 's' + family(e.sound);
      if (seen.has(key)) continue;
      seen.add(key); unique.push(e);
    }
    return unique.slice(skip, skip + limit);
  }

  // Сначала — точное попадание на языке вокала, потом мягче, и только в самом
  // конце — просто любимые записи владельца. Пустой выдачи быть не должно.
  function pick(query, options = {}) {
    const strict = match(query, options);
    if (strict.length) return strict;
    const anyLang = match(query, { ...options, lang: null });
    if (anyLang.length) return anyLang;
    const own = fallback(options);
    return own.length ? own : fallback({ ...options, lang: null });
  }

  async function lyrics(entry) {
    if (!entry || entry.lyricId < 0) return '';
    const size = stats?.shardSize || 200;
    const shard = String(Math.floor(entry.lyricId / size)).padStart(2, '0');
    if (!shardCache.has(shard)) {
      const res = await fetch(DIR + 'lyrics-' + shard + '.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error('lyrics-unavailable');
      shardCache.set(shard, await res.json());
    }
    return shardCache.get(shard)[entry.lyricId] || '';
  }

  /* Обогащение промпта: своя задумка остаётся целиком, из базы дописываются
     только те приёмы звучания, которых в брифе ещё нет. */
  function enrichPrompt(current, entry, max = 1200) {
    const base = String(current || '').trim();
    if (!entry?.sound) return base;
    const own = tokens(base);
    // Промпты в базе чаще разделены точкой с запятой на цельные приёмы. Резать их
    // по запятым нельзя: «электрогитара в миноре, перебор» — один приём, а не два.
    const whole = String(entry.sound);
    const major = whole.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
    const parts = major.length > 1 ? major : whole.split(/,+/).map(s => s.trim()).filter(Boolean);
    // Сначала то, что описывает именно звучание, а не сцену.
    const sonic = /bpm|vocal|voice|voiced|guitar|piano|drum|bass|synth|reverb|tempo|baritone|soprano|falsetto|beat|гитар|пиани|барабан|бас|синтез|вокал|голос|темп|минор|мажор|реверб/i;
    const ordered = [...parts.filter(x => sonic.test(x)), ...parts.filter(x => !sonic.test(x))];
    const additions = [];
    for (const part of ordered) {
      const set = tokens(part);
      if (!set.size) continue;
      let shared = 0;
      for (const token of set) if (own.has(token)) shared++;
      if (shared / set.size > 0.5) continue;
      const candidate = [base, ...additions, part].join(', ');
      if (candidate.length > max) continue;
      additions.push(part);
      for (const token of set) own.add(token);
      if (additions.length >= 3) break;
    }
    return additions.length ? [base, ...additions].filter(Boolean).join(', ').slice(0, max) : base;
  }

  window.BRIIX_MUSIC_BASE = {
    load,
    ready: () => !!index,
    stats: () => stats,
    match,
    pick,
    byId: id => (index || []).find(e => e.id === Number(id)) || null,
    search: (query, options = {}) => (String(query || '').trim() ? match(query, options) : fallback(options)),
    lyrics,
    enrichPrompt,
    label: entry => (entry?.name && entry.name !== 'Untitled' ? entry.name : (entry?.sound || '').slice(0, 48) || 'Трек из базы'),
    sourceLabel: () => 'DJ1 · ' + (stats?.entries || 8202) + ' трека'
  };
})();
