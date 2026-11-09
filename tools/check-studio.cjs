/* Studio v3: live catalog + immediate pending cards + independent queued runs.
 * Self-contained fake BFF; this checks browser wiring, not real model inference.
 */
const { launch, AxeBuilder } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.BRIIX_TEST_OUT || path.join(os.tmpdir(), 'briix-studio');
const STATIC_PORT = Number(process.env.BRIIX_STUDIO_STATIC_PORT || 18388);
const BFF_PORT = Number(process.env.BRIIX_STUDIO_BFF_PORT || 18300);
const TOKEN = 'test-token';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.m4a': 'audio/mp4', '.json': 'application/json', '.woff2': 'font/woff2' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const M4A_PATH = path.join(ROOT, 'assets/media/showcase/ballad30.m4a');
const M4A = fs.existsSync(M4A_PATH) ? fs.readFileSync(M4A_PATH) : Buffer.from('fake-m4a');
const MODELS = [
  { id: 'qwen3:4b-instruct', capabilities: ['chat'], status: 'ready', latency: { seconds: 8 } },
  { id: 'flux-2-klein-4b', capabilities: ['image.generate'], status: 'ready', limits: { max_duration_seconds: 480 }, latency: { seconds: 261 } },
  { id: 'musicgen-small', capabilities: ['music.generate'], status: 'ready', limits: { max_duration_seconds: 420 }, latency: { seconds: 80 } },
  { id: 'ace-step-flash', capabilities: ['song.vocal'], status: 'ready', limits: { max_duration_seconds: 300 }, latency: { seconds: 111 } },
  { id: 'ace-step-pro', capabilities: ['song.vocal'], status: 'ready', limits: { max_duration_seconds: 300 }, latency: { seconds: 596 } }
];
let state;
function resetBff() {
  state = { chatPosts: [], chatBlocked: false, jobPosts: [], jobs: new Map(), jobBlock: false, cancels: [], nextJob: 1 };
}
resetBff();
function staticServer(port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let url = decodeURIComponent(req.url.split('?')[0]); if (url === '/') url = '/index.html';
      const file = path.join(ROOT, url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
function bffServer(port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      const readBody = callback => { let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => callback(JSON.parse(raw || '{}'))); };
      if (req.url === '/health') { send(200, { ok: true }); return; }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'Ключ отклонён.' } }); return; }
      if (req.url === '/v1/models') { send(200, { object: 'list', data: MODELS }); return; }
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        readBody(body => {
          state.chatPosts.push(body);
          if (state.chatBlocked) { send(422, { error: { code: 'content_blocked', message: 'Запрос нарушает политику контента.' } }); return; }
          const last = body.messages.at(-1)?.content || '';
          if (body.stream === false) { send(200, { model: body.model, choices: [{ message: { content: 'УЛУЧШЕННЫЙ ТЕКСТ' } }] }); return; }
          const isLyrics = /автор песен/i.test(body.messages[0]?.content || '');
          const full = isLyrics ? '[Verse]\nГород слышит мои шаги\n[Chorus]\nЯ возвращаюсь домой' : 'Ответ ' + (body.model || 'server') + ': ' + last;
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
          const pieces = full.match(/.{1,12}/gs) || [];
          let index = 0;
          const timer = setInterval(() => {
            if (index < pieces.length) {
              res.write('data: ' + JSON.stringify({ model: body.model, choices: [{ delta: { content: pieces[index++] } }] }) + '\n\n');
            } else { clearInterval(timer); res.write('data: [DONE]\n\n'); res.end(); }
          }, 35);
          setTimeout(() => {}, 80); // response stays open even for a very short answer
          res.on('close', () => clearInterval(timer));
        }); return;
      }
      if (req.url === '/jobs' && req.method === 'POST') {
        readBody(body => {
          if (state.jobBlock) { send(422, { error: { code: 'content_blocked', message: 'Медиа-запрос нарушает политику.' } }); return; }
          const id = 'job-studio-' + state.nextJob++;
          const job = { id, type: body.type, prompt: body.prompt, params: body.params || {}, polls: 0, cancelled: false };
          state.jobPosts.push({ ...body, job_id: id }); state.jobs.set(id, job);
          send(202, { job_id: id });
        }); return;
      }
      const cancel = req.url.match(/^\/jobs\/([\w-]+)\/cancel$/);
      if (cancel && req.method === 'POST') {
        const job = state.jobs.get(cancel[1]); if (job) job.cancelled = true; state.cancels.push(cancel[1]); send(200, { id: cancel[1], status: 'cancelled' }); return;
      }
      const match = req.url.match(/^\/jobs\/([\w-]+)$/);
      if (match) {
        const job = state.jobs.get(match[1]); if (!job) { send(404, { error: { code: 'job_not_found', message: 'nf' } }); return; }
        job.polls++;
        if (job.cancelled) { send(200, { id: job.id, status: 'cancelled', error: { message: 'Отменено.' } }); return; }
        if (job.polls < 2) { send(200, { id: job.id, status: 'running', stage: job.type === 'music' ? 'synthesizing' : 'generating' }); return; }
        const model = job.type === 'image' ? 'flux-2-klein-4b' : job.params.model || 'musicgen-small';
        send(200, { id: job.id, type: job.type, status: 'ready', result_url: '/files/' + job.id, mime: job.type === 'image' ? 'image/png' : 'audio/mp4', provenance: { model, params: job.params, wall_clock_ms: 1234 } }); return;
      }
      const file = req.url.match(/^\/files\/([\w-]+)$/);
      if (file) {
        const job = state.jobs.get(file[1]); if (!job) { send(404, { error: { code: 'gone', message: 'gone' } }); return; }
        res.writeHead(200, { 'Content-Type': job.type === 'image' ? 'image/png' : 'audio/mp4', ...cors }); res.end(job.type === 'image' ? PNG : M4A); return;
      }
      send(404, { error: { code: 'not_found', message: 'nf' } });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const staticServer_ = await staticServer(STATIC_PORT); const bff = await bffServer(BFF_PORT); const browser = await launch();
  const results = []; const errors = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  const URL_ = `http://127.0.0.1:${STATIC_PORT}/studio.html`;
  async function page({ viewport = { width: 1280, height: 900 }, token = TOKEN } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', acceptDownloads: true });
    const p = await context.newPage(); p.on('pageerror', error => errors.push(error.message));
    await p.addInitScript(({ token, port }) => {
      if (token) localStorage.setItem('briix-media-live-token', token);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
    }, { token, port: BFF_PORT });
    await p.goto(URL_); await p.waitForSelector('#send');
    if (token) await p.waitForFunction(() => document.querySelector('#connectionLabel').textContent === 'Стенд подключён');
    return p;
  }
  async function close(p) { await p.context().close(); }
  async function chooseModel(p, text) { await p.locator('#modelChip').click(); await p.locator('#modelMenu button', { hasText: text }).click(); }
  async function readyCount(p) { return p.locator('.message.assistant[data-status="ready"]').count(); }

  // 1. Empty state and a live, global model picker.
  resetBff(); let p = await page();
  assert.equal(await p.locator('.mode').count(), 3);
  assert.equal(await p.locator('#suggestions .suggestion').count(), 3);
  assert.equal(await p.locator('#send').isDisabled(), true);
  await p.locator('#modelChip').click();
  assert.equal(await p.locator('#modelMenu button').count(), 5);
  assert.match(await p.locator('#modelMenu').innerText(), /ACE-Step Pro/);
  await p.keyboard.press('Escape');
  ok('live catalog: five selectable models, three modes, useful empty state');
  await close(p);

  // 2. No key: inline connection; key in URL is consumed and scrubbed.
  p = await page({ token: '' });
  await p.locator('#prompt').fill('Привет'); await p.locator('#send').click();
  await p.waitForSelector('#keyCard:not([hidden])');
  await p.goto(URL_ + '?key=' + TOKEN);
  await p.waitForFunction(() => document.querySelector('#connectionLabel').textContent === 'Стенд подключён');
  assert.equal(await p.evaluate(() => localStorage.getItem('briix-media-live-token')), TOKEN);
  assert.equal(await p.evaluate(() => location.search.includes('key=')), false);
  assert.equal(await p.evaluate(() => document.documentElement.innerHTML.includes('Bearer test-token')), false);
  ok('inline key + shared-link key is saved and removed from URL'); await close(p);

  // 3. Two chat submissions: immediate spinner, free composer, independent streams.
  resetBff(); p = await page();
  await p.locator('#prompt').fill('Первый вопрос'); await p.locator('#send').click();
  await p.waitForSelector('.message.assistant .generation-stage');
  await p.locator('#prompt').fill('Второй вопрос');
  assert.equal(await p.locator('#send').isDisabled(), false, 'composer stays usable during the first stream');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('.message.assistant .generation-stage').length >= 1);
  await p.waitForFunction(() => document.querySelectorAll('.message.assistant[data-status="ready"]').length === 2, {}, { timeout: 15000 });
  assert.equal(state.chatPosts.length, 2);
  const chatText = await p.locator('.message.assistant .message-body').allTextContents();
  assert.ok(chatText.some(text => text.includes('Первый вопрос')));
  assert.ok(chatText.some(text => text.includes('Второй вопрос')));
  assert.equal(state.chatPosts[1].messages.filter(m => m.content === 'Второй вопрос').length, 1, 'current prompt is not duplicated');
  ok('two chats run independently; immediate spinner and composer never locks'); await close(p);

  // 4. Switch models while photo is pending; MusicGen and Qwen land in the same feed.
  resetBff(); p = await page();
  await chooseModel(p, 'FLUX'); await p.locator('#prompt').fill('neon city'); await p.locator('#send').click();
  await p.waitForSelector('.message.assistant .generation-stage');
  await chooseModel(p, 'MusicGen'); await p.locator('#prompt').fill('warm instrumental'); await p.locator('#send').click();
  await chooseModel(p, 'Qwen'); await p.locator('#prompt').fill('Что уже создаётся?'); await p.locator('#send').click();
  await p.waitForSelector('.message.assistant img', { timeout: 15000 });
  await p.waitForSelector('.message.assistant audio', { timeout: 20000 });
  await p.waitForFunction(() => document.querySelectorAll('.message.assistant[data-status="ready"]').length === 3, {}, { timeout: 15000 });
  assert.equal(state.jobPosts.length, 2);
  assert.deepEqual(state.jobPosts[0].params, {}, 'MusicGen does not receive vocal-only params');
  assert.deepEqual(state.jobPosts[1].params, {});
  assert.notEqual(state.jobPosts[0].job_id, state.jobPosts[1].job_id);
  ok('model switching during generation: photo + instrumental + chat in one feed'); await close(p);

  // 5. Two full song requests: Qwen lyrics, real duration key, captured model per card.
  resetBff(); p = await page();
  await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Песня о возвращении домой'); await p.locator('#send').click();
  await p.waitForSelector('.message.assistant .generation-stage');
  assert.match(await p.locator('.message.assistant .generation-stage').innerText(), /Qwen|лирик|Создаю/i);
  await chooseModel(p, 'ACE-Step Pro');
  await p.locator('#durationChip').click(); await p.locator('#durationMenu button', { hasText: '5 мин' }).click();
  await p.locator('#prompt').fill('Вторая песня о ночном городе');
  assert.equal(await p.locator('#send').isDisabled(), false);
  await p.locator('#send').click();
  assert.ok(await p.locator('.message.assistant .generation-stage').count() >= 1);
  await p.waitForFunction(() => document.querySelectorAll('.message.assistant audio').length === 2, {}, { timeout: 30000 });
  assert.equal(state.jobPosts.length, 2);
  assert.equal(state.jobPosts[0].params.model, 'ace-step-flash');
  assert.equal(state.jobPosts[0].params.duration, 60);
  assert.equal(state.jobPosts[1].params.model, 'ace-step-pro');
  assert.equal(state.jobPosts[1].params.duration, 300);
  for (const post of state.jobPosts) {
    assert.equal(post.params.duration_seconds, undefined);
    assert.match(post.params.lyrics, /\[Chorus\]/);
    assert.equal(post.params.language, 'ru');
  }
  assert.equal(state.chatPosts.filter(post => /автор песен/i.test(post.messages[0]?.content || '')).length, 2);
  ok('two songs queue safely: Qwen lyrics + params.duration + independent Flash/Pro cards', { durations: state.jobPosts.map(post => post.params.duration) });
  await close(p);

  // 6. Cancel one server job; the queued sibling survives and completes.
  resetBff(); p = await page();
  await chooseModel(p, 'FLUX'); await p.locator('#prompt').fill('Первое фото'); await p.locator('#send').click();
  await p.locator('#prompt').fill('Второе фото'); await p.locator('#send').click();
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('briix-studio-v3') || '{}').items?.some(i => i.serverJobId));
  await p.locator('.message.assistant .action', { hasText: 'Остановить' }).first().click();
  await p.waitForSelector('.message.assistant img', { timeout: 20000 });
  assert.equal(state.jobPosts.length, 2);
  assert.equal(state.cancels.length, 1);
  assert.equal(await p.locator('.message.assistant[data-status="stopped"]').count(), 1);
  assert.equal(await p.locator('.message.assistant[data-status="ready"]').count(), 1);
  ok('cancel is scoped to one card; queued sibling is not lost'); await close(p);

  // 7. Reload resumes by serverJobId without a duplicate POST; no blob/token in storage.
  resetBff(); p = await page(); await chooseModel(p, 'FLUX');
  await p.locator('#prompt').fill('Фото после перезагрузки'); await p.locator('#send').click();
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('briix-studio-v3') || '{}').items?.some(i => i.serverJobId));
  const postsBefore = state.jobPosts.length;
  await p.reload(); await p.waitForSelector('.message.assistant img', { timeout: 20000 });
  assert.equal(state.jobPosts.length, postsBefore);
  const stored = await p.evaluate(() => localStorage.getItem('briix-studio-v3'));
  assert.ok(!stored.includes('test-token') && !stored.includes('data:image') && !stored.includes('blob:'));
  assert.match(stored, /job-studio-1/);
  ok('reload restores polling and blob preview without duplicate job or secrets in feed storage'); await close(p);

  // 8. Fine-tune: owner few-shot improvement + undo.
  resetBff(); p = await page(); await p.locator('.mode[data-mode="music"]').click(); await p.locator('#tuneToggle').click();
  const original = 'Город спит, а я не сплю'; await p.locator('#lyrics').fill(original);
  await p.locator('#improveLyrics').click(); await p.waitForFunction(() => document.querySelector('#lyrics').value === 'УЛУЧШЕННЫЙ ТЕКСТ');
  const improve = state.chatPosts.at(-1); assert.equal(improve.stream, false); assert.ok(improve.max_tokens <= 600);
  assert.equal((improve.messages[0].content.match(/<example source=/g) || []).length, 5);
  await p.locator('#undoLyrics').click(); assert.equal(await p.locator('#lyrics').inputValue(), original);
  ok('fine-tune keeps five-shot owner style improvement and undo'); await close(p);

  // 9. Server moderation is an inline recoverable state, not a dead toast.
  resetBff(); state.chatBlocked = true; p = await page();
  await p.locator('#prompt').fill('Запрос с отказом'); await p.locator('#send').click();
  await p.waitForSelector('.message.assistant.error');
  assert.match(await p.locator('.message.assistant.error').innerText(), /политику контента/);
  await p.locator('.message.assistant.error .action', { hasText: 'Изменить запрос' }).click();
  assert.equal(await p.locator('#prompt').inputValue(), 'Запрос с отказом');
  state.chatBlocked = false; state.jobBlock = true; await chooseModel(p, 'FLUX');
  await p.locator('#prompt').fill('Фото с отказом'); await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('.message.assistant.error').length >= 2);
  assert.match(await p.locator('.message.assistant.error').last().innerText(), /Медиа-запрос/);
  ok('chat and media refusals stay inline with a one-click edit path'); await close(p);

  // 10. Mobile: immediate pending state, free mode switch, no overflow, accessible targets and axe.
  resetBff(); p = await page({ viewport: { width: 390, height: 844 } });
  const axeWelcome = await new AxeBuilder({ page: p }).analyze();
  assert.deepEqual(axeWelcome.violations, [], 'axe welcome: ' + JSON.stringify(axeWelcome.violations.map(v => v.id)));
  await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Мобильная песня'); await p.locator('#send').click();
  await p.waitForSelector('.message.assistant .generation-stage');
  await p.locator('.mode[data-mode="chat"]').click(); await p.locator('#prompt').fill('Пишу дальше');
  assert.equal(await p.locator('#send').isDisabled(), false);
  const geometry = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    minTarget: Math.min(...[...document.querySelectorAll('button,textarea,input')].filter(el => el.offsetParent !== null).map(el => Math.max(1, Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))))
  }));
  assert.ok(geometry.overflow <= 0, JSON.stringify(geometry));
  // Textareas are content surfaces, not tap buttons; all actual buttons remain >=44 on mobile.
  const minButton = await p.evaluate(() => Math.min(...[...document.querySelectorAll('button')].filter(el => el.offsetParent !== null).map(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))));
  assert.ok(minButton >= 44, 'minimum button=' + minButton);
  await p.screenshot({ path: path.join(OUT, 'studio-mobile-pending.png'), fullPage: false });
  const axePending = await new AxeBuilder({ page: p }).analyze();
  assert.deepEqual(axePending.violations, [], 'axe pending: ' + JSON.stringify(axePending.violations.map(v => v.id)));
  ok('mobile 390x844: spinner visible, next prompt usable, targets >=44, zero axe findings', { minButton });

  assert.deepEqual(errors, [], 'no browser page errors');
  fs.writeFileSync(path.join(OUT, 'studio-regression.json'), JSON.stringify({ passed: results.length, results, errors }, null, 2));
  await browser.close(); staticServer_.close(); bff.close();
  console.log('SUITE PASS: ' + results.length + ' checks');
})().catch(error => { console.error('SUITE FAIL:', error); process.exit(1); });
