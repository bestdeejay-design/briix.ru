/* Регресс на жалобу: «в чате такая тряска во время ответа, что невозможно печатать».
 *
 * Пока модель отвечает потоком, человек имеет право писать следующий вопрос.
 * Проверяем не «на глаз», а измерениями: положение поля ввода, прокрутка,
 * текст, фокус, каретка и идентичность уже отрисованных сообщений.
 *
 * Стрим специально медленный (chunk каждые 120 мс, ~9 секунд), чтобы успеть
 * печатать внутри ответа. Порт — от системы: общий раннер не любит фиксированные.
 */
const { launch, OUT } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'typing-token';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
// Длинный ответ: чем больше кусков, тем сильнее видна тряска.
const PIECES = Array.from({ length: 70 }, (_, i) => `Фрагмент ответа номер ${i + 1}. `);

let chunksSent = 0;
function bffServer(originRef) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === originRef.value ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      if (req.url === '/health') return send(200, { ok: true, backends: { text: 'ready' } });
      if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: { code: 'unauthorized', message: 'no' } });
      if (req.url === '/v1/models') return send(200, { object: 'list', data: [{ id: 'qwen3:4b-instruct', capabilities: ['chat', 'text.generate'], status: 'ready', limits: { max_concurrent_jobs: 2 } }] });
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        let raw = ''; req.on('data', c => raw += c);
        return req.on('end', () => {
          const body = JSON.parse(raw || '{}');
          if (!body.stream) return send(200, { choices: [{ message: { role: 'assistant', content: PIECES.join('') }, finish_reason: 'stop' }] });
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
          let i = 0;
          const tick = () => {
            if (res.destroyed) return;
            if (i < PIECES.length) {
              res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: PIECES[i++] }, finish_reason: null }] }) + '\n\n');
              chunksSent++; setTimeout(tick, 120); return;
            }
            res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
            res.write('data: [DONE]\n\n'); res.end();
          };
          tick();
        });
      }
      send(404, { error: { code: 'not_found', message: 'no' } });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
function staticServer() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('#')[0].split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const stat = await staticServer();
  const originRef = { value: `http://127.0.0.1:${stat.address().port}` };
  const bff = await bffServer(originRef);
  const busUrl = `http://127.0.0.1:${bff.address().port}`;
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(({ token, bus }) => {
    localStorage.setItem('briix-media-live-token', token);
    localStorage.setItem('briix-media-live-server', JSON.stringify(bus));
  }, { token: TOKEN, bus: busUrl });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(originRef.value + '/#/chat/example-coffee');
  await page.waitForSelector('#prompt-input');
  await page.waitForFunction(() => window.BRIIX_CHAT_LIVE?.active?.() === true, null, { timeout: 20000 });

  await page.locator('#prompt-input').fill('Расскажи подробно про кофе');
  await page.locator('#send-button').click();
  await page.waitForFunction(() => !!document.querySelector('.streaming-caret'), null, { timeout: 15000 });

  // Печатаем следующий вопрос ВНУТРИ идущего ответа и меряем тряску.
  const input = page.locator('#prompt-input');
  await input.click();
  await input.fill('');
  const TYPED = 'А можно рецепт покрепче';
  const sampler = page.evaluate(() => {
    // Узел запоминаем уже ПОСЛЕ старта ответа: добавить сообщение пользователя —
    // законная пересборка. Дальше по кусками ответа пересобирать нельзя.
    window.__firstMessageNode = document.querySelector('#messages [data-message-id]');
    window.__samples = [];
    window.__samplerId = setInterval(() => {
      const wrap = document.querySelector('.chat-composer-wrap');
      const main = document.querySelector('.main-content');
      const el = document.querySelector('#prompt-input');
      window.__samples.push({
        t: Date.now(),
        top: wrap ? Math.round(wrap.getBoundingClientRect().top * 10) / 10 : null,
        scroll: main ? Math.round(main.scrollTop) : null,
        value: el ? el.value : null,
        focused: document.activeElement === el,
        caret: el ? el.selectionStart : null,
        nodeAlive: window.__firstMessageNode ? window.__firstMessageNode.isConnected : null
      });
    }, 100);
  });
  await input.type(TYPED, { delay: 90 });
  await page.waitForTimeout(2500); // ещё несколько кусков ответа после набора
  const measured = await page.evaluate(() => { clearInterval(window.__samplerId); return window.__samples; });
  await sampler;

  assert.ok(chunksSent >= 10, 'стрим не шёл: кусков ' + chunksSent);
  const after = await page.evaluate(() => {
    const el = document.querySelector('#prompt-input');
    return { value: el.value, focused: document.activeElement === el, caret: el.selectionStart, nodeAlive: window.__firstMessageNode?.isConnected };
  });
  assert.equal(after.value, TYPED, 'набранный текст потерялся во время ответа');
  assert.equal(after.focused, true, 'фокус ушёл из поля ввода');
  assert.equal(after.caret, TYPED.length, 'каретка сбросилась');
  ok('typing survives the answer stream: text, focus and caret intact', { chunks: chunksSent, chars: TYPED.length });

  const tops = measured.map(s => s.top).filter(v => v !== null);
  const jitter = tops.length ? Math.round((Math.max(...tops) - Math.min(...tops)) * 10) / 10 : 0;
  const moves = tops.filter((v, i) => i && Math.abs(v - tops[i - 1]) > 1).length;
  assert.ok(jitter <= 2, `поле ввода трясётся: размах ${jitter}px за ${tops.length} замеров, скачков ${moves}`);
  ok('composer does not shake while the answer streams', { jitterPx: jitter, jumps: moves, samples: tops.length });

  // Человек от листал вверх читать — стрим не имеет права выдёргивать его вниз.
  // Отлистываем всего на 120px — человек поправил вид, оставаясь «у дна».
  // Именно тут старый код выдёргивал обратно на каждом куске ответа.
  await page.evaluate(() => { const m = document.querySelector('.main-content'); m.scrollTop = Math.max(0, m.scrollTop - 120); });
  const scrollBefore = await page.evaluate(() => Math.round(document.querySelector('.main-content').scrollTop));
  await page.waitForTimeout(1800);
  const scrollAfter = await page.evaluate(() => Math.round(document.querySelector('.main-content').scrollTop));
  assert.ok(Math.abs(scrollAfter - scrollBefore) <= 4, 'стрим выдернул прокрутку вниз: ' + scrollBefore + ' → ' + scrollAfter);
  ok('stream never yanks the reader back to the bottom', { before: scrollBefore, after: scrollAfter });

  assert.equal(after.nodeAlive, true, 'уже показанные сообщения пересоздаются на каждом куске');
  ok('earlier messages keep their DOM nodes during the stream');


  // Ответ доехал целиком, поле ввода не пострадало.
  await page.waitForFunction(() => !document.querySelector('.streaming-caret'), null, { timeout: 30000 });
  const final = await page.evaluate(() => ({ value: document.querySelector('#prompt-input').value, text: document.querySelector('#messages .message.assistant:last-of-type .prose')?.textContent || '' }));
  assert.equal(final.value, TYPED, 'текст вопроса потерялся к концу ответа');
  assert.ok(final.text.includes('Фрагмент ответа номер 70'), 'ответ пришёл не целиком');
  ok('answer completes and the drafted question is still there', { answerChars: final.text.length });

  // То же самое в сценарном режиме: без ключа ответ тоже идёт потоком,
  // и печатать во время него должно быть так же спокойно.
  const mockContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mock = await mockContext.newPage();
  const mockErrors = [];
  mock.on('pageerror', e => mockErrors.push(e.message));
  await mock.goto(originRef.value + '/#/chat/example-coffee');
  await mock.waitForSelector('#prompt-input');
  await mock.locator('#prompt-input').fill('Расскажи про помол');
  await mock.locator('#send-button').click();
  await mock.waitForSelector('.streaming-caret', { timeout: 15000 });
  await mock.locator('#prompt-input').click();
  await mock.locator('#prompt-input').fill('');
  await mock.evaluate(() => {
    window.__mockTops = [];
    window.__mockAliveDuringStream = [];
    window.__mockNode = document.querySelector('#messages [data-message-id]');
    window.__mockTimer = setInterval(() => {
      const w = document.querySelector('.chat-composer-wrap');
      if (w) window.__mockTops.push(Math.round(w.getBoundingClientRect().top * 10) / 10);
      // Пересборка на финише законна (появляются действия). Проверяем только то,
      // что происходило ПОКА ответ ещё шёл.
      if (document.querySelector('.streaming-caret')) window.__mockAliveDuringStream.push(!!window.__mockNode?.isConnected);
    }, 60);
  });
  await mock.locator('#prompt-input').type('А какой помол лучше', { delay: 45 });
  const mockState = await mock.evaluate(() => {
    clearInterval(window.__mockTimer);
    const el = document.querySelector('#prompt-input');
    const tops = window.__mockTops;
    return {
      value: el.value, focused: document.activeElement === el,
      jitter: tops.length ? Math.round((Math.max(...tops) - Math.min(...tops)) * 10) / 10 : 0,
      nodeAlive: window.__mockAliveDuringStream.every(Boolean) && window.__mockAliveDuringStream.length > 0, streamSamples: window.__mockAliveDuringStream.length, samples: tops.length
    };
  });
  assert.equal(mockState.value, 'А какой помол лучше', 'сценарный поток съел набранный текст');
  assert.equal(mockState.focused, true, 'сценарный поток увёл фокус');
  assert.ok(mockState.jitter <= 2, 'поле трясётся в сценарном режиме: ' + mockState.jitter + 'px');
  assert.equal(mockState.nodeAlive, true, 'сценарный поток пересоздаёт сообщения прямо во время ответа');
  ok('scenario stream is calm for typing too', { jitterPx: mockState.jitter, samples: mockState.samples });
  await mockContext.close();

  assert.deepEqual(errors, [], 'ошибки страницы: ' + errors.join('; '));
  assert.deepEqual(mockErrors, [], 'ошибки сценарного режима: ' + mockErrors.join('; '));
  ok('no page errors');

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'briix-chat-typing.json'), JSON.stringify({ passed: results.length, results, jitterPx: jitter }, null, 2));
  console.log('DONE', results.length, 'checks');
  await browser.close();
  stat.close(); bff.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
