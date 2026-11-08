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
// Real AAC/M4A from the stand (PR #33): decoding a genuine server file, not a renamed WAV.
const M4A_PATH = path.join(ROOT, 'assets/media/showcase/ballad30.m4a');
const M4A = fs.existsSync(M4A_PATH) ? fs.readFileSync(M4A_PATH) : null;
const POLICY_MESSAGE = 'Запрос нарушает политику контента: откровенный материал не генерируется.';

let state;
function resetBff() {
  state = { healthUp: true, musicReady: true, vocalReady: true, fileGone: false, polls: 0, posts: [], cancels: [], failSubmit: false, blockSubmit: false };
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
          { id: 'ace-step-flash', capabilities: ['song.vocal'], status: state.vocalReady ? 'ready' : 'unavailable', limits: { max_duration_seconds: 30, max_concurrent_jobs: 1 }, latency: { source: 'measured', seconds: 111 } },
          { id: 'ace-step-pro', capabilities: ['song.vocal'], status: state.vocalReady ? 'ready' : 'unavailable', limits: { max_duration_seconds: 150, max_concurrent_jobs: 1 }, latency: { source: 'measured', seconds: 596 } },
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
          if (state.blockSubmit) { send(422, { error: { code: 'content_blocked', message: POLICY_MESSAGE } }); return; }
          send(202, { job_id: 'job-music-1' });
        });
        return;
      }
      if (req.url.startsWith('/jobs/') && req.url.endsWith('/cancel')) { state.cancels.push(req.url); send(200, { id: 'job-music-1', status: 'cancelled' }); return; }
      if (req.url.startsWith('/jobs/')) {
        state.polls++;
        const post = state.posts.at(-1)?.body || {};
        const vocalModel = post.params?.model || null;
        if (vocalModel) {
          // Vocal route: honest stages from the stand, M4A result.
          const stages = ['writing-lyrics', 'synthesizing', 'album-cover'];
          if (state.polls <= stages.length) {
            send(200, { id: 'job-music-1', type: 'music', status: 'running', stage: stages[state.polls - 1], provenance: { model: vocalModel, capability: 'song.vocal', params: post.params } });
            return;
          }
          send(200, { id: 'job-music-1', type: 'music', status: 'ready', result_url: '/files/job-music-1', mime: M4A ? 'audio/mp4' : 'audio/wav', size: (M4A || WAV).length,
            provenance: { model: vocalModel, capability: 'song.vocal', wall_clock_ms: 111000, queued_ms: 12, params: post.params } });
          return;
        }
        if (state.polls === 1) { send(200, { id: 'job-music-1', type: 'music', status: 'running', stage: 'model-warmup', provenance: { model: 'musicgen-small', capability: 'instrumental' } }); return; }
        send(200, { id: 'job-music-1', type: 'music', status: 'ready', result_url: '/files/job-music-1', mime: 'audio/wav', size: WAV.length,
          provenance: { model: 'musicgen-small', capability: 'instrumental', wall_clock_ms: 81234, queued_ms: 42 } });
        return;
      }
      if (req.url.startsWith('/files/')) {
        if (state.fileGone) { send(404, { error: { code: 'file_gone', message: 'expired' } }); return; }
        const song = !!state.posts.at(-1)?.body?.params?.model;
        const body = song && M4A ? M4A : WAV;
        res.writeHead(200, { 'Content-Type': song && M4A ? 'audio/mp4' : 'audio/wav', ...cors }); res.end(body); return;
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
  // Фаза 3: ключ есть → раздел живёт сам. Кликов по тогглу больше нет.
  const enableLive = async p => {
    await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE.active(), {}, { timeout: 15000 });
  };

  // Catalog gates the mode; a stored key switches the section on by itself.
  resetBff();
  let p = await page();
  await enableLive(p);
  assert.equal(await p.locator('[data-music-action="live"]').getAttribute('aria-pressed'), 'true');
  assert.match(await p.locator('.music-mode-note').innerText(), /Приватный live/);
  assert.equal(await p.locator('#music-live-banner').isHidden(), true, 'live needs no warning banner');
  ok('stored key auto-enables live music, no toggle click', {});

  // Vocal route is live now: two modes from the catalog, timings shown as measurements.
  await p.locator('[data-music-action="kind"][data-id="song"]').click();
  assert.equal(await p.locator('.music-vocal-mode').count(), 2);
  assert.match(await p.locator('.music-vocal-mode[data-id="flash"]').innerText(), /111|1,9|1\.9/);
  assert.match(await p.locator('.music-vocal-mode[data-id="pro"]').innerText(), /до 150/);
  assert.equal(await p.locator('#music-vocal-unavailable').count(), 0);
  assert.equal(await p.locator('#music-lyrics').isVisible(), true);
  ok('song kind offers Flash and Pro with catalog timings', {});

  // Lyrics are mandatory for vocals — client stops before any POST.
  await p.locator('#music-prompt').fill('Тёплая песня о вечернем городе с русским вокалом и припевом.');
  await p.locator('#music-generate').click();
  assert.equal(state.posts.length, 0);
  assert.equal(await p.locator('#music-lyrics').getAttribute('aria-invalid'), 'true');
  assert.match(await p.locator('#music-form-error').innerText(), /лирик/i);
  ok('vocal brief without lyrics rejected client-side', {});

  // Flash: model, lyrics, language and duration all travel in params.
  await p.locator('[data-music-action="lyric-tag"][data-id="verse"]').click();
  await p.locator('#music-lyrics').fill('[verse]\nВечерний город дышит теплом\n[chorus]\nМы ещё успеем домой');
  await p.locator('[data-music-action="duration"][data-id="30"]').click();
  await p.locator('#music-generate').click();
  await p.waitForFunction(k => (JSON.parse(localStorage.getItem(k))?.tracks || []).some(t => t.mode === 'live' && t.status === 'ready'), KEY, { timeout: 30000 });
  let songPost = state.posts.at(-1).body;
  assert.equal(songPost.params.model, 'ace-step-flash');
  assert.equal(songPost.params.language, 'ru');
  assert.equal(songPost.params.duration, 30);
  assert.match(songPost.params.lyrics, /\[chorus\]/);
  let songTrack = (await read(p)).tracks.find(t => t.mode === 'live');
  assert.equal(songTrack.vocalMode, 'flash');
  assert.equal(songTrack.provenance.model, 'ace-step-flash');
  ok('Flash song: params.model/lyrics/language/duration → server', { params: { ...songPost.params, lyrics: songPost.params.lyrics.length } });

  // Real M4A from the stand decodes and names the download .m4a.
  await p.waitForFunction(id => !!window.BRIIX_MUSIC_LIVE.audioFor(id), songTrack.id, { timeout: 20000 });
  const songAudio = await p.evaluate(id => { const e = window.BRIIX_MUSIC_LIVE.audioFor(id); return { type: e.blob.type, bytes: e.bytes, duration: e.duration, peaks: e.peaks.length }; }, songTrack.id);
  assert.equal(songAudio.peaks, 128);
  if (M4A) {
    assert.match(songAudio.type, /mp4|m4a|aac/);
    assert.ok(songAudio.duration > 20, 'duration decoded from the real 30-second AAC file');
  }
  const dl = p.waitForEvent('download', { timeout: 15000 });
  await p.locator('[data-music-action="download"]').first().click();
  const file = await dl;
  assert.match(file.suggestedFilename(), M4A ? /\.m4a$/ : /\.wav$/);
  ok('server audio decodes and downloads with the right extension', { type: songAudio.type, duration: songAudio.duration, name: file.suggestedFilename() });

  // Lyrics of a live song stay visible in the card (no tag parser needed).
  assert.match(await p.locator('.music-lyrics-block').innerText(), /Текст песни/);
  ok('live song card exposes its lyrics', {});

  // Pro raises the duration ceiling to 150 s and switches the model.
  await p.locator('[data-music-action="vocal-mode"][data-id="pro"]').click();
  assert.equal(await p.locator('[data-music-action="duration"][data-id="150"]').count(), 1);
  await p.locator('[data-music-action="duration"][data-id="60"]').click();
  await p.locator('#music-generate').click();
  await p.waitForFunction(k => (JSON.parse(localStorage.getItem(k))?.tracks || []).some(t => t.mode === 'live' && t.vocalMode === 'pro'), KEY, { timeout: 15000 });
  songPost = state.posts.at(-1).body;
  assert.equal(songPost.params.model, 'ace-step-pro');
  assert.equal(songPost.params.duration, 60);
  ok('Pro song: 60 s within the 150 s ceiling', { params: { model: songPost.params.model, duration: songPost.params.duration } });

  // 422 is a verdict, not a failure: card with the server text, prompt kept, no new job.
  state.blockSubmit = true;
  const tracksBefore = (await read(p)).tracks.length;
  await p.locator('#music-prompt').fill('Откровенный запрос, который сервер отклонит по политике контента.');
  await p.locator('#music-generate').click();
  await p.waitForSelector('#music-refusal', { timeout: 15000 });
  const refusal = await p.locator('#music-refusal').innerText();
  assert.ok(refusal.includes(POLICY_MESSAGE), 'server message shown verbatim');
  assert.match(refusal, /Не пройдена проверка контента/);
  assert.ok(!/ошибка сервера|Сервер недоступен|Попробовать снова/i.test(refusal));
  assert.equal((await read(p)).tracks.length, tracksBefore, 'no job created for a blocked prompt');
  assert.equal(await p.locator('#music-live-banner').isHidden(), true, 'no mock fallback banner');
  assert.equal(await p.evaluate(() => window.BRIIX_MUSIC_LIVE.active()), true, 'live stays live after a refusal');
  await p.locator('[data-music-action="edit-blocked"]').click();
  assert.equal(await p.locator('#music-refusal').count(), 0);
  assert.match(await p.locator('#music-prompt').inputValue(), /Откровенный запрос/);
  ok('422 content_blocked: card, server text, prompt kept, live intact', {});
  state.blockSubmit = false;

  // Vocal models can be down while MusicGen is up: the gate is per route.
  await p.close();
  resetBff(); state.vocalReady = false;
  p = await page();
  await enableLive(p);
  await p.locator('[data-music-action="kind"][data-id="song"]').click();
  assert.equal(await p.locator('#music-vocal-unavailable').isVisible(), true);
  assert.equal(await p.locator('#music-generate').isDisabled(), true);
  await p.locator('#music-prompt').fill('Песня о городе с русским вокалом и припевом.');
  assert.equal(state.posts.length, 0);
  await p.locator('[data-music-action="kind"][data-id="instrumental"]').click();
  assert.equal(await p.locator('#music-generate').isDisabled(), false);
  ok('vocal models unavailable: song blocked, instrumental still live', { posts: state.posts.length });

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
  resetBff(); state.musicReady = false; state.vocalReady = false;
  p = await page();
  await p.waitForFunction(() => !window.BRIIX_MUSIC_LIVE.active() && !document.querySelector('#music-live-banner').hidden, {}, { timeout: 15000 });
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
