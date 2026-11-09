/* Регресс на жалобу: «экран дергается, лирику не заполнить».
 *
 * Живой опрос сервера каждые 2.5 с не имеет права трогать форму: ни текст, ни фокус,
 * ни каретка, ни прокрутка. Плюс липкая кнопка на телефоне не должна накрывать поле,
 * в которое печатают. Тест поднимает свою фейковую шину и держит задачу «running»
 * дольше нескольких циклов опроса.
 */
const { launch, OUT } = require('./browser-env.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
// Порт 0 = свободный порт от системы: общий раннер не любит фиксированные.
const PORT = Number(process.env.BRIIX_TYPING_PORT || 0);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.m4a': 'audio/mp4', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

let polls = 0;
const posted = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const route = url.pathname.replace(/^\/api/, '');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (route === '/health') return res.end(JSON.stringify({ ok: true, queue_len: 1, running: 1, backends: { music: 'ready', image: 'ready', text: 'ready' } }));
    if (route === '/v1/models') {
      return res.end(JSON.stringify({ data: [
        { id: 'ace-step-flash', kind: 'music-vocal', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 111 } },
        { id: 'ace-step-pro', kind: 'music-vocal', status: 'ready', limits: { max_duration_seconds: 150 }, latency: { seconds: 596 } },
        { id: 'musicgen-small', kind: 'music', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 80 } }
      ] }));
    }
    if (route === '/jobs' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { posted.push(JSON.parse(body)); } catch {}
        res.statusCode = 202; res.end(JSON.stringify({ job_id: 'typing-job-' + posted.length }));
      });
      return;
    }
    if (route.startsWith('/jobs/')) {
      polls++;
      // Задача намеренно не завершается: форма должна выжить несколько опросов.
      return res.end(JSON.stringify({ id: 'typing-job', status: 'running', stage: polls % 2 ? 'writing-lyrics' : 'synthesizing', progress: 40, provenance: { model: 'ace-step-flash' } }));
    }
    res.statusCode = 404; return res.end('{}');
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const listen = () => new Promise(resolve => server.listen(PORT, '0.0.0.0', () => resolve()));
const host = () => {
  const os = require('node:os');
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
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
    localStorage.setItem('briix-media-live-token', 'typing-key');
    localStorage.setItem('briix-media-live-server', JSON.stringify(base + '/api'));
    localStorage.setItem('briix-demo-settings-v1', JSON.stringify({ language: 'ru', theme: 'dark', motion: true }));
  }, BASE);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE + '/#/music');
  await page.waitForSelector('.music-page');
  await page.waitForFunction(() => window.BRIIX_MUSIC_LIVE?.active?.() === true, null, { timeout: 20000 });
  await page.locator('[data-music-action="kind"][data-id="song"]').click();
  await page.waitForSelector('#music-lyrics', { timeout: 20000 });
  await page.locator('#music-prompt').fill('Песня про любовь, тёплый вечер, спокойный вокал');
  await page.locator('#music-lyrics').fill('[verse]\nТёплый вечер за окном');
  await page.locator('#music-generate').click();
  await page.waitForFunction(() => window.BRIIX_MUSIC_LIVE?.active?.() || true);
  await page.waitForTimeout(1200);

  // Печатаем в лирику и переживаем несколько циклов опроса.
  const lyrics = page.locator('#music-lyrics');
  await lyrics.click();
  await lyrics.fill('');
  await lyrics.type('[verse]\nГород засыпает slowly', { delay: 12 });
  // Дождаться загрузки шрифтов, чтобы поздняя подмена метрик не дёрнула скролл (флейк 19px).
  await page.evaluate(() => document.fonts.ready);
  const before = await page.evaluate(() => {
    const el = document.querySelector('#music-lyrics');
    const scroller = document.querySelector('.main-content');
    return { value: el.value, focused: document.activeElement === el, caret: el.selectionStart, scroll: scroller ? scroller.scrollTop : 0, polls: 0 };
  });
  const pollsBefore = polls;
  await page.waitForTimeout(8000); // > трёх циклов опроса по 2.5 с
  const after = await page.evaluate(() => {
    const el = document.querySelector('#music-lyrics');
    const scroller = document.querySelector('.main-content');
    return { value: el ? el.value : null, focused: document.activeElement === el, caret: el ? el.selectionStart : null, scroll: scroller ? scroller.scrollTop : 0 };
  });

  assert.ok(polls - pollsBefore >= 2, 'опрос не шёл: ' + (polls - pollsBefore));
  assert.equal(after.value, before.value, 'текст лирики потерян при опросе сервера');
  assert.equal(after.focused, true, 'фокус ушёл из лирики во время опроса');
  assert.equal(after.caret, before.caret, 'каретка сбросилась');
  assert.ok(Math.abs(after.scroll - before.scroll) <= 4, 'экран дёрнулся: ' + before.scroll + ' → ' + after.scroll);
  ok('typing survives live polling: text, focus, caret and scroll intact', { pollsDuringTyping: polls - pollsBefore, length: after.value.length });

  // Дописываем ещё и проверяем, что счётчик живой, а форма не пересоздаётся.
  await lyrics.type('\n[chorus]\nМы ещё успеем домой', { delay: 10 });
  const counter = await page.locator('#music-lyrics-count').innerText();
  const value = await lyrics.inputValue();
  assert.ok(counter.startsWith(String(value.length)), 'счётчик лирики не следит за вводом: ' + counter + ' vs ' + value.length);
  ok('lyrics counter follows typing without submit', { length: value.length });

  // Липкая кнопка не накрывает поле, в которое печатают.
  const overlap = await page.evaluate(() => {
    const field = document.querySelector('#music-lyrics').getBoundingClientRect();
    const bar = document.querySelector('.music-submit-bar');
    if (!bar) return { covered: false };
    const b = bar.getBoundingClientRect();
    const style = getComputedStyle(bar);
    const intersects = style.position !== 'static' && b.top < field.bottom && b.bottom > field.top;
    return { covered: intersects, position: style.position, fieldBottom: Math.round(field.bottom), barTop: Math.round(b.top) };
  });
  assert.equal(overlap.covered, false, 'липкая кнопка накрывает поле лирики: ' + JSON.stringify(overlap));
  ok('sticky submit never covers the field being typed', overlap);

  // Отправка уходит с той лирикой, что в поле.
  const postsBefore = posted.length;
  await page.locator('#music-generate').click();
  await page.waitForTimeout(1500);
  assert.ok(posted.length > postsBefore, 'тап по кнопке отправки потерялся: задача не ушла');
  const last = posted[posted.length - 1];
  assert.ok(last, 'повторная отправка не ушла');
  assert.equal(last.params.lyrics, value, 'на сервер ушла не та лирика, что в поле');
  ok('submit sends exactly the lyrics visible in the field', { chars: last.params.lyrics.length });

  assert.deepEqual(errors, [], 'ошибки страницы');
  ok('no page errors');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'briix-music-typing.json'), JSON.stringify({ passed: results.length, results }, null, 2));
  console.log('DONE', results.length, 'checks');
  await browser.close();
  server.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
