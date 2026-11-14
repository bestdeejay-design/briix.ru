/* Музыкальный мозг BRIIX — правила из репозитория dj1/brain.
 *
 * Это НЕ нейросеть и НЕ генерация: модуль детерминированно перекладывает
 * задумку с русского на теги ACE-Step по правилам мозга
 * (dj1/brain/knowledge/prompt-rules.md, model-acestep.md, song-structure.md,
 * style-taxonomy.md — срез 2026-11-14):
 *   - порядок тегов: жанр → инструменты → вокал → BPM → настроение → эпоха → продакшн;
 *   - словарь только из таксономии корпуса (8202 трека);
 *   - никаких негативов: «без реверберации» → dry close-mic production;
 *   - вокальным трекам — тег языка лирики (Russian lyrics);
 *   - темп указывается явно (N BPM), теги строчными через запятую.
 * Каркас лирики — по song-structure.md: секции в квадратных скобках,
 * припев повторяется явно, эффекты в скобках, никаких (x3).
 * Модуль не ходит в сеть и не подменяет текст автора: только собирает теги
 * и структуру, каждая подстановка обратима (кнопка «Вернуть задумку»).
 */
(function () {
  'use strict';

  const MAX_TAGS = 240;          // brain/knowledge/model-acestep.md: теги разумно <= 250
  const SOURCE = 'dj1/brain · knowledge/prompt-rules.md + style-taxonomy.md';

  // Словари — только теги таксономии корпуса (style-taxonomy.md).
  // Ключи — русские слова задумки, значения — теги ACE-Step.
  const GENRE_WORDS = [
    ['психоделик соул', 'psychedelic soul'], ['психоделик-соул', 'psychedelic soul'],
    ['соул', 'soul'], ['тех-хаус', 'tech house'], ['tech house', 'tech house'],
    ['техно-хаус', 'tech house'], ['хаус', 'house'], ['лоуфай', 'lo-fi'], ['lo-fi', 'lo-fi'],
    ['лоу-фай', 'lo-fi'], ['трэп', 'trap'], ['trap', 'trap'], ['эмбиент', 'ambient'],
    ['ambient', 'ambient'], ['поп', 'pop'], ['рок', 'rock'], ['джаз', 'jazz'],
    ['техно', 'techno'], ['хип-хоп', 'hip-hop'], ['рэп', 'rap'], ['фонк', 'phonk'],
    ['фанк', 'funk'], ['фолк', 'folk'], ['баллад', 'ballad'], ['трип-хоп', 'trip-hop'],
    ['синтвейв', 'synthwave'], ['ретровейв', 'synthwave'], ['шансон', 'chanson'],
    ['индастриал', 'industrial'], ['оркестр', 'orchestral'], ['транс', 'trance'],
    ['электро', 'edm'], ['r&b', 'r&b']
  ];
  const FORM_GENRE = {           // жанр из формы «Музыки» → тег таксономии
    lofi: 'lo-fi', ambient: 'ambient', cinematic: 'cinematic', pop: 'pop',
    electronic: 'house', acoustic: 'folk'
  };
  const INSTRUMENT_WORDS = [
    ['акустическ гитар', 'acoustic guitar'], ['электрогитар', 'electric guitar'],
    ['гитар', 'guitar'], ['пианин', 'piano'], ['роял', 'piano'], ['орган', 'organ'],
    ['хаммонд', 'organ'], ['саксофон', 'saxophone'], ['скрипк', 'strings'],
    ['виолончел', 'cello'], ['контрабас', 'upright bass'], ['бас', 'bass'],
    ['808', '808'], ['синтезатор', 'synth'], ['синт', 'synth'], ['аккордеон', 'accordion'],
    ['барабан', 'drums'], ['бит', 'drums'], ['педал', 'pads'], ['пэд', 'pads']
  ];
  const VOCAL_WORDS = [
    ['женск', 'female vocals'], ['мужск', 'male vocals'], ['баритон', 'male baritone'],
    ['брутальн', 'male baritone'], ['шепот', 'whisper'], ['шёпот', 'whisper'], ['spoken word', 'spoken word'],
    ['речитатив', 'spoken word'], ['хор', 'choir'], ['фальцет', 'falsetto'],
    ['бэк-вокал', 'backing vocals']
  ];
  const MOOD_WORDS = [
    ['грустн', 'melancholic'], ['груст', 'melancholic'], ['тоск', 'melancholic'],
    ['печал', 'melancholic'], ['ностальг', 'nostalgic'], ['темн', 'dark'], ['тёмн', 'dark'],
    ['мрачн', 'dark'], ['гипнотич', 'hypnotic'], ['кинематограф', 'cinematic'],
    ['нежн', 'emotional'], ['мечтат', 'dreamy'], ['энергичн', 'euphoric'],
    ['спокойн', 'dreamy'], ['романтич', 'emotional'], ['холодн', 'cold'],
    ['возвышенн', 'ethereal'], ['агрессив', 'aggressive'], ['тревожн', 'haunting'],
    ['тёпл', 'warm'], ['тепл', 'warm'], ['городск', 'urban'], ['атмосферн', 'atmospheric'],
    ['психоделич', 'psychedelic'], ['приподнят', 'euphoric']
  ];
  const ERA_WORDS = [
    ['70-е', '70s'], ['70-х', '70s'], ['70х', '70s'], ['семидесят', '70s'], ['1970', '70s'],
    ['80-е', '80s'], ['80-х', '80s'], ['80х', '80s'], ['восьмидесят', '80s'], ['1980', '80s'],
    ['90-е', '90s'], ['90-х', '90s'], ['90х', '90s'], ['девяност', '90s'], ['1990', '90s']
  ];
  const PROD_WORDS = [
    ['винил', 'vinyl crackle'], ['трещин винил', 'vinyl crackle'], ['плёнк', 'tape saturation'],
    ['пленк', 'tape saturation'], ['аналог', 'analog warmth'], ['кассет', 'tape saturation'],
    ['трещащ', 'vinyl crackle'], ['live-', 'live'], ['живой запис', 'live'],
    ['дожд', 'rain atmosphere'], ['ночной город', 'night city'], ['пустын', 'desert'],
    ['космос', 'space'], ['кафе', 'cafe'], ['склад', 'warehouse']
  ];
  // Негативы задумки → позитивные теги (brain/knowledge/model-acestep.md).
  const POSITIVE = [
    [/без\s+реверб/i, 'dry close-mic production'],
    [/без\s+кульмина/i, 'flat dynamics, loop-like'],
    [/без\s+фальцет/i, 'full-voice delivery'],
    [/без\s+женск/i, 'male vocals only'],
    [/без\s+мужск/i, 'female vocals only'],
    [/без\s+(слов|вокал|текст)/i, 'instrumental'],
    [/no\s+reverb/i, 'dry close-mic production'],
    [/no\s+climax/i, 'flat dynamics, loop-like'],
    [/no\s+falsetto/i, 'full-voice delivery'],
    [/no\s+female/i, 'male vocals only'],
    [/no\s+male/i, 'female vocals only'],
    [/no\s+(lyrics|vocals)/i, 'instrumental']
  ];
  const LANG_TAGS = { ru: 'Russian lyrics', en: 'English lyrics', fr: 'French lyrics' };
  const FORM_MOOD = { calm: 'dreamy', warm: 'warm', bright: 'euphoric', dramatic: 'dark' };

  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  function scan(text, pairs, max) {
    const hits = [];
    for (const [word, tag] of pairs) {
      if (text.includes(norm(word)) && !hits.some(h => h.tag === tag)) {
        hits.push({ from: word, tag });
        if (max && hits.length >= max) break;
      }
    }
    return hits;
  }

  /* Сборка тегов ACE-Step из задумки.
     Возвращает { tags, notes } — notes это провенанс: какое слово во что легло. */
  function buildTags(brief, options = {}) {
    const text = norm(brief);
    const notes = [];
    const push = (tag, from) => {
      if (tag && !notes.some(n => n.tag === tag)) notes.push({ from: from || null, tag });
    };

    // 1. Жанр: слово из задумки сильнее жанра формы; без жанра — жанр формы.
    const genre = scan(text, GENRE_WORDS, 2);
    if (genre.length) genre.forEach(g => push(g.tag, g.from));
    else if (FORM_GENRE[options.genre]) push(FORM_GENRE[options.genre], 'жанр формы');

    // 2. Инструменты: 2–5 тегов таксономии.
    scan(text, INSTRUMENT_WORDS, 5).forEach(i => push(i.tag, i.from));

    // 3. Вокал: для песни — пол/стиль и язык; для инструментала — instrumental.
    const isSong = options.kind === 'song';
    const vocal = scan(text, VOCAL_WORDS, 3);
    if (isSong) {
      if (vocal.length) vocal.forEach(v => push(v.tag, v.from));
      else push('vocals', null);
      push(LANG_TAGS[options.language] || LANG_TAGS.ru, 'язык вокала');
    } else {
      push('instrumental', null);
    }

    // 4. Темп: явно, как требует мозг.
    push(String(Math.max(60, Math.min(180, Math.round(Number(options.bpm) || 128)))) + ' BPM', 'темп формы');

    // 5. Настроение: из задумки (до 3), иначе из настроения формы.
    const mood = scan(text, MOOD_WORDS, 3);
    if (mood.length) mood.forEach(m => push(m.tag, m.from));
    else push(FORM_MOOD[options.mood] || 'atmospheric', 'настроение формы');

    // 6. Эпоха и 7. продакшн/атмосфера — если распознаны в задумке.
    scan(text, ERA_WORDS, 1).forEach(e => push(e.tag, e.from));
    scan(text, PROD_WORDS, 3).forEach(p => push(p.tag, p.from));

    // Негативы задумки → позитивные теги.
    for (const [re, tag] of POSITIVE) {
      if (re.test(brief || '')) push(tag, 'негатив перефразирован');
    }

    // Сборка: строчные, через запятую, без точки, в пределах лимита —
    // лишнее отрезаем целыми тегами, а не посреди слова.
    const tags = [];
    for (const note of notes) {
      const candidate = tags.concat(note.tag).join(', ');
      if (candidate.length > MAX_TAGS) break;
      tags.push(note.tag);
    }
    return { tags: tags.join(', '), notes, source: SOURCE };
  }

  /* Каркас лирики по brain/knowledge/song-structure.md.
     Только метки секций и звуковые указания — текст автор вписывает сам;
     существующий текст модуль никогда не перезаписывает. */
  function buildLyricsSkeleton(brief, options = {}) {
    const text = norm(brief);
    const isSong = options.kind === 'song';
    if (!isSong) return '[Instrumental]';
    const fx = [];
    if (text.includes('дожд')) fx.push('rain');
    if (text.includes('винил') || text.includes('кассет')) fx.push('vinyl crackle');
    if (text.includes('ночной город') || text.includes('город')) fx.push('night city ambience');
    if (text.includes('космос')) fx.push('space ambience');
    const sound = fx.length ? ': ' + fx.join(', ') : '';
    // Базовая структура поп/рок-баллады из song-structure.md; припев повторяется
    // явно, бридж один. Секции — канонические английские метки ACE-Step.
    return [
      '[Intro' + sound + ']',
      '',
      '[Verse 1]',
      '',
      '',
      '',
      '',
      '[Pre-Chorus]',
      '',
      '',
      '[Chorus]',
      '',
      '',
      '',
      '',
      '[Verse 2]',
      '',
      '',
      '',
      '',
      '[Chorus]',
      '',
      '',
      '',
      '',
      '[Bridge]',
      '',
      '',
      '[Chorus]',
      '',
      '',
      '',
      '',
      '[Outro]',
      ''
    ].join('\n');
  }

  window.BRIIX_MUSIC_BRAIN = {
    version: '2026-11-14',
    source: SOURCE,
    buildTags,
    buildLyricsSkeleton,
    // словари открыты для проверок и отладки
    rules: { MAX_TAGS, POSITIVE, LANG_TAGS, tagOrder: ['genre', 'instruments', 'vocals', 'bpm', 'mood', 'era', 'production'] }
  };
})();
