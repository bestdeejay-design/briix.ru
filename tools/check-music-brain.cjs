/* Музыкальный мозг (music-brain.js): правила dj1/brain в демо BRIIX.
 * Проверяем честно и по делу:
 *  - теги собираются по правилам мозга: строчные, позитивные («без X» → позитив),
 *    с явным BPM, тегом языка у вокала и instrumental у инструментала, <= 240 симв.;
 *  - порядок таксономии: жанр первым, детерминированность один в один;
 *  - каркас лирики: канонические секции, припев дважды, свой текст не перезаписывается;
 *  - UI: кнопка «Теги по правилам мозга» заменяет задумку с возможностью вернуть,
 *    источник подписан, внешних запросов нет, вёрстка не ломается.
 * Run: node tools/check-music-brain.cjs
 */
const { launch, OUT } = require('./browser-env.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.BRIIX_BRAIN_PORT || 0);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// Мок шины: вокальные модели готовы — иначе форма песни (лирика) не откроется.
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const route = url.pathname.replace(/^\/api/, '');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (route === '/health') return res.end(JSON.stringify({ ok: true, queue_len: 0, running: 0, backends: { music: 'ready' } }));
    if (route === '/v1/models') return res.end(JSON.stringify({ data: [
      { id: 'ace-step-flash', kind: 'music-vocal', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 111 } },
      { id: 'musicgen-small', kind: 'music', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 80 } }
    ] }));
    if (route === '/jobs' && req.method === 'POST') return (res.statusCode = 202, res.end(JSON.stringify({ job_id: 'brain-job-1' })));
    res.statusCode = 404; return res.end('{}');
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const host = () => {
  const os = require('node:os');
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
};

(async () => {
  await new Promise(resolve => server.listen(PORT, '0.0.0.0', resolve));
  const BASE = `http://${host()}:${server.address().port}`;
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(base => {
    localStorage.setItem('briix-media-live-token', 'brain-key');
    localStorage.setItem('briix-media-live-server', JSON.stringify(base + '/api'));
  }, BASE);
  const page = await context.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERR', e.message); });
  page.on('request', r => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) external.push(r.url()); });

  await page.goto(BASE + '/#/music');
  await page.waitForSelector('.music-page');
  await page.waitForFunction(() => window.BRIIX_MUSIC_LIVE?.active?.() === true, null, { timeout: 20000 });

  // 1. Модуль на месте, без сети, словари открыты.
  const mod = await page.evaluate(() => ({
    present: !!window.BRIIX_MUSIC_BRAIN,
    version: window.BRIIX_MUSIC_BRAIN?.version,
    order: window.BRIIX_MUSIC_BRAIN?.rules?.tagOrder
  }));
  assert.ok(mod.present, 'модуль мозга не загрузился');
  assert.deepEqual(mod.order, ['genre', 'instruments', 'vocals', 'bpm', 'mood', 'era', 'production'], 'порядок таксономии мозга изменился');
  ok('brain module loaded with the dj1/brain tag order', { version: mod.version });

  // 2. Правила сборки тегов — на сигнатурной задумке автора.
  const sig = await page.evaluate(() => {
    const brief = 'Ночной психоделик-соул из 70-х, брутальный мужской баритон шёпотом, мотель в пустыне, без кульминации';
    const r = window.BRIIX_MUSIC_BRAIN.buildTags(brief, { kind: 'song', genre: 'lofi', mood: 'dramatic', bpm: 72, language: 'ru' });
    const again = window.BRIIX_MUSIC_BRAIN.buildTags(brief, { kind: 'song', genre: 'lofi', mood: 'dramatic', bpm: 72, language: 'ru' });
    return { tags: r.tags, len: r.tags.length, notes: r.notes.length, deterministic: r.tags === again.tags };
  });
  assert.match(sig.tags, /^psychedelic soul/, 'жанр должен идти первым тегом');
  assert.match(sig.tags, /male baritone/, 'сигнатурный баритон автора потерялся');
  assert.match(sig.tags, /70s/, 'эпоха «из 70-х» не распознана');
  assert.match(sig.tags, /Russian lyrics/, 'вокалу нужен тег языка');
  assert.match(sig.tags, /72 BPM/, 'темп должен быть явным');
  assert.match(sig.tags, /flat dynamics, loop-like/, 'негатив «без кульминации» должен перефразироваться позитивно');
  assert.ok(!/\bno\b|без/i.test(sig.tags), 'в тегах остались негативы');
  assert.ok(sig.tags === sig.tags.toLowerCase() || !/[A-ZА-ЯЁ]/.test(sig.tags.replace(/(Russian|English|French|Spanish|German|Portuguese|Italian|Japanese|Korean|Chinese|Hammond|BPM)/g, '')), 'теги должны быть строчными');
  assert.ok(sig.len <= 240, 'теги длиннее 240 символов');
  assert.ok(sig.deterministic, 'сборка недетерминирована');
  ok('tags follow brain rules on the signature brief', { len: sig.len, notes: sig.notes });

  // 3. Инструментал: instrumental вместо вокала, язык не приписываем.
  const inst = await page.evaluate(() => window.BRIIX_MUSIC_BRAIN.buildTags(
    'спокойный фон для подкаста, пыльное пианино, винил, без слов',
    { kind: 'instrumental', genre: 'ambient', mood: 'calm', bpm: 82, language: 'ru' }));
  assert.match(inst.tags, /instrumental/);
  assert.match(inst.tags, /vinyl crackle/);
  assert.match(inst.tags, /82 BPM/);
  assert.ok(!/lyrics/i.test(inst.tags), 'тег языка у инструментала лишний');
  ok('instrumental brief stays instrumental', { tags: inst.tags });

  // 4. Каркас лирики: канонические секции, припев дважды, без (x3).
  const skel = await page.evaluate(() => window.BRIIX_MUSIC_BRAIN.buildLyricsSkeleton(
    'песня про дождь и ночной город', { kind: 'song', mood: 'calm', language: 'ru' }));
  assert.match(skel, /^\[Intro[^\]]*\]/, 'каркас должен начинаться с интро');
  assert.match(skel, /\[Verse 1\]/);
  assert.ok((skel.match(/^\[Chorus\]/gm) || []).length >= 2, 'припев должен повторяться явно');
  assert.ok(!/\(\s*x\s*\d/i.test(skel), 'шаблонные повторы (xN) запрещены');
  assert.ok(skel.includes('[Bridge]'), 'бридж обязателен по song-structure');
  ok('lyrics skeleton follows song-structure', { sections: (skel.match(/^\[[^\]]+\]/gm) || []).length });

  // 5. UI: задумка → теги, источник подписан, откат возвращает задумку.
  // Форма по умолчанию — инструментал: сначала переключаемся на песню.
  await page.locator('[data-music-action="kind"][data-id="song"]').click();
  await page.waitForSelector('#music-lyrics');
  const brief = 'Тёмный тех-хаус для конца сета, женский вокал, гипнотично, склад';
  await page.locator('#music-prompt').fill(brief);
  await page.locator('[data-music-action="brain-prompt"]').click();
  await page.waitForFunction(() => !document.querySelector('#music-prompt-source')?.hidden, null, { timeout: 5000 });
  const tags = await page.locator('#music-prompt').inputValue();
  assert.match(tags, /^tech house/, 'жанр не первым тегом');
  assert.match(tags, /female vocals/);
  assert.match(tags, /Russian lyrics/);       // язык формы по умолчанию — русский
  assert.match(tags, /warehouse/);
  assert.match(await page.locator('#music-prompt-source').innerText(), /мозгом DJ1/);
  ok('brain button converts the brief into ACE-Step tags', { chars: tags.length });

  await page.locator('[data-music-action="brain-prompt-undo"]').click();
  assert.equal(await page.locator('#music-prompt').inputValue(), brief, 'откат не вернул задумку');
  ok('brain undo restores the author brief');

  // 6. Каркас в UI: пустое поле заполняется, свой текст не трогается.
  await page.locator('#music-prompt').fill('Песня про дождь и ночной город, женский вокал');
  await page.locator('[data-music-action="brain-lyrics"]').click();
  await page.waitForFunction(() => (document.querySelector('#music-lyrics')?.value || '').includes('[Chorus]'), null, { timeout: 5000 });
  assert.match(await page.locator('#music-lyrics-source').innerText(), /Каркас секций/);
  ok('skeleton button fills the empty lyrics field');

  await page.locator('#music-lyrics').fill('[Verse 1]\nМоя собственная строка');
  await page.locator('[data-music-action="brain-lyrics"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#music-lyrics').inputValue(), '[Verse 1]\nМоя собственная строка', 'мозг перезаписал чужой текст');
  ok('brain never overwrites the author lyrics');

  // 7. Мозг не ходит в сеть, вёрстка не ломается.
  assert.deepEqual(external, [], 'внешние запросы: ' + external.join(','));
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tiny: [...document.querySelectorAll('.music-base-row .btn, .music-tag-btn')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height < 32; }).length
  }));
  assert.equal(layout.overflow, 0, 'горизонтальное переполнение');
  assert.equal(layout.tiny, 0, 'мелкие кнопки');
  assert.deepEqual(errors, [], 'ошибки страницы: ' + errors.join('; '));
  ok('no network, no overflow, no page errors', layout);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'briix-music-brain.json'), JSON.stringify({ passed: results.length, results }, null, 2));
  console.log('DONE', results.length, 'checks');
  await browser.close();
  server.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
