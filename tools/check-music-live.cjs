/* Phase 2 checks: Music studio on the private bus.
 * Self-contained: repo on 127.0.0.1:8388, fake media-bff on 127.0.0.1:8300.
 * Run: node tools/check-music-live.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = 8388, BFF_PORT = 8300;
const TOKEN = 'test-token';
const KEY = 'briix-music-v1';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain' };

// One second of 8 kHz mono PCM: a real WAV so decodeAudioData and duration are honest.
function wav() {
  const rate = 8000, n = rate, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 12) * 12000), 44 + i * 2);
  return buf;
}
const WAV = wav();

let state;
function resetBff() {
  state = { healthUp: true, musicReady: true, vocalReady: false, fileGone: false, polls: 0, posts: [], cancels: [], failSubmit: false };
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

function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      // A dead tunnel means every request fails at the transport level, not just /health.
      if (!state.healthUp) { req.socket.destroy(); return; }
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,idempotency-key,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      if (req.url === '/health') { if (!state.healthUp) { res.writeHead(503, cors); res.end('{}'); return; } send(200, { ok: true, queue_len: 0, running: 0, backends: { image: 'ready', music: state.musicReady ? 'ready' : 'unavailable', text: 'ready' } }); return; }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'no' } }); return; }
      if (req.url === '/v1/models') {
        send(200, { object: 'list', data: [
          { id: 'musicgen-small', capabilities: ['music.generate'], status: state.musicReady ? 'ready' : 'unavailable', limits: { max_duration_seconds: 420, max_concurrent_jobs: 1 } },
          { id: 'ace-step-1.5', capabilities: ['song.vocal'], status: state.vocalReady ? 'ready' : 'unavailable', limits: {} },
          { id: 'qwen3:4b-instruct', capabilities: ['chat', 'text.generate'], status: 'ready', limits: {} }
        ] });
        return;
      }
      if (req.url === '/jobs' && req.method === 'POST') {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
          state.posts.push({ body: JSON.parse(raw || '{}'), idem: req.headers['idempotency-key'] || null });
          if (state.failSubmit) { send(503, { error: { code: 'backend_unavailable', message: 'down' } }); return; }
          send(202, { job_id: 'job-music-1' });
        });
        return;
      }
      if (req.url.startsWith('/jobs/') && req.url.endsWith('/cancel')) { state.cancels.push(req.url); send(200, { id: 'job-music-1', status: 'cancelled' }); return; }
      if (req.url.startsWith('/jobs/')) {
        state.polls++;
        if (state.polls === 1) { send(200, { id: 'job-music-1', type: 'music', status: 'running', stage: 'model-warmup', provenance: { model: 'musicgen-small', capability: 'instrumental' } }); return; }
        send(200, { id: 'job-music-1', type: 'music', status: 'ready', result_url: '/files/job-music-1', mime: 'audio/wav', size: WAV.length,
          provenance: { model: 'musicgen-small', capability: 'instrumental', wall_clock_ms: 81234, queued_ms: 42 } });
        return;
      }
      if (req.url.startsWith('/files/')) {
        if (state.fileGone) { send(404, { error: { code: 'file_gone', message: 'expired' } }); return; }
        res.writeHead(200, { 'Content-Type': 'audio/wav', ...cors }); res.end(WAV); return;
      }
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
  async function page(seed) {
    // Fresh context per scenario: storage from a previous scenario must not leak in.
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    contexts.push(context);
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(({ token, seed }) => {
      localStorage.setItem('briix-media-live-token', token);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:8300'));
      if (seed) localStorage.setItem('briix-music-v1', JSON.stringify(seed));
    }, { token: TOKEN, seed });
    await p.goto(`http://127.0.0.1:${STATIC_PORT}/#/music`);
    await p.waitForSelector('.music-page');
    return p;
  }
  const read = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)) || { tracks: [] }, KEY);
  const enableLive = async p => {
    await p.locator('[data-music-action="live"]').click();
    await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 10000 });
  };

  // Catalog gates the switch.
  resetBff();
  let p = await page();
  await enableLive(p);
  assert.equal(await p.locator('[data-music-action="live"]').getAttribute('aria-pressed'), 'true');
  assert.match(await p.locator('.music-mode-note').innerText(), /Приватный live/);
  ok('live toggles on and the mode note switches', {});

  // Vocals stay honest-unavailable: no active button, no server call.
  await p.locator('[data-music-action="kind"][data-id="song"]').click();
  assert.equal(await p.locator('#music-vocal-unavailable').isVisible(), true);
  assert.equal(await p.locator('#music-generate').isDisabled(), true);
  await p.locator('#music-prompt').fill('Песня о городе с русским вокалом и припевом.');
  assert.equal(state.posts.length, 0);
  ok('song.vocal unavailable in live: disabled button, no POST', { posts: state.posts.length });

  // Client-side validation still runs before anything leaves the browser.
  await p.locator('[data-music-action="kind"][data-id="instrumental"]').click();
  await p.locator('#music-prompt').fill('коротко');
  await p.locator('#music-generate').click();
  assert.equal(state.posts.length, 0);
  assert.equal(await p.locator('#music-prompt').getAttribute('aria-invalid'), 'true');
  ok('short brief rejected client-side before POST', {});

  // Instrumental goes to the bus and comes back as a real WAV.
  await p.locator('#music-project').fill('Подложка для ролика');
  await p.locator('#music-prompt').fill('Спокойная инструментальная подложка для минутного видео о мастерской.');
  await p.locator('[data-music-action="duration"][data-id="30"]').click();
  await p.locator('#music-generate').click();
  await p.waitForFunction(k => (JSON.parse(localStorage.getItem(k))?.tracks || []).some(t => t.mode === 'live' && t.status === 'ready'), KEY, { timeout: 20000 });
  const post = state.posts.at(-1);
  assert.equal(post.body.type, 'music');
  assert.ok(post.body.params.duration <= 30);
  assert.ok(post.idem, 'idempotency key sent');
  let stored = (await read(p)).tracks.find(t => t.mode === 'live');
  assert.equal(stored.serverJobId, 'job-music-1');
  assert.equal(stored.provenance.model, 'musicgen-small');
  assert.equal(stored.provenance.capability, 'instrumental');
  await p.waitForFunction(id => !!window.BRIIX_MUSIC_LIVE.audioFor(id), stored.id, { timeout: 15000 });
  const audio = await p.evaluate(id => { const e = window.BRIIX_MUSIC_LIVE.audioFor(id); return { src: e.url.slice(0, 5), duration: e.duration, bytes: e.bytes, peaks: e.peaks.length }; }, stored.id);
  assert.equal(audio.src, 'blob:');
  assert.equal(audio.peaks, 128, 'waveform decoded from the served WAV');
  assert.ok(Math.abs(audio.duration - 1) < 0.2, 'duration comes from the served WAV, not the form');
  stored = (await read(p)).tracks.find(t => t.mode === 'live');
  assert.ok(Math.abs(stored.duration - 1) < 0.2, 'track duration replaced by the real one');
  assert.match(await p.locator('.music-provenance').innerText(), /musicgen-small/);
  assert.match(await p.locator('.music-live-badge').innerText(), /Live/);
  const raw = await p.evaluate(k => localStorage.getItem(k), KEY);
  assert.ok(!raw.includes('data:audio') && !raw.includes(TOKEN), 'no audio and no token in storage');
  ok('instrumental: POST → poll → WAV blob → provenance', { post: post.body, duration: audio.duration, storageBytes: raw.length });

  // Playback of the server file works through the studio transport.
  await p.locator('[data-music-action="play"]').click();
  await p.waitForFunction(() => (document.querySelector('#music-audio')?.src || '').startsWith('blob:') && document.querySelector('#music-audio').currentTime > 0.1, {}, { timeout: 10000 });
  await p.locator('[data-music-action="play"]').click();
  ok('server WAV plays in the studio player', {});
  await p.close();

  // Backend marked unavailable in the catalog must not look active.
  resetBff(); state.musicReady = false;
  p = await page();
  await p.locator('[data-music-action="live"]').click();
  await p.waitForFunction(() => !window.BRIIX_MUSIC_LIVE.active() && !document.querySelector('#music-live-banner').hidden, {}, { timeout: 10000 });
  assert.match(await p.locator('#music-live-banner').innerText(), /unavailable/);
  assert.equal(await p.locator('[data-music-action="live"]').getAttribute('aria-pressed'), 'false');
  ok('catalog unavailable keeps the studio in mock', {});
  await p.close();

  // Tunnel death during polling: explicit banner, interrupted job, mock restored.
  resetBff();
  p = await page();
  await enableLive(p);
  await p.locator('#music-prompt').fill('Инструментал для проверки обрыва связи с сервером.');
  await p.locator('#music-generate').click();
  await p.waitForFunction(k => (JSON.parse(localStorage.getItem(k))?.tracks || []).some(t => t.mode === 'live'), KEY, { timeout: 10000 });
  state.healthUp = false;
  await p.waitForFunction(() => !window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 20000 });
  stored = (await read(p)).tracks.find(t => t.mode === 'live');
  assert.equal(stored.status, 'interrupted');
  assert.match(await p.locator('#music-live-banner').innerText(), /Мок-режим/);
  ok('tunnel death → interrupted + explicit mock banner', { status: stored.status });
  await p.close();

  // Retention on the server: 404 on the file becomes expired, not a broken player.
  resetBff(); state.fileGone = true;
  p = await page();
  await enableLive(p);
  await p.locator('#music-prompt').fill('Инструментал для проверки истёкшего результата.');
  await p.locator('#music-generate').click();
  await p.waitForFunction(k => (JSON.parse(localStorage.getItem(k))?.tracks || []).some(t => t.mode === 'live' && t.status === 'expired'), KEY, { timeout: 25000 });
  ok('server 404 on file → expired', {});
  await p.close();

  // Cancel reaches the server.
  resetBff();
  p = await page();
  await enableLive(p);
  await p.locator('#music-prompt').fill('Инструментал для проверки отмены на сервере.');
  await p.locator('#music-generate').click();
  await p.waitForFunction(k => (JSON.parse(localStorage.getItem(k))?.tracks || []).some(t => t.mode === 'live'), KEY, { timeout: 10000 });
  const id = (await read(p)).tracks.find(t => t.mode === 'live').id;
  await p.locator('[data-music-action="tab"][data-id="queue"]').click();
  await p.locator(`[data-music-action="cancel"][data-id="${id}"]`).click();
  await p.waitForFunction(k => (JSON.parse(localStorage.getItem(k))?.tracks || []).some(t => t.mode === 'live' && t.status === 'cancelled'), KEY, { timeout: 10000 });
  assert.equal(state.cancels.length, 1);
  ok('cancel is sent to the server', { cancels: state.cancels.length });
  await p.close();

  assert.deepEqual(errors, [], 'page errors');
  ok('no page errors', {});
  console.log('DONE', results.length, 'checks');
  for (const c of contexts) await c.close();
  await browser.close();
  staticSrv.close(); bff.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
