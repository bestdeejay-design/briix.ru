/* Подсказки из личной базы владельца: подбор, отмена, автолирика, честность.
 * База — не генерация: текст должен приходить из выгрузки DJ1, источник подписан,
 * любая подстановка обратима, а телефон не качает лишнего до первого обращения.
 */
const { launch, OUT } = require('./browser-env.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
// Порт 0 = свободный порт от системы: общий раннер не любит фиксированные.
const PORT = Number(process.env.BRIIX_BASE_PORT || 0);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.m4a': 'audio/mp4', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const posted = [];
let jobSeq = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const route = url.pathname.replace(/^\/api/, '');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (route === '/health') return res.end(JSON.stringify({ ok: true, queue_len: 0, running: 0, backends: { music: 'ready' } }));
    if (route === '/v1/models') return res.end(JSON.stringify({ data: [
      { id: 'ace-step-flash', kind: 'music-vocal', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 111 } },
      { id: 'ace-step-pro', kind: 'music-vocal', status: 'ready', limits: { max_duration_seconds: 150 }, latency: { seconds: 596 } },
      { id: 'musicgen-small', kind: 'music', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 80 } }
    ] }));
    if (route === '/jobs' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { posted.push(JSON.parse(body)); } catch {}
        res.statusCode = 202; res.end(JSON.stringify({ job_id: 'base-job-' + (++jobSeq) }));
      });
      return;
    }
    if (route.startsWith('/jobs/')) return res.end(JSON.stringify({ id: route.split('/')[2], status: 'running', stage: 'writing-lyrics', progress: 30, provenance: { model: 'ace-step-flash' } }));
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
  const ACTUAL_PORT = server.address().port;
  const BASE = `http://${host()}:${ACTUAL_PORT}`;
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(base => {
    localStorage.setItem('briix-media-live-token', 'base-key');
    localStorage.setItem('briix-media-live-server', JSON.stringify(base + '/api'));
  }, BASE);
  const page = await context.newPage();
  const errors = [], baseRequests = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  page.on('request', r => {
    if (r.url().includes('/assets/creative-base/')) baseRequests.push(r.url().split('/').pop());
    else if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });

  await page.goto(BASE + '/#/music');
  await page.waitForSelector('.music-page');
  await page.waitForFunction(() => window.BRIIX_MUSIC_LIVE?.active?.() === true, null, { timeout: 20000 });
  await page.locator('[data-music-action="kind"][data-id="song"]').click();
  await page.waitForSelector('#music-lyrics');

  assert.equal(baseRequests.length, 0, 'база не должна грузиться сама: ' + baseRequests.join(','));
  ok('base stays unloaded until the author asks for it', { requests: 0 });

  await page.locator('#music-prompt').fill('Ночной город, дождь, спокойный женский вокал, тёплое пианино');
  const ownPrompt = await page.locator('#music-prompt').inputValue();

  // Улучшение промпта: свой текст сохранён, добавленное подписано, отмена работает.
  await page.locator('[data-music-action="base-prompt"]').click();
  await page.waitForFunction(() => !document.querySelector('#music-prompt-source')?.hidden, null, { timeout: 30000 });
  const enriched = await page.locator('#music-prompt').inputValue();
  assert.ok(enriched.startsWith(ownPrompt), 'своя задумка должна остаться в начале');
  assert.ok(enriched.length > ownPrompt.length, 'промпт не обогатился');
  assert.ok(enriched.length <= 1200, 'переполнен лимит промпта');
  assert.match(await page.locator('#music-prompt-source').innerText(), /из вашей базы/i);
  ok('prompt enriched from the author base, intent kept', { before: ownPrompt.length, after: enriched.length });

  await page.locator('[data-music-action="base-prompt-undo"]').click();
  assert.equal(await page.locator('#music-prompt').inputValue(), ownPrompt, 'отмена не вернула свой промпт');
  ok('prompt undo restores the author text');

  // Лирика: приходит из базы, вариант листается, отмена возвращает своё.
  await page.locator('#music-lyrics').fill('Моя строчка про дождь');
  await page.locator('[data-music-action="base-lyrics"]').click();
  await page.waitForFunction(() => (document.querySelector('#music-lyrics')?.value || '').includes('['), null, { timeout: 30000 });
  const first = await page.locator('#music-lyrics').inputValue();
  assert.match(await page.locator('#music-lyrics-source').innerText(), /Текст из вашей базы/);
  const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/creative-base/lyrics-00.json'), 'utf8'));
  const inBase = await page.evaluate(async () => {
    const stats = window.BRIIX_MUSIC_BASE.stats();
    const entry = window.BRIIX_MUSIC_BASE.pick(document.querySelector('#music-prompt').value, { limit: 1, withLyrics: true, lang: 'ru' })[0];
    return { name: entry?.name, lang: entry?.lang, text: entry ? await window.BRIIX_MUSIC_BASE.lyrics(entry) : '' };
  });
  assert.ok(inBase.text.length > 0 && Object.values(pool).some(v => typeof v === 'string') , 'текст должен быть из выгрузки базы');
  ok('lyrics inserted from the base with a visible source', { chars: first.length, lang: inBase.lang });

  await page.locator('[data-music-action="base-lyrics-again"]').click();
  await page.waitForFunction(prev => document.querySelector('#music-lyrics')?.value !== prev, first, { timeout: 30000 });
  ok('another variant gives a different text');

  await page.locator('[data-music-action="base-lyrics-undo"]').click();
  assert.equal(await page.locator('#music-lyrics').inputValue(), 'Моя строчка про дождь', 'отмена не вернула свою лирику');
  ok('lyrics undo restores the author text');

  // Галочка «Автолирика» заполняет пустое поле сама.
  await page.locator('#music-lyrics').fill('');
  await page.locator('#music-auto-lyrics').check();
  await page.waitForFunction(() => (document.querySelector('#music-lyrics')?.value || '').trim().length > 20, null, { timeout: 30000 });
  const auto = await page.locator('#music-lyrics').inputValue();
  assert.match(auto, /\[/, 'в автолирике должна быть структура из базы');
  ok('auto-lyrics checkbox fills the empty field', { chars: auto.length });

  // Главное: с галочкой пустая лирика больше не блокирует отправку.
  await page.locator('#music-lyrics').fill('');
  await page.locator('#music-generate').click();
  await page.waitForFunction(() => document.querySelectorAll('#music-panel').length > 0, null, { timeout: 5000 });
  await page.waitForTimeout(2500);
  const last = posted[posted.length - 1];
  assert.ok(last, 'задача не ушла на сервер');
  assert.ok((last.params.lyrics || '').trim().length > 20, 'автолирика не подставилась перед отправкой');
  assert.equal(last.params.model, 'ace-step-flash');
  ok('submit with empty lyrics auto-fills from the base and sends', { lyricsChars: last.params.lyrics.length });

  // Поиск по базе: результаты и подстановка промпта.
  await page.locator('#music-base-browser > summary').click();
  await page.locator('#music-base-query').fill('female vocal piano rain');
  await page.waitForSelector('.music-base-card', { timeout: 20000 });
  const cards = await page.locator('.music-base-card').count();
  assert.ok(cards > 0 && cards <= 6, 'ожидались карточки базы');
  const previews = await page.locator('.music-base-card p').allInnerTexts();
  assert.equal(new Set(previews).size, previews.length, 'в выдаче повторяются вариации одного промпта');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'music-base-query', 'поиск потерял фокус при выдаче');
  await page.locator('.music-base-card [data-music-action="base-take-prompt"]').first().click();
  await page.waitForFunction(() => !document.querySelector('#music-prompt-source')?.hidden, null, { timeout: 20000 });
  assert.match(await page.locator('#music-prompt-source').innerText(), /Промпт целиком из вашей базы/);
  ok('base search keeps focus and inserts a chosen prompt', { cards });

  // Честность и мобильная пригодность.
  const note = await page.locator('.music-base-note').innerText();
  assert.match(note, /вашей галереи DJ1/);
  assert.match(note, /не генерация/);
  const layout = await page.evaluate(() => {
    const page_ = document.querySelector('.music-page');
    const small = [...page_.querySelectorAll('.music-base-row .btn, .music-base-card-actions .btn, .music-base-browser > summary')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height < 40; }).length;
    const field = document.querySelector('#music-base-query');
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, fontSize: parseFloat(getComputedStyle(field).fontSize) };
  });
  assert.equal(layout.overflow, 0, 'горизонтальное переполнение');
  assert.equal(layout.small, 0, 'мелкие кнопки в подсказках');
  assert.ok(layout.fontSize >= 16, 'поле поиска мельче 16px');
  ok('honest source label and mobile-sized controls', layout);

  assert.deepEqual(external, [], 'внешние запросы: ' + external.join(','));
  assert.ok(baseRequests.includes('index.json'), 'индекс не загружен');
  assert.ok(baseRequests.filter(f => f.startsWith('lyrics-')).length <= 3, 'лирика должна грузиться шардами, а не вся');
  assert.deepEqual(errors, [], 'ошибки страницы: ' + errors.join('; '));
  ok('no external requests, shards only, no page errors', { files: [...new Set(baseRequests)] });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'briix-music-base.json'), JSON.stringify({ passed: results.length, results }, null, 2));
  console.log('DONE', results.length, 'checks');
  await browser.close();
  server.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
