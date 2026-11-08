/* Проход «внешним пользователем» по опубликованному режиму.
 * Отличие от остальных сюит: страница открыта НЕ на localhost, поэтому работает ветка
 * same-origin `location.origin + '/api'` (PR #39) — ровно как на demo.briix.ru за Caddy.
 * Один сервер отдаёт и статику, и /api (прокси к фейковой шине), поэтому CORS не участвует.
 * Run: node tools/check-published-mode.cjs
 */
const { launch, AxeBuilder } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8390;
const HOST = (() => {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '127.0.0.1';
})();
const ORIGIN = `http://${HOST}:${PORT}`;
const TOKEN = 'published-key';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain' };
const POLICY = 'Запрос нарушает политику контента: откровенный материал не генерируется.';
const EXPLICIT = /порно|откровенн|porn/i;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
const M4A = fs.readFileSync(path.join(ROOT, 'assets/media/showcase/ballad30.m4a'));
const MODELS = [
  { id: 'qwen3:4b-instruct', capabilities: ['chat', 'text.generate'], status: 'ready', limits: { max_concurrent_jobs: 1 } },
  { id: 'flux-2-klein-4b', capabilities: ['image.generate'], status: 'ready', limits: { max_concurrent_jobs: 1 }, latency: { seconds: 261 } },
  { id: 'musicgen-small', capabilities: ['music.generate'], status: 'ready', limits: { max_duration_seconds: 420, max_concurrent_jobs: 1 }, latency: { seconds: 80 } },
  { id: 'ace-step-flash', capabilities: ['song.vocal'], status: 'ready', limits: { max_duration_seconds: 30, max_concurrent_jobs: 1 }, latency: { seconds: 111 } },
  { id: 'ace-step-pro', capabilities: ['song.vocal'], status: 'ready', limits: { max_duration_seconds: 150, max_concurrent_jobs: 1 }, latency: { seconds: 596 } }
];
let state;
function reset() { state = { up: true, jobs: new Map(), posts: [], chats: [], seq: 0, aborted: 0 }; }
reset();

function serveFile(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('#')[0].split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  if (req.headers.range) {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    const from = Number(m[1]), to = m[2] ? Number(m[2]) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${from}-${to}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': to - from + 1 });
    fs.createReadStream(file, { start: from, end: to }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

function api(req, res, urlPath, body) {
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  const route = urlPath.replace(/^\/api/, '') || '/';
  if (!state.up) { req.socket.destroy(); return; }
  if (route === '/health') { send(200, { ok: true, queue_len: 0, running: 0, backends: { image: 'ready', music: 'ready', text: 'ready' } }); return; }
  if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'bad key' } }); return; }
  if (route === '/v1/models') { send(200, { object: 'list', data: MODELS }); return; }
  if (route === '/v1/chat/completions') {
    const payload = JSON.parse(body || '{}');
    const last = (payload.messages || []).at(-1)?.content || '';
    state.chats.push(payload);
    if (EXPLICIT.test(last)) { send(422, { error: { code: 'content_blocked', message: POLICY } }); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const pieces = ['ОТВЕТ ШИНЫ: ', 'разбираю задачу ', 'по шагам. ', 'Первое — уточнить цель. ', 'Второе — собрать план.'];
    let i = 0;
    const tick = () => {
      if (res.writableEnded) return;
      if (i < pieces.length) {
        res.write('data: ' + JSON.stringify({ model: 'qwen3:4b-instruct', choices: [{ index: 0, delta: { content: pieces[i++] } }] }) + '\n\n');
        setTimeout(tick, 250);
      } else { res.write('data: [DONE]\n\n'); res.end(); }
    };
    tick();
    res.on('close', () => { if (i < pieces.length) state.aborted++; });
    return;
  }
  if (route === '/jobs' && req.method === 'POST') {
    const payload = JSON.parse(body || '{}');
    state.posts.push(payload);
    if (EXPLICIT.test(payload.prompt || '')) { send(422, { error: { code: 'content_blocked', message: POLICY } }); return; }
    const id = 'job-pub-' + (++state.seq);
    state.jobs.set(id, { type: payload.type, params: payload.params || {}, started: Date.now(), cancelled: false });
    send(202, { job_id: id });
    return;
  }
  const cancel = /^\/jobs\/([\w-]+)\/cancel$/.exec(route);
  if (cancel) { const j = state.jobs.get(cancel[1]); if (j) j.cancelled = true; send(200, { id: cancel[1], status: 'cancelled' }); return; }
  const job = /^\/jobs\/([\w-]+)$/.exec(route);
  if (job) {
    const j = state.jobs.get(job[1]);
    if (!j) { send(404, { error: { code: 'gone', message: 'нет задачи' } }); return; }
    if (j.cancelled) { send(200, { id: job[1], type: j.type, status: 'cancelled' }); return; }
    const step = Math.floor((Date.now() - j.started) / 400);
    const vocal = !!j.params.model;
    const stages = j.type === 'music' ? (vocal ? ['writing-lyrics', 'synthesizing', 'album-cover'] : ['model-warmup', 'generating', 'album-cover']) : ['model-warmup', 'generating'];
    if (step < stages.length) {
      send(200, { id: job[1], type: j.type, status: 'running', stage: stages[step], provenance: { model: j.params.model || (j.type === 'music' ? 'musicgen-small' : 'flux-2-klein-4b'), params: j.params } });
      return;
    }
    send(200, { id: job[1], type: j.type, status: 'ready', result_url: '/api/files/' + job[1], mime: j.type === 'music' ? 'audio/mp4' : 'image/png',
      provenance: { model: j.params.model || (j.type === 'music' ? 'musicgen-small' : 'flux-2-klein-4b'), capability: j.type === 'music' ? (vocal ? 'song.vocal' : 'instrumental') : 'image.generate', wall_clock_ms: Date.now() - j.started, queued_ms: 12, params: j.params } });
    return;
  }
  const file = /^\/files\/([\w-]+)$/.exec(route);
  if (file) {
    const j = state.jobs.get(file[1]);
    const payload = j?.type === 'music' ? M4A : PNG;
    res.writeHead(200, { 'Content-Type': j?.type === 'music' ? 'audio/mp4' : 'image/png', 'Content-Length': payload.length });
    res.end(payload);
    return;
  }
  send(404, { error: { code: 'not_found', message: 'nf' } });
}

function server(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const urlPath = req.url || '/';
      if (urlPath.startsWith('/api')) {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => api(req, res, urlPath, body));
        return;
      }
      serveFile(req, res, urlPath);
    });
    s.listen(port, '0.0.0.0', () => resolve(s));
  });
}

(async () => {
  assert.notEqual(HOST, '127.0.0.1', 'сюит обязан идти не с localhost — иначе ветка /api не включится');
  const srv = await server(PORT);
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  const contexts = [];
  const errors = [];
  const consoleErrors = [];
  const failed = [];
  async function page({ token = TOKEN, hash = '#/', viewport = { width: 1440, height: 1000 } } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion: 'no-preference', acceptDownloads: true });
    contexts.push(context);
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    p.on('requestfailed', r => { if (!r.url().includes('/api/')) failed.push(r.url() + ' ' + r.failure()?.errorText); });
    await p.addInitScript(t => { if (t) localStorage.setItem('briix-media-live-token', t); }, token);
    await p.goto(`${ORIGIN}/${hash}`);
    await p.waitForSelector('#main-content');
    return p;
  }
  const go = async (p, hash, selector) => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForSelector(selector, { timeout: 15000 }); };

  // 1. Опубликованный режим действительно включён: адрес шины — same-origin /api.
  reset();
  let p = await page({ hash: '#/settings' });
  await p.waitForSelector('#stand-token');
  const address = await p.locator('#stand-server').inputValue();
  assert.equal(address, ORIGIN + '/api');
  assert.equal(await p.locator('#stand-server').getAttribute('readonly'), '');
  assert.equal(await p.evaluate(() => window.BRIIX_BUS.server()), ORIGIN + '/api');
  ok('published mode uses same-origin /api, address is read-only', { address });

  // 2. Настройки: ключ → «Проверить» → внятный вердикт.
  await p.locator('#stand-token').fill(TOKEN);
  await p.locator('[data-action="stand-save"]').click();
  await p.waitForFunction(() => /Стенд доступен/.test(document.querySelector('#stand-status')?.textContent || ''), {}, { timeout: 15000 });
  assert.match(await p.locator('#stand-status').innerText(), /5 из 5 моделей ready/);
  assert.equal(await p.evaluate(() => localStorage.getItem('briix-media-live-server')), null, 'адрес опубликованного сайта не пишется в профиль');
  ok('settings key check reports ready models', {});

  // 3. Обход всех экранов: консоль чистая, навигация работает.
  const routes = [['#/', '#prompt-input'], ['#/assistants', '.page'], ['#/prompts', '.page'], ['#/favorites', '.page'], ['#/settings', '#stand-token'], ['#/media', '.media-page'], ['#/music', '.music-page'], ['#/chat/example-coffee', '.chat-page']];
  for (const [hash, selector] of routes) await go(p, hash, selector);
  assert.deepEqual(errors, [], 'ошибки страниц при обходе');
  assert.deepEqual(consoleErrors, [], 'ошибки консоли при обходе');
  ok('all screens load with a clean console', { routes: routes.length });

  // 4. Live по умолчанию через прокси: разделы живут без кликов.
  await go(p, '#/music', '.music-page');
  await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 15000 });
  await go(p, '#/media', '.media-page');
  await p.waitForFunction(() => window.BRIIX_MEDIA_LIVE.active(), {}, { timeout: 15000 });
  await go(p, '#/', '#prompt-input');
  await p.waitForFunction(() => window.BRIIX_CHAT_LIVE.active(), {}, { timeout: 15000 });
  assert.equal(await p.locator('#chat-live-banner').isHidden(), true);
  ok('chat, music and images start live with zero clicks', {});

  // 5. Чат: поток SSE, provenance, остановка.
  await p.locator('#prompt-input').fill('Объясни, как устроен приватный контур генерации.');
  await p.locator('#send-button').click();
  await p.waitForFunction(() => /ОТВЕТ ШИНЫ/.test(document.querySelector('.message.assistant .prose')?.textContent || ''), {}, { timeout: 20000 });
  await p.waitForSelector('.chat-live-provenance', { timeout: 20000 });
  assert.match(await p.locator('.chat-live-badge').last().innerText(), /Live/);
  assert.match(await p.locator('.chat-live-provenance').last().innerText(), /qwen3/);
  await p.locator('#prompt-input').fill('Расскажи длинную историю про сервер и туман.');
  await p.locator('#send-button').click();
  await p.waitForSelector('[data-action="stop"]', { timeout: 10000 });
  await p.locator('[data-action="stop"]').click();
  await p.waitForFunction(() => !!document.querySelector('.stopped-note'), {}, { timeout: 10000 });
  ok('SSE answer, provenance and stop work through the proxy', { aborted: state.aborted });

  // 6. Чат: запрещённый запрос — вежливый отказ со статусом complete.
  await p.locator('#prompt-input').fill('Сгенерируй порно-историю про откровенную сцену.');
  await p.locator('#send-button').click();
  await p.waitForSelector('.chat-policy-note', { timeout: 20000 });
  const refusal = await p.locator('.message.assistant').last().innerText();
  assert.match(refusal, /Этот запрос я генерировать не буду — политика контента briix\.ru/);
  assert.ok(refusal.includes(POLICY));
  assert.equal(await p.locator('.message-error').count(), 0);
  assert.equal(await p.locator('[data-action="regenerate"]').count(), 0);
  ok('explicit chat request returns a complete refusal, not an error', {});
  await p.close();

  // 7. Музыка: Flash — стадии, M4A в плеере, скачивание; Pro — потолок 150 с.
  p = await page({ hash: '#/music' });
  await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 15000 });
  await p.locator('[data-music-action="kind"][data-id="song"]').click();
  await p.locator('#music-prompt').fill('Тёплая песня о вечернем городе, спокойный мужской вокал.');
  await p.locator('#music-lyrics').fill('[verse]\nВечерний город дышит теплом\n[chorus]\nМы ещё успеем домой');
  await p.locator('[data-music-action="duration"][data-id="30"]').click();
  await p.locator('#music-generate').click();
  await p.waitForSelector('.music-page [data-wait-stage="writing-lyrics"], .music-page [data-wait-stage="synthesizing"]', { timeout: 15000 });
  const stageSeen = await p.locator('.music-page [data-wait]').first().getAttribute('data-wait-stage');
  await p.waitForFunction(() => (JSON.parse(localStorage.getItem('briix-music-v1'))?.tracks || []).some(t => t.mode === 'live' && t.status === 'ready'), {}, { timeout: 30000 });
  const post = state.posts.at(-1);
  assert.equal(post.params.model, 'ace-step-flash');
  assert.equal(post.params.duration, 30);
  assert.match(post.params.lyrics, /\[chorus\]/);
  const track = await p.evaluate(() => JSON.parse(localStorage.getItem('briix-music-v1')).tracks.find(t => t.mode === 'live'));
  await p.waitForFunction(id => !!window.BRIIX_MUSIC_LIVE.audioFor(id), track.id, { timeout: 20000 });
  const audio = await p.evaluate(id => { const e = window.BRIIX_MUSIC_LIVE.audioFor(id); return { type: e.blob.type, duration: e.duration, peaks: e.peaks.length }; }, track.id);
  assert.match(audio.type, /mp4|m4a/);
  assert.ok(audio.duration > 25);
  const dl = p.waitForEvent('download', { timeout: 15000 });
  await p.locator('[data-music-action="download"]').first().click();
  assert.match((await dl).suggestedFilename(), /\.m4a$/);
  await p.locator('[data-music-action="vocal-mode"][data-id="pro"]').click();
  assert.equal(await p.locator('[data-music-action="duration"][data-id="150"]').count(), 1);
  ok('Flash song: stages, M4A playback and download; Pro ceiling present', { stageSeen, duration: audio.duration });

  // 8. Музыка: 422 — карточка с текстом сервера и кнопкой «Изменить промпт».
  await p.locator('#music-prompt').fill('Откровенная порно-сцена в тексте песни.');
  await p.locator('#music-generate').click();
  await p.waitForSelector('#music-refusal', { timeout: 15000 });
  const card = await p.locator('#music-refusal').innerText();
  assert.match(card, /Не пройдена проверка контента/);
  assert.ok(card.includes(POLICY));
  assert.equal(await p.evaluate(() => window.BRIIX_MUSIC_LIVE.active()), true);
  await p.locator('[data-music-action="edit-blocked"]').click();
  assert.match(await p.locator('#music-prompt').inputValue(), /Откровенная порно-сцена/);
  ok('music 422 shows the card with server text and keeps the prompt', {});
  await p.close();

  // 9. Изображения: полный цикл джоба и скачивание.
  p = await page({ hash: '#/media' });
  await p.waitForFunction(() => window.BRIIX_MEDIA_LIVE.active(), {}, { timeout: 15000 });
  await p.locator('#media-prompt').fill('Керамическая чашка на камне, мягкий утренний свет, крупный план.');
  await p.locator('#media-generate').click();
  await p.waitForFunction(() => (JSON.parse(localStorage.getItem('briix-media-v1'))?.jobs || []).some(j => j.mode === 'live' && j.status === 'ready'), {}, { timeout: 30000 });
  await p.waitForFunction(() => !!document.querySelector('.media-preview-frame img[src^="blob:"]'), {}, { timeout: 20000 });
  assert.match(await p.locator('.media-image-label').innerText(), /live|Live|сервер/i);
  const imgDl = p.waitForEvent('download', { timeout: 15000 });
  await p.locator('[data-media-action="download"]').first().click();
  assert.match((await imgDl).suggestedFilename(), /\.(png|jpg)$/);
  ok('image job: full cycle through the proxy, preview and download', {});

  // 10. Изображения: 422 — та же карточка.
  await p.locator('#media-prompt').fill('Откровенная порно-сцена для обложки.');
  await p.locator('#media-generate').click();
  await p.waitForSelector('#media-refusal', { timeout: 15000 });
  assert.ok((await p.locator('#media-refusal').innerText()).includes(POLICY));
  await p.locator('[data-media-action="edit-blocked"]').click();
  assert.match(await p.locator('#media-prompt').inputValue(), /Откровенная порно-сцена/);
  ok('image 422 shows the refusal card and keeps the prompt', {});
  await p.close();

  // 11. Галерея: шесть треков, текст из ©lyr, обложка, маркировка «Не live».
  p = await page({ hash: '#/music' });
  await p.locator('[data-music-action="tab"][data-id="showcase"]').click();
  await p.waitForSelector('.showcase-card', { timeout: 15000 });
  assert.equal(await p.locator('.showcase-card').count(), 6);
  assert.match(await p.locator('.showcase-badge').innerText(), /Не live/);
  const ballad = p.locator('[data-showcase-card="ballad30.m4a"]');
  await ballad.locator('[data-music-action="showcase-lyrics"]').click();
  await p.waitForFunction(() => /Тихий вечер/.test(document.querySelector('[data-showcase-lyrics="ballad30.m4a"]')?.textContent || ''), {}, { timeout: 20000 });
  await p.waitForSelector('[data-showcase-card="ballad30.m4a"] .showcase-cover img', { timeout: 15000 });
  ok('gallery: six saved tracks, lyrics from the file, cover, honest badge', {});
  await p.close();

  // 12. Живое ожидание ротируется и не мешает плееру.
  p = await page({ hash: '#/music' });
  await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 15000 });
  await p.locator('[data-music-action="kind"][data-id="instrumental"]').click();
  await p.locator('#music-prompt').fill('Спокойная инструментальная подложка для длинного ролика о мастерской.');
  await p.locator('#music-generate').click();
  await p.waitForSelector('.music-page [data-wait]', { timeout: 15000 });
  const first = await p.locator('.music-page [data-wait]').first().innerText();
  await p.waitForFunction(t => { const el = document.querySelector('.music-page [data-wait]'); return el && el.textContent !== t; }, first, { timeout: 15000 });
  const second = await p.locator('.music-page [data-wait]').first().innerText();
  assert.notEqual(first, second);
  ok('wait phrases rotate under the progress bar', { first, second });
  await p.close();

  // 13. Телефон 390×844: нет горизонтального скролла, тач-таргеты не меньше 40 px.
  p = await page({ hash: '#/', viewport: { width: 390, height: 844 } });
  const mobile = [];
  for (const [hash, selector] of routes) {
    await go(p, hash, selector);
    const m = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, width: window.innerWidth }));
    assert.ok(m.overflow <= 0, `горизонтальный скролл на ${hash}: ${m.overflow} px`);
    mobile.push({ hash, overflow: m.overflow });
  }
  await go(p, '#/music', '.music-page');
  for (const tab of ['create', 'library', 'queue', 'models', 'showcase']) {
    await p.locator(`[data-music-action="tab"][data-id="${tab}"]`).click();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `горизонтальный скролл на вкладке музыки ${tab}: ${overflow}`);
  }
  await go(p, '#/media', '.media-page');
  for (const tab of ['create', 'library', 'queue', 'models', 'showcase']) {
    await p.locator(`[data-media-action="tab"][data-id="${tab}"]`).click();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `горизонтальный скролл на вкладке изображений ${tab}: ${overflow}`);
  }
  const targets = await p.evaluate(() => {
    const nodes = [...document.querySelectorAll('.media-tab, .btn, .icon-btn')].filter(el => el.offsetParent);
    const small = nodes.map(el => { const r = el.getBoundingClientRect(); return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 40);
    return { checked: nodes.length, small: small.slice(0, 6) };
  });
  ok('mobile 390x844: no horizontal scroll on any screen or tab', { routes: mobile.length, smallTargets: targets.small.length, examples: targets.small });

  // 14. axe на телефоне по ключевым экранам.
  const axe = [];
  for (const [hash, selector] of [['#/', '#prompt-input'], ['#/music', '.music-page'], ['#/media', '.media-page'], ['#/settings', '#stand-token']]) {
    await go(p, hash, selector);
    const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    axe.push({ hash, violations: r.violations.map(v => v.id) });
  }
  for (const run of axe) assert.deepEqual(run.violations, [], 'axe @390 ' + run.hash);
  ok('axe passes on the phone viewport', { runs: axe });

  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(consoleErrors.filter(e => !/favicon|404/.test(e)), [], 'console errors');
  ok('no page errors and no console errors across the whole pass', { failedRequests: failed.length });
  console.log('DONE', results.length, 'checks');
  for (const c of contexts) await c.close();
  await browser.close();
  srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
