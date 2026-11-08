/* Фаза 3, п.1: live по умолчанию.
 * Один ключ в Настройках → чат, музыка и изображения работают на стенде без тогглов.
 * Нет ключа / стенд лёг / ключ отклонён → сценарный режим с явным баннером и кнопкой в Настройки.
 * Self-contained: репозиторий на 127.0.0.1:8388, фейковый media-bff на 127.0.0.1:8300.
 * Run: node tools/check-live-default.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = 8388, BFF_PORT = 8300;
const TOKEN = 'stand-key';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain' };
const MODELS = [
  { id: 'qwen3:4b-instruct', capabilities: ['chat', 'text.generate'], status: 'ready', limits: { max_concurrent_jobs: 1 } },
  { id: 'flux-2-klein-4b', capabilities: ['image.generate'], status: 'ready', limits: { max_concurrent_jobs: 1 } },
  { id: 'musicgen-small', capabilities: ['music.generate'], status: 'ready', limits: { max_duration_seconds: 420, max_concurrent_jobs: 1 } },
  { id: 'ace-step-flash', capabilities: ['song.vocal'], status: 'ready', limits: { max_duration_seconds: 30, max_concurrent_jobs: 1 }, latency: { source: 'measured', seconds: 111 } },
  { id: 'ace-step-pro', capabilities: ['song.vocal'], status: 'ready', limits: { max_duration_seconds: 150, max_concurrent_jobs: 1 }, latency: { source: 'measured', seconds: 596 } }
];
let state;
function resetBff() { state = { up: true, key: TOKEN, models: 0, health: 0, chats: 0 }; }
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

function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (!state.up) { req.socket.destroy(); return; }
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,idempotency-key,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      if (req.url === '/health') { state.health++; send(200, { ok: true, queue_len: 0, running: 0, backends: { image: 'ready', music: 'ready', text: 'ready' } }); return; }
      if (req.headers.authorization !== 'Bearer ' + state.key) { send(401, { error: { code: 'unauthorized', message: 'bad key' } }); return; }
      if (req.url === '/v1/models') { state.models++; send(200, { object: 'list', data: MODELS }); return; }
      if (req.url === '/v1/chat/completions') {
        state.chats++;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
        res.write('data: ' + JSON.stringify({ model: 'qwen3:4b-instruct', choices: [{ index: 0, delta: { content: 'ОТВЕТ СТЕНДА: всё считает ваша модель.' } }] }) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      if (req.url === '/jobs' && req.method === 'POST') { send(202, { job_id: 'job-stand-1' }); return; }
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
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  const contexts = [];
  const errors = [];
  const dialogs = [];
  async function page({ token = null, hash = '#/' } = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    contexts.push(context);
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', async d => { dialogs.push(d.type()); await d.dismiss(); });
    await p.addInitScript(({ token, server }) => {
      localStorage.setItem('briix-media-live-server', JSON.stringify(server));
      if (token) localStorage.setItem('briix-media-live-token', token);
    }, { token, server: `http://127.0.0.1:${BFF_PORT}` });
    await p.goto(`http://127.0.0.1:${STATIC_PORT}/${hash}`);
    await p.waitForSelector('#main-content');
    return p;
  }
  const go = async (p, hash, selector) => {
    await p.evaluate(h => { location.hash = h; }, hash);
    await p.waitForSelector(selector, { timeout: 15000 });
  };

  // 1. Ключа нет — сценарный режим, и это написано прямым текстом в каждом разделе.
  resetBff();
  let p = await page();
  await p.waitForFunction(() => !document.querySelector('#chat-live-banner')?.hidden, {}, { timeout: 15000 });
  assert.match(await p.locator('#chat-live-banner').innerText(), /Мок: стенд не подключён/);
  assert.equal(await p.locator('#chat-live-banner [data-live-settings]').isVisible(), true);
  await go(p, '#/music', '.music-page');
  await p.waitForFunction(() => !document.querySelector('#music-live-banner')?.hidden, {}, { timeout: 15000 });
  assert.match(await p.locator('#music-live-banner').innerText(), /Мок: стенд не подключён/);
  assert.equal(await p.evaluate(() => window.BRIIX_MUSIC_LIVE.active()), false);
  await go(p, '#/media', '.media-page');
  await p.waitForFunction(() => !document.querySelector('#media-live-banner')?.hidden, {}, { timeout: 15000 });
  assert.match(await p.locator('#media-live-banner').innerText(), /Мок: стенд не подключён/);
  assert.equal(await p.evaluate(() => window.BRIIX_MEDIA_LIVE.active()), false);
  ok('no key: all three sections say "мок" and link to Settings', {});

  // 2. Тоггл без ключа ведёт в Настройки, а не в window.prompt.
  await p.locator('[data-media-action="live"]').click();
  await p.waitForSelector('#stand-token', { timeout: 15000 });
  await p.waitForTimeout(400);   // переход по hash перерисовывает страницу — даём ей устояться
  assert.deepEqual(dialogs, [], 'никаких window.prompt');
  ok('toggle without a key routes to the Settings field, no prompt()', {});

  // 3. Настройки: вставил ключ → «Сохранить и проверить» → каталог посчитан.
  await p.locator('#stand-token').fill(TOKEN);
  assert.equal(await p.locator('#stand-token').inputValue(), TOKEN);
  await p.locator('[data-action="stand-save"]').click();
  await p.waitForFunction(() => /Стенд доступен/.test(document.querySelector('#stand-status')?.textContent || ''), {}, { timeout: 15000 })
    .catch(async e => { throw new Error('stand-save: ' + await p.locator('#stand-status').innerText() + ' | errors: ' + errors.join('; ')); });
  const status = await p.locator('#stand-status').innerText();
  assert.match(status, /5 из 5 моделей ready/);
  assert.equal(await p.evaluate(() => localStorage.getItem('briix-media-live-token')), TOKEN);
  assert.equal(await p.locator('#stand-token').inputValue(), '', 'поле очищено после сохранения');
  ok('Settings: save + check reports ready models', { status });

  // 4. Тот же ключ — разделы живые сами, без единого клика по тогглу.
  await go(p, '#/music', '.music-page');
  await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 15000 });
  assert.equal(await p.locator('[data-music-action="live"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await p.locator('#music-live-banner').isHidden(), true);
  await go(p, '#/media', '.media-page');
  await p.waitForFunction(() => window.BRIIX_MEDIA_LIVE.active(), {}, { timeout: 15000 });
  assert.equal(await p.locator('[data-media-action="live"]').getAttribute('aria-pressed'), 'true');
  await go(p, '#/', '#prompt-input');
  await p.waitForFunction(() => window.BRIIX_CHAT_LIVE.active(), {}, { timeout: 15000 });
  await p.locator('#prompt-input').fill('Проверка живого чата после ввода ключа.');
  await p.locator('#send-button').click();
  await p.waitForFunction(() => /ОТВЕТ СТЕНДА/.test(document.querySelector('.message.assistant .prose')?.textContent || ''), {}, { timeout: 20000 });
  assert.ok(state.chats > 0, 'chat hit the stand');
  ok('one key → music, images and chat live with zero toggles', { chats: state.chats });

  // 5. Перезагрузка сохраняет live: ключ тот же, автостарт снова срабатывает.
  await p.reload();
  await p.waitForFunction(() => window.BRIIX_CHAT_LIVE.active(), {}, { timeout: 15000 });
  ok('reload keeps live on without clicks', {});
  await p.close();

  // 6. Ручное «выключить» уважается и переживает перезагрузку.
  resetBff();
  p = await page({ token: TOKEN, hash: '#/music' });
  await p.waitForSelector('.music-page');
  await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 15000 });
  await p.locator('[data-music-action="live"]').click();
  await p.waitForFunction(() => !window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 10000 });
  assert.match(await p.locator('#music-live-banner').innerText(), /выключен вручную/);
  await p.reload();
  await p.waitForSelector('.music-page');
  await p.waitForTimeout(1200);
  assert.equal(await p.evaluate(() => window.BRIIX_MUSIC_LIVE.active()), false, 'ручное выключение не сбрасывается перезагрузкой');
  await p.locator('[data-music-action="live"]').click();
  await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 15000 });
  ok('manual off survives reload and can be switched back on', {});
  await p.close();

  // 7. Ключ отклонён стендом — честный мок, а не «живой» интерфейс.
  resetBff(); state.key = 'другой-ключ';
  p = await page({ token: TOKEN, hash: '#/music' });
  await p.waitForSelector('.music-page');
  await p.waitForFunction(() => !document.querySelector('#music-live-banner')?.hidden, {}, { timeout: 15000 })
    .catch(async () => { throw new Error('401 case: banner=' + await p.evaluate(() => { const e = document.querySelector('#music-live-banner'); return e ? JSON.stringify({ hidden: e.hidden, text: e.textContent }) : 'нет'; }) + ' active=' + await p.evaluate(() => window.BRIIX_MUSIC_LIVE.active()) + ' errors=' + errors.join('; ')); });
  assert.match(await p.locator('#music-live-banner').innerText(), /ключ отклонён/);
  assert.equal(await p.evaluate(() => window.BRIIX_MUSIC_LIVE.active()), false);
  await go(p, '#/settings', '#stand-token');
  await p.locator('[data-action="stand-check"]').click();
  await p.waitForFunction(() => /401/.test(document.querySelector('#stand-status')?.textContent || ''), {}, { timeout: 15000 });
  ok('rejected key: explicit mock banner and 401 in Settings', {});
  await p.close();

  // 8. Стенд лёг — тот же честный мок и рабочая кнопка проверки.
  resetBff(); state.up = false;
  p = await page({ token: TOKEN, hash: '#/media' });
  await p.waitForSelector('.media-page');
  await p.waitForFunction(() => !document.querySelector('#media-live-banner')?.hidden, {}, { timeout: 15000 });
  assert.match(await p.locator('#media-live-banner').innerText(), /стенд недоступен/);
  assert.equal(await p.evaluate(() => window.BRIIX_MEDIA_LIVE.active()), false);
  ok('stand down: mock banner, no fake live', {});
  await p.close();

  // 9. «Убрать ключ» возвращает сценарный режим сразу же.
  resetBff();
  p = await page({ token: TOKEN, hash: '#/settings' });
  await p.waitForSelector('#stand-token');
  await p.locator('[data-action="stand-clear"]').click();
  await p.waitForFunction(() => !localStorage.getItem('briix-media-live-token'), {}, { timeout: 10000 });
  await go(p, '#/music', '.music-page');
  await p.waitForFunction(() => !document.querySelector('#music-live-banner')?.hidden, {}, { timeout: 15000 });
  assert.match(await p.locator('#music-live-banner').innerText(), /стенд не подключён/);
  assert.equal(await p.evaluate(() => window.BRIIX_MUSIC_LIVE.active()), false);
  ok('clear key returns the sections to the scripted mode', {});

  assert.deepEqual(dialogs, [], 'window.prompt не используется нигде');
  assert.deepEqual(errors, [], 'page errors');
  ok('no native dialogs and no page errors', {});
  console.log('DONE', results.length, 'checks');
  for (const c of contexts) await c.close();
  await browser.close();
  staticSrv.close(); bff.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
