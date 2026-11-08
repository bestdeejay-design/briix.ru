/* Optional live-mode checks: storage v1→v2 migration (Т3), reload recovery (Т4),
 * blob-only results + expiry (Т5), mode switching of mock labels (Т7).
 * Self-contained: serves the repo on 127.0.0.1:8388 and a fake media-bff on 127.0.0.1:8300.
 * Seeds go through addInitScript: the app persists its own in-memory state on pagehide
 * (demo.js suspend hook), so seeding a live page's storage is not a valid scenario.
 * Run: node tools/check-media-live.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = 8388, BFF_PORT = 8300;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };

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

// Fake media-bff: auth required, health ok, job instantly ready, file returns PNG bytes.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
const TOKEN = 'test-token';
let bffUp = true;   // /health up
let filesUp = true; // /files/{id} up (false simulates retention cleanup 404)
let cancelUp = true; // /cancel up (false simulates failed cancel, C2)
let jobsPostCount = 0; // count of POST /jobs (C3 resubmit)
function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const cors = req.headers.origin === `http://127.0.0.1:${STATIC_PORT}` ? { 'Access-Control-Allow-Origin': req.headers.origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization,idempotency-key,content-type' } : {};
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      if (req.url === '/health') { res.writeHead(bffUp ? 200 : 503, cors); res.end(bffUp ? JSON.stringify({ ok: true, backends: { image: true, music: true, text: true } }) : 'down'); return; }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { res.writeHead(401, cors); res.end('{"error":{"code":"unauthorized"}}'); return; }
      if (req.url === '/jobs' && req.method === 'POST') { jobsPostCount++; res.writeHead(202, cors); res.end(JSON.stringify({ job_id: 'job-abc' })); return; }
      if (req.url === '/jobs/job-abc/cancel' && req.method === 'POST') { if (!cancelUp) { res.writeHead(500, cors); res.end('{"error":{"code":"internal"}}'); return; } res.writeHead(200, cors); res.end(JSON.stringify({ id: 'job-abc', status: 'cancelled' })); return; }
      const m = req.url.match(/^\/jobs\/([\w-]+)$/);
      if (m) { res.writeHead(200, cors); res.end(JSON.stringify({ id: m[1], type: 'image', status: 'ready', result_url: '/files/' + m[1], provenance: { model: 'flux-2-klein-4b (sd.cpp)', params: { ratio: '1:1' }, wall_clock_ms: 1234, queued_ms: 56 } })); return; }
      const f = req.url.match(/^\/files\/([\w-]+)$/);
      if (f) { if (!filesUp) { res.writeHead(404, cors); res.end('{"error":{"code":"file_gone"}}'); return; } res.writeHead(200, { ...cors, 'Content-Type': 'image/png' }); res.end(PNG); return; }
      res.writeHead(404, cors); res.end();
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const results = [];
  const ok = (name, data = {}) => { results.push(name); console.log('PASS', name, JSON.stringify(data)); };
  const staticS = await staticServer(STATIC_PORT);
  const bffS = await bffServer(BFF_PORT);
  const b = await launch();
  const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await c.addInitScript(() => localStorage.setItem('briix-media-live-token', 'test-token'));
  const errors = [];
  async function freshPage(seed, rawSeed = false) {
    const p = await c.newPage();
    // NOTE: init scripts are serialized without closures — literals only inside.
    if (seed) await p.addInitScript(v => localStorage.setItem('briix-media-v1', typeof v === 'string' ? v : JSON.stringify(v)), seed);
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${STATIC_PORT}/#/media`);
    await p.waitForSelector('.media-page');
    return p;
  }
  const read = p => p.evaluate(() => JSON.parse(localStorage.getItem('briix-media-v1')));

  const mockJob = { id: 'media-mock-1', type: 'image', recipe: 'product-photo', asset: 'ceramic', goal: 'product', ratio: '1:1', project: 'Старый мок', prompt: 'Старый бриф мок-задачи для проверки миграции.', status: 'ready', progress: 100, favorite: true, createdAt: 1699999999999, startedAt: null, fail: false, references: [] };
  const liveRecord = extra => ({ id: 'live-abc', type: 'image', mode: 'live', recipe: null, asset: null, goal: 'social', ratio: '1:1', project: 'Live фото', prompt: 'Live-бриф: чашка на камне.', status: 'running', progress: 0, favorite: false, createdAt: Date.now(), startedAt: null, fail: false, references: [], serverJobId: 'job-abc', resultUrl: null, provenance: { model: null, params: null, wall_clock_ms: null, queued_ms: null }, ...extra });

  // ---- Т3a: v1 → v2 upgrade without loss ----
  let p = await freshPage({ version: 1, jobs: [mockJob] });
  const after1 = await read(p);
  assert.equal(after1.version, 2);
  assert.equal(after1.jobs[0].id, 'media-mock-1');
  assert.equal(after1.jobs[0].status, 'ready');
  assert.equal(after1.jobs[0].favorite, true);
  assert.equal(after1.jobs[0].prompt, mockJob.prompt);
  assert.deepEqual(errors, []);
  ok('Т3 v1→v2 upgrade without loss', { before: { version: 1, jobs: 1 }, after: { version: after1.version, job: after1.jobs[0].id, status: after1.jobs[0].status, favorite: after1.jobs[0].favorite } });

  // ---- Т3b: v2 with live fields accepted, no throw ----
  p = await freshPage({ version: 2, jobs: [mockJob, liveRecord({ provenance: { model: 'musicgen-small', params: { tokens: 750 }, wall_clock_ms: null, queued_ms: null } })] });
  await sleep(400);
  const after2 = await read(p);
  const liveJob = after2.jobs.find(j => j.id === 'live-abc');
  assert.ok(liveJob, 'live job survived load');
  assert.equal(liveJob.serverJobId, 'job-abc');
  assert.equal(liveJob.provenance.model, 'musicgen-small');
  assert.deepEqual(errors, []);
  ok('Т3 v2 accepted, live fields preserved', { jobs: after2.jobs.length, live: { id: liveJob.id, mode: liveJob.mode, serverJobId: liveJob.serverJobId, model: liveJob.provenance.model } });

  // ---- Т3c: garbage → protected banner, storage NOT wiped ----
  const garbage = '{"version":9,"jobs":"not-an-array"}';
  p = await freshPage(garbage, true);
  await sleep(400);
  assert.equal(await p.locator('#media-storage-notice').isHidden(), false, 'protected banner shown');
  const rawNow = await p.evaluate(() => localStorage.getItem('briix-media-v1'));
  assert.equal(rawNow, garbage, 'garbage storage left untouched');
  ok('Т3 garbage → protected banner, no wipe', { preserved: rawNow === garbage });

  // ---- Т7: mock labels in mock mode ----
  assert.ok((await p.locator('.media-mode-note').innerText()).includes('Локальный мок'));
  assert.ok((await p.locator('.media-local-label').innerText()).includes('Локальный мок'));
  ok('Т7 mock labels shown in mock mode');

  // ---- live submit flow (fake bff): queued → ready, blob preview ----
  p = await freshPage();
  await p.evaluate(() => localStorage.removeItem('briix-media-v1'));
  await p.reload();
  await p.waitForSelector('.media-page');
  await p.locator('[data-media-action="live"]').click();
  await sleep(400);
  await p.locator('#media-prompt').fill('Live-бриф: керамическая чашка на камне, мягкий свет.');
  await p.locator('#media-generate').click();
  // Общий контекст: pagehide предыдущей страницы успевает вернуть её состояние в
  // localStorage, поэтому ищем именно только что отправленный бриф, а не «первый live».
  const LIVE_PROMPT = 'Live-бриф: керамическая чашка';
  await p.waitForFunction(prefix => { const s = JSON.parse(localStorage.getItem('briix-media-v1') || '{"jobs":[]}'); return s.jobs.some(j => j.mode === 'live' && j.prompt.startsWith(prefix) && j.status === 'ready'); }, LIVE_PROMPT, { timeout: 15000 });
  const live = (await read(p)).jobs.find(j => j.mode === 'live' && j.prompt.startsWith(LIVE_PROMPT));
  assert.ok(live, 'just-submitted live job is present');
  assert.equal(live.serverJobId, 'job-abc');
  assert.ok(live.resultUrl.startsWith(`http://127.0.0.1:${BFF_PORT}/files/`));
  await p.waitForFunction(() => { const img = document.querySelector('.media-preview-frame img'); return img && img.src.startsWith('blob:'); }, {}, { timeout: 10000 });
  const stored = await p.evaluate(prefix => JSON.stringify(JSON.parse(localStorage.getItem('briix-media-v1')).jobs.find(j => j.mode === 'live' && j.prompt.startsWith(prefix))), LIVE_PROMPT);
  assert.ok(!stored.includes('data:'), 'no base64 in localStorage');
  assert.ok(stored.length < 2000, 'storage record stays tiny');
  assert.deepEqual(errors, []);
  ok('Т4/Т5 live submit→ready, blob preview, no base64', { recordBytes: stored.length, provenance: live.provenance });

  // ---- Т4: reload during running → recovery by polling ----
  p = await freshPage({ version: 2, jobs: [liveRecord({ provenance: live.provenance })] });
  await p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('briix-media-v1')); return s.jobs.find(j => j.mode === 'live')?.status === 'ready'; }, {}, { timeout: 15000 });
  // Статус ready наступает раньше, чем долетает GET /files и создаётся blob:
  // ждём именно blob, как в проверке Т4/Т5 выше, иначе тест гонится с fetch.
  await p.waitForFunction(() => (document.querySelector('.media-preview-frame img')?.src || '').startsWith('blob:'), {}, { timeout: 10000 });
  const blob = await p.evaluate(() => document.querySelector('.media-preview-frame img')?.src || '');
  assert.ok(blob.startsWith('blob:'), 'blob preview restored after reload');
  ok('Т4 reload during running recovered by polling', { blobPreview: blob.slice(0, 18) + '…' });

  // ---- Т4/Т7: server down → interrupted + explicit mock-mode banner ----
  bffUp = false;
  p = await freshPage({ version: 2, jobs: [liveRecord()] });
  await p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('briix-media-v1')); return s.jobs.find(j => j.mode === 'live')?.status === 'interrupted'; }, {}, { timeout: 10000 });
  assert.equal(await p.locator('#media-live-banner').isHidden(), false, 'live-unavailable banner shown');
  assert.ok((await p.locator('#media-live-banner').innerText()).includes('Мок-режим'));
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'briix-live-mock-banner.png'), fullPage: true });
  bffUp = true;
  ok('Т4/Т7 server down → interrupted + explicit mock-mode banner', { screenshot: 'briix-live-mock-banner.png' });

  // ---- Т5: file gone on server → «результат истёк» ----
  filesUp = false;
  p = await freshPage({ version: 2, jobs: [liveRecord({ status: 'ready', resultUrl: `http://127.0.0.1:${BFF_PORT}/files/job-abc` })] });
  await p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('briix-media-v1')); return s.jobs.find(j => j.mode === 'live')?.status === 'expired'; }, {}, { timeout: 10000 });
  filesUp = true;
  ok('Т5 expired after server cleanup 404', { status: 'expired' });

  // ---- C2: cancel при ошибке сервера → interrupted + баннер, НЕ cancelled ----
  cancelUp = false;
  p = await freshPage({ version: 2, jobs: [liveRecord()] });
  await p.locator('#media-tab-queue').click();
  await p.locator('[data-media-action="cancel"]').click();
  await p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('briix-media-v1')); return s.jobs.find(j => j.mode === 'live')?.status === 'interrupted'; }, {}, { timeout: 10000 });
  assert.equal(await p.locator('#media-live-banner').isHidden(), false, 'cancel-failure banner shown');
  assert.ok((await p.locator('#media-live-banner').innerText()).includes('прерван'));
  cancelUp = true;
  const afterCancel = (await read(p)).jobs.find(j => j.mode === 'live');
  assert.equal(afterCancel.status, 'interrupted');
  ok('C2 failed cancel → interrupted + banner, not cancelled', { status: afterCancel.status });

  // ---- C3: retry interrupted → resubmit принимает serverJobId, job готов ----
  const postsBefore = jobsPostCount;
  p = await freshPage({ version: 2, jobs: [liveRecord({ status: 'interrupted' })] });
  await p.locator('[data-media-action="live"]').click(); // interrupted не авто-восстанавливается: включаем live вручную
  await sleep(400);
  await p.locator('#media-tab-queue').click();
  await p.locator('[data-media-action="retry"]').click();
  await p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('briix-media-v1')); const j = s.jobs.find(x => x.mode === 'live'); return j && j.serverJobId === 'job-abc' && j.status === 'ready'; }, {}, { timeout: 15000 });
  assert.equal(jobsPostCount, postsBefore + 1, 'resubmit hit POST /jobs exactly once');
  const retried = (await read(p)).jobs.find(j => j.mode === 'live');
  assert.equal(retried.status, 'ready');
  assert.deepEqual(errors, []);
  ok('C3 retry interrupted → resubmit → ready', { serverJobId: retried.serverJobId });

  // ---- C1: короткий промпт в live-режиме не уходит на сервер (клиентская валидация) ----
  const postsBeforeC1 = jobsPostCount;
  p = await freshPage();
  await p.evaluate(() => localStorage.removeItem('briix-media-v1'));
  await p.reload();
  await p.waitForSelector('.media-page');
  await p.locator('[data-media-action="live"]').click();
  await sleep(400);
  await p.locator('#media-prompt').fill('коротко');
  await p.locator('#media-generate').click();
  await sleep(500);
  assert.equal(jobsPostCount, postsBeforeC1, 'no POST /jobs for short prompt');
  assert.equal(await p.locator('#media-form-error').isHidden(), false, 'inline validation error shown');
  ok('C1 short prompt rejected client-side, no server call', { posts: jobsPostCount });

  assert.deepEqual(errors, [], 'no page errors across all scenarios');
  await b.close(); staticS.close(); bffS.close();
  console.log(`DONE ${results.length} checks`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
