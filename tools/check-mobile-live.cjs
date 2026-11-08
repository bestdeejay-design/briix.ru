/* Мобильный экран → настоящий transport media-bff. Сервер здесь fake, но все
 * браузерные запросы, polling, blob-результаты и модели проходят боевой JS-путь.
 * Реальный inference отдельно проверяет tools/check-live-stand.cjs на стенде A. */
const { launch, BASE_URL, OUT } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 8393;
const TOKEN = 'mobile-integration-token';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
function wav() {
  const data = Buffer.alloc(8000);
  for (let i = 0; i < data.length; i += 2) data.writeInt16LE(Math.round(Math.sin(i / 20) * 9000), i);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  return Buffer.concat([b, data]);
}
const WAV = wav();

async function fakeBff() {
  const posts = [];
  const chats = [];
  const jobs = new Map();
  let sequence = 0;
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': BASE_URL,
      'Access-Control-Allow-Headers': 'authorization,idempotency-key,content-type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { ...cors, 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const route = req.url.split('?')[0];
    if (route === '/health') return send(200, { ok: true, queue_len: 0, running: 0, backends: { image: 'ready', music: 'ready', text: 'ready' } });
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: { code: 'unauthorized', message: 'bad token' } });
    if (route === '/v1/models') {
      const rows = [
        ['qwen3:4b-instruct', ['chat', 'text.generate']],
        ['flux-2-klein-4b', ['image.generate']],
        ['musicgen-small', ['music.generate']],
        ['ace-step-flash', ['song.vocal']],
        ['ace-step-pro', ['song.vocal']]
      ];
      return send(200, { object: 'list', data: rows.map(([id, capabilities]) => ({ id, capabilities, status: 'ready', limits: { max_duration_seconds: 150 } })) });
    }
    if (route === '/v1/chat/completions' && req.method === 'POST') {
      let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
        const body = JSON.parse(raw); chats.push(body);
        if (body.stream) {
          res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
          res.write('data: ' + JSON.stringify({ model: 'qwen3:4b-instruct', choices: [{ delta: { content: 'Ответ серверной модели Qwen.' } }] }) + '\n\n');
          res.end('data: [DONE]\n\n');
        } else send(200, { model: 'qwen3:4b-instruct', choices: [{ message: { content: 'Ответ серверной модели Qwen.' } }] });
      });
      return;
    }
    if (route === '/jobs' && req.method === 'POST') {
      let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
        const body = JSON.parse(raw); posts.push(body);
        const id = `job-${++sequence}-${body.type}`;
        jobs.set(id, { ...body, status: 'queued' });
        send(202, { job_id: id });
      });
      return;
    }
    const file = /^\/files\/(job-[\w-]+)$/.exec(route);
    if (file) {
      const isImage = file[1].endsWith('-image');
      return send(200, isImage ? PNG : WAV, isImage ? 'image/png' : 'audio/wav');
    }
    const job = /^\/jobs\/(job-[\w-]+)$/.exec(route);
    if (job) {
      const data = jobs.get(job[1]);
      if (!data) return send(404, { error: { code: 'gone', message: 'gone' } });
      const model = data.type === 'image' ? 'flux-2-klein-4b' : data.params?.model || 'musicgen-small';
      return send(200, { id: job[1], status: 'ready', stage: 'ready', result_url: '/files/' + job[1], mime: data.type === 'image' ? 'image/png' : 'audio/wav', provenance: { model, params: data.params, wall_clock_ms: 1200, queued_ms: 50 } });
    }
    send(404, { error: { code: 'not_found', message: route } });
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  return { server, posts, chats, jobs };
}

(async () => {
  const bff = await fakeBff();
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const results = [];
  const ok = (name, detail = {}) => { results.push({ name, ...detail }); console.log('PASS', name, JSON.stringify(detail)); };
  page.on('pageerror', e => errors.push(e.message));
  fs.mkdirSync(OUT, { recursive: true });
  await page.addInitScript(({ token, server }) => {
    if (!localStorage.getItem('mobile-live-test-initialized')) {
      localStorage.clear();
      localStorage.setItem('briix-media-live-server', JSON.stringify(server));
      localStorage.setItem('mobile-live-test-initialized', '1');
    }
  }, { token: TOKEN, server: `http://127.0.0.1:${PORT}` });

  await page.goto(BASE_URL + '/#/home');
  await page.waitForSelector('.mobile-live-button');
  assert.match(await page.locator('.mobile-live-button').innerText(), /Подключить/);
  assert.match(await page.locator('.mobile-model-status').innerText(), /Локальный мок/);
  ok('without a key the mobile home is honestly local');

  await page.locator('.mobile-live-button').click();
  await page.locator('#stand-token').fill(TOKEN);
  await page.locator('[data-modal-action="1"]').click();
  await page.waitForFunction(() => !document.querySelector('#modal')?.open && window.BRIIX_CHAT_LIVE.active() && window.BRIIX_MEDIA_LIVE.active() && window.BRIIX_MUSIC_LIVE.active(), null, { timeout: 15000 });
  assert.match(await page.locator('.mobile-model-status').innerText(), /Live/);
  assert.match(await page.locator('#topbar').innerText(), /Приватный live/);
  assert.equal(bff.posts.length, 0, 'health checks must not create inference jobs');
  await page.screenshot({ path: path.join(OUT, 'mobile-live-connected.png'), fullPage: true });
  ok('one key starts chat, image and music on the mobile home');

  await page.locator('.mobile-media-option[data-id="image"]').click();
  await page.locator('#prompt-input').fill('Ночной город под дождём, отражения неона, кинематографичное фото');
  await page.locator('#send-button').click();
  await page.waitForSelector('.gen-image', { timeout: 20000 });
  await page.waitForFunction(() => { const img = document.querySelector('.gen-image'); return img?.complete && img.naturalWidth > 0; }, null, { timeout: 20000 });
  assert.equal(bff.posts.at(-1).type, 'image');
  assert.match(await page.locator('.gen-head').innerText(), /Live/);
  assert.match(await page.locator('.gen-image').getAttribute('src'), /^blob:/);
  ok('mobile photo goes to image job and returns an authenticated blob', { params: bff.posts.at(-1).params });

  await page.goto(BASE_URL + '/#/home');
  await page.waitForSelector('.mobile-media-switch');
  await page.locator('.mobile-media-option[data-id="music"]').click();
  await page.locator('#prompt-input').fill('Спокойный инструментал для короткого фильма о ночном городе');
  await page.locator('#send-button').click();
  await page.waitForSelector('.gen-audio', { timeout: 25000 });
  const instrumental = bff.posts.at(-1);
  assert.equal(instrumental.type, 'music');
  assert.equal(instrumental.params.model, undefined);
  assert.ok(instrumental.params.duration >= 5);
  assert.match(await page.locator('.gen-audio').getAttribute('src'), /^blob:/);
  ok('mobile instrumental uses MusicGen route and returns playable audio', { params: instrumental.params });

  await page.goto(BASE_URL + '/#/home');
  await page.waitForSelector('.mobile-media-switch');
  await page.locator('.mobile-media-option').filter({ hasText: 'Аудио' }).click();
  await page.locator('[data-action="choose-assistant"]').click();
  await page.locator('[data-action="modal-select-assistant"][data-id="songwriter"]').click();
  await page.locator('#prompt-input').fill('Песня на русском о ночном городе после дождя, светлый припев');
  await page.locator('#send-button').click();
  await page.waitForSelector('.gen-audio', { timeout: 25000 });
  const song = bff.posts.at(-1);
  assert.equal(song.type, 'music');
  assert.equal(song.params.model, 'ace-step-flash');
  assert.equal(song.params.language, 'ru');
  assert.ok(song.params.lyrics.length >= 200);
  ok('mobile song uses ACE-Step Flash with DJ1 lyrics', { model: song.params.model, lyricsLength: song.params.lyrics.length });

  await page.goto(BASE_URL + '/#/home');
  await page.waitForSelector('.mobile-media-switch');
  await page.locator('.mobile-media-option[data-id="text"]').click();
  await page.locator('#prompt-input').fill('Ответь одним коротким предложением: кто отвечает на этот вопрос?');
  await page.locator('#send-button').click();
  await page.waitForSelector('.chat-live-provenance', { timeout: 20000 });
  assert.match(await page.locator('.message-content').last().innerText(), /Ответ серверной модели Qwen/);
  assert.equal(bff.chats.length, 1);
  ok('mobile text uses Qwen chat transport with live provenance');

  await page.goto(BASE_URL + '/#/home');
  await page.waitForSelector('.mobile-media-switch');
  const beforeVideo = bff.posts.length;
  await page.locator('.mobile-media-option[data-id="video"]').click();
  assert.match(await page.locator('.mobile-model-status').innerText(), /live-видео нет/);
  await page.locator('#prompt-input').fill('Короткое видео ночного города с медленным движением камеры');
  await page.locator('#send-button').click();
  await page.waitForSelector('.message-error', { timeout: 10000 });
  assert.match(await page.locator('.message-error').innerText(), /Live-видео пока не подключено/);
  assert.equal(bff.posts.length, beforeVideo, 'video must not be replaced with an image job');
  ok('video refuses honestly and submits no image substitute');

  assert.deepEqual(errors, []);
  ok('no browser page errors');
  fs.writeFileSync(path.join(OUT, 'briix-mobile-live.json'), JSON.stringify({ passed: results.length, results, errors, posts: bff.posts.map(p => ({ type: p.type, params: p.type === 'music' ? { ...p.params, lyrics: p.params.lyrics ? `[${p.params.lyrics.length} chars]` : undefined } : p.params })), chats: bff.chats.length }, null, 2));
  console.log('DONE', results.length, 'checks');
  await browser.close();
  await new Promise(resolve => bff.server.close(resolve));
})().catch(e => { console.error('FAIL', e.stack || e); process.exit(1); });
