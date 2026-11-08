/* Studio checks: standalone chat/photo/music screen on the private bus.
 * Self-contained: repo on 127.0.0.1:8388, fake media-bff on 127.0.0.1:8300.
 * Run: node tools/check-studio.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
// Ports are configurable: the owner's live tunnel occupies 8388/8300, so the suite
// defaults to free high ports and points studio at the mock via the same
// localStorage server key bus-live.js uses.
const STATIC_PORT = Number(process.env.BRIIX_STUDIO_STATIC_PORT || 18388);
const BFF_PORT = Number(process.env.BRIIX_STUDIO_BFF_PORT || 18300);
const TOKEN = 'test-token';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.m4a': 'audio/mp4', '.json': 'application/json', '.woff2': 'font/woff2' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const M4A_PATH = path.join(ROOT, 'assets/media/showcase/ballad30.m4a');
const M4A = fs.existsSync(M4A_PATH) ? fs.readFileSync(M4A_PATH) : Buffer.from('fake-m4a');
const POLICY_MESSAGE = 'Запрос нарушает политику контента.';

let state;
function resetBff() {
  state = {
    chatPosts: [], chatBlocked: false, chatImproveText: 'УЛУЧШЕННЫЙ ТЕКСТ',
    jobPosts: [], jobBlock: false, polls: 0
  };
}
resetBff();

function staticServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('#')[0].split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

function sse(res, fullText) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` });
  const words = fullText.split(' ');
  let i = 0;
  const timer = setInterval(() => {
    if (i < words.length) {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: (i ? ' ' : '') + words[i] } }] }) + '\n\n');
      i++;
    } else {
      res.write('data: [DONE]\n\n');
      clearInterval(timer);
      res.end();
    }
  }, 5);
  res.on('close', () => clearInterval(timer));
}

function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      const readBody = cb => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => cb(JSON.parse(raw || '{}'))); };

      if (req.url === '/health') { send(200, { ok: true }); return; }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'no' } }); return; }

      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        readBody(body => {
          state.chatPosts.push(body);
          if (state.chatBlocked) { send(422, { error: { code: 'content_blocked', message: POLICY_MESSAGE } }); return; }
          const last = body.messages.at(-1)?.content || '';
          // Кнопка «Улучшить» ходит non-stream, чат — stream.
          if (body.stream === false) return send(200, { choices: [{ message: { content: state.chatImproveText } }] });
          sse(res, 'Стрим пришёл: ' + last.slice(-40));
        });
        return;
      }

      if (req.url === '/jobs' && req.method === 'POST') {
        readBody(body => {
          state.jobPosts.push(body);
          if (state.jobBlock) { send(422, { error: { code: 'content_blocked', message: POLICY_MESSAGE } }); return; }
          send(202, { job_id: 'job-studio-1' });
        });
        return;
      }

      if (req.url.startsWith('/jobs/job-studio-1')) {
        state.polls++;
        const post = state.jobPosts.at(-1) || {};
        if (state.polls <= 2) {
          const stage = post.type === 'music' ? (state.polls === 1 ? 'writing-lyrics' : 'synthesizing') : 'generating';
          send(200, { id: 'job-studio-1', type: post.type, status: 'running', stage });
          return;
        }
        send(200, { id: 'job-studio-1', type: post.type, status: 'ready', result_url: post.type === 'music' ? '/files/job-studio-1.m4a' : '/files/job-studio-1.png' });
        return;
      }

      if (req.url.startsWith('/files/job-studio-1.png')) { res.writeHead(200, { 'Content-Type': 'image/png', ...cors }); res.end(PNG); return; }
      if (req.url.startsWith('/files/job-studio-1.m4a')) { res.writeHead(200, { 'Content-Type': 'audio/mp4', ...cors }); res.end(M4A); return; }
      send(404, { error: { code: 'not_found', message: 'nf' } });
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const staticSrv = await staticServer(STATIC_PORT);
  const bff = await bffServer(BFF_PORT);
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name }); console.log('PASS', name, JSON.stringify(data)); };
  const errors = [];
  const URL_ = `http://127.0.0.1:${STATIC_PORT}/studio.html`;

  async function page({ viewport = { width: 1440, height: 1000 }, token = TOKEN } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    if (token) await p.addInitScript(({ t, port }) => {
      localStorage.setItem('briix-media-live-token', t);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
    }, { t: token, port: BFF_PORT });
    else await p.addInitScript(port => localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port)), BFF_PORT);
    await p.goto(URL_);
    await p.waitForSelector('#create');
    return p;
  }

  // 1. Загрузка без ошибок + 3 режима.
  let p = await page();
  await p.waitForTimeout(300);
  assert.deepEqual(errors, [], 'no page errors on load');
  assert.equal(await p.locator('.mode').count(), 3);
  assert.equal(await p.locator('.mode[data-mode="chat"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await p.locator('#assistant option').count(), 3, 'chat has 3 assistants');
  await p.locator('.mode[data-mode="photo"]').click();
  assert.equal(await p.locator('#assistant option').count(), 1, 'photo has 1 assistant');
  assert.match(await p.locator('#assistant').innerText(), /Арт-директор/);
  await p.locator('.mode[data-mode="music"]').click();
  assert.equal(await p.locator('#assistant option').count(), 2, 'music has 2 assistants');
  assert.equal(await p.locator('#musicFields').isVisible(), true);
  assert.equal(await p.locator('#singleField').isVisible(), false);
  ok('loads clean, 3 modes, per-mode assistant sets', {});

  // 2. Инлайн-ввод ключа, когда localStorage пуст.
  p = await page({ token: '' });
  await p.locator('.mode[data-mode="chat"]').click();
  await p.locator('#inputText').fill('привет');
  await p.locator('#create').click();
  await p.waitForSelector('#keyCard:not([hidden])');
  await p.locator('#keyInput').fill(TOKEN);
  await p.locator('#keySave').click();
  const stored = await p.evaluate(() => localStorage.getItem('briix-media-live-token'));
  assert.equal(stored, TOKEN);
  ok('missing key shows inline card, saved to localStorage', {});

  // 3. Чат-стрим приходит.
  p = await page();
  await p.locator('#inputText').fill('Вопрос про музыку');
  await p.locator('#create').click();
  await p.waitForFunction(() => document.querySelectorAll('.card.assistant .body').length &&
    document.querySelector('.card.assistant .body').textContent.includes('Стрим пришёл'), {}, { timeout: 15000 });
  assert.ok(state.chatPosts.at(-1).stream === true, 'chat went as SSE stream');
  assert.match(state.chatPosts.at(-1).messages[0].content, /система|Наставник|собеседник/i);
  assert.equal(await p.locator('.card.user').count(), 1);
  ok('chat SSE stream lands in the feed with system prompt', {});

  // 4. Улучшение лирики: few-shot из creative-base, non-stream, замена поля + отмена.
  await p.locator('.mode[data-mode="music"]').click();
  const originalLyrics = 'Город спит, а я не сплю';
  await p.locator('#lyrics').fill(originalLyrics);
  assert.equal(await p.locator('#improveLyrics').isDisabled(), false);
  await p.locator('#improveLyrics').click();
  await p.waitForFunction(() => document.getElementById('lyrics').value.includes('УЛУЧШЕННЫЙ ТЕКСТ'), {}, { timeout: 15000 });
  const improvePost = state.chatPosts.at(-1);
  assert.equal(improvePost.stream, false);
  assert.ok(Array.isArray(improvePost.messages) && improvePost.messages[0].role === 'system');
  const sys = improvePost.messages[0].content;
  assert.ok(/<example source=/.test(sys), 'system prompt carries few-shot examples');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/creative-base.json'), 'utf8'));
  const exampleCount = (sys.match(/<example source=/g) || []).length;
  assert.equal(exampleCount, 5, 'exactly 5 few-shot examples');
  assert.ok(base.lyrics.some(l => sys.includes(l.text)), 'examples come from owner lyrics pool');
  assert.ok(improvePost.max_tokens <= 600);
  assert.equal(await p.locator('#undoLyrics').isVisible(), true);
  await p.locator('#undoLyrics').click();
  assert.equal(await p.locator('#lyrics').inputValue(), originalLyrics, 'undo restores original text');
  // Пустое поле — кнопка неактивна.
  await p.locator('#lyrics').fill('');
  assert.equal(await p.locator('#improveLyrics').isDisabled(), true);
  ok('lyrics improve: few-shot from creative-base, replace + undo, disabled when empty', { exampleCount });

  // 5. Музыка-джоб уходит с lyrics из второго поля + стадии + плеер.
  await p.locator('#lyrics').fill('[verse]\nГород спит\n[chorus]\nА я не сплю');
  await p.locator('#musicPrompt').fill('dream pop, 90 BPM, female vocals');
  await p.evaluate(() => {
    window.__stageSeen = [];
    window.__mutLog = [];
    new MutationObserver(muts => {
      for (const r of muts) {
        const t = (r.target.textContent || '').slice(0, 40);
        window.__mutLog.push(r.type + ':' + t);
        const m = t.match(/Пишем лирику|Синтезируем/);
        if (m && !window.__stageSeen.includes(m[0])) window.__stageSeen.push(m[0]);
      }
    }).observe(document.getElementById('feed'), { subtree: true, childList: true, characterData: true });
  });
  await p.locator('#create').click();
  await p.waitForSelector('.card.stage', { timeout: 10000 });
  await p.waitForSelector('.card.assistant audio', { timeout: 20000 });
  await p.waitForSelector('.card.assistant audio', { timeout: 20000 });
  const seen = await p.evaluate(() => window.__stageSeen);
  assert.ok(seen.length >= 1, 'polling stages were shown: ' + seen.join(',')
    + ' | url: ' + p.url()
    + ' | cards: ' + await p.evaluate(() => [...document.querySelectorAll('#feed .card')].map(c => c.className).join('; '))
    + ' | mut: ' + await p.evaluate(() => (window.__mutLog || ['NO-LOG']).slice(0, 8).join(' | ')));
  const musicPost = state.jobPosts.at(-1);
  assert.equal(musicPost.type, 'music');
  assert.equal(musicPost.prompt, 'dream pop, 90 BPM, female vocals');
  assert.match(musicPost.params.lyrics, /\[chorus\]/);
  assert.equal(musicPost.params.model, 'ace-step-flash');
  // Переключатель Pro меняет params.model.
  await p.locator('.seg-btn[data-quality="pro"]').click();
  await p.locator('#create').click();
  await p.waitForFunction(() => document.querySelectorAll('audio').length >= 2, {}, { timeout: 20000 });
  assert.equal(state.jobPosts.at(-1).params.model, 'ace-step-pro');
  ok('music job: prompt + params.lyrics + flash/pro switch, stages, audio player', {});

  // 6. Фото-джоб: превью в ленту.
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#inputText').fill('neon city at night');
  await p.locator('#create').click();
  await p.waitForSelector('.card img', { timeout: 20000 });
  const photoPost = state.jobPosts.at(-1);
  assert.equal(photoPost.type, 'image');
  const natural = await p.locator('.card img').first().evaluate(img => img.naturalWidth);
  assert.ok(natural > 0, 'PNG preview actually decoded');
  ok('photo job renders decoded PNG preview', {});

  // 7. Модерация 422 → карточка.
  state.chatBlocked = true;
  await p.locator('.mode[data-mode="chat"]').click();
  const blockedText = 'запрещённый текст';
  await p.locator('#inputText').fill(blockedText);
  await p.locator('#create').click();
  await p.waitForSelector('.card.error', { timeout: 10000 });
  const errText = await p.locator('.card.error').innerText();
  assert.match(errText, /Не пройдена проверка контента/);
  assert.equal(await p.locator('#inputText').inputValue(), blockedText, 'blocked text kept in the field');
  ok('422 content_blocked shows moderation card, text preserved', {});

  // 8. Мобильный вьюпорт 390×844: без горскролла.
  p = await page({ viewport: { width: 390, height: 844 } });
  await p.waitForTimeout(300);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, 'no horizontal scroll at 390px, overflow=' + overflow);
  const tap = await p.evaluate(() => {
    const sizes = [...document.querySelectorAll('button, select, textarea, input')]
      .filter(el => el.offsetParent !== null)
      .map(el => el.getBoundingClientRect().height);
    return Math.min(...sizes);
  });
  assert.ok(tap >= 36, 'smallest touch target >= 36px, got ' + tap);
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-390.png'), fullPage: true });
  ok('mobile 390x844: no h-scroll, touch targets OK', { minTarget: Math.round(tap) });

  assert.deepEqual(errors, [], 'no page errors anywhere');
  await browser.close();
  staticSrv.close();
  bff.close();
  console.log('SUITE PASS: ' + results.length + ' checks');
})().catch(e => { console.error('SUITE FAIL:', e); process.exit(1); });
