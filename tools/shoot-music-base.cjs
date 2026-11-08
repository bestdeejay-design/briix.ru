/* Снимки телефона для аудита: набор лирики, автолирика, поиск по базе. */
const { launch } = require('./browser-env.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.BRIIX_SHOTS || '/tmp/briix-shots';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const r = url.pathname.replace(/^\/api/, '');
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*');
    if (r === '/health') return res.end(JSON.stringify({ ok: true, queue_len: 1, running: 1, backends: { music: 'ready' } }));
    if (r === '/v1/models') return res.end(JSON.stringify({ data: [
      { id: 'ace-step-flash', kind: 'music-vocal', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 111 } },
      { id: 'ace-step-pro', kind: 'music-vocal', status: 'ready', limits: { max_duration_seconds: 150 }, latency: { seconds: 596 } },
      { id: 'musicgen-small', kind: 'music', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 80 } }
    ] }));
    if (r === '/jobs' && req.method === 'POST') { res.statusCode = 202; return res.end(JSON.stringify({ job_id: 'shot-job' })); }
    if (r.startsWith('/jobs/')) return res.end(JSON.stringify({ id: 'shot-job', status: 'running', stage: 'writing-lyrics', progress: 35, provenance: { model: 'ace-step-flash' } }));
    res.statusCode = 404; return res.end('{}');
  }
  const f = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
const host = () => { const os = require('node:os'); for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === 'IPv4' && !i.internal) return i.address; return '127.0.0.1'; };

(async () => {
  await new Promise(r => server.listen(0, '0.0.0.0', r));
  const BASE = `http://${host()}:${server.address().port}`;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await c.addInitScript(base => {
    localStorage.setItem('briix-media-live-token', 'shot-key');
    localStorage.setItem('briix-media-live-server', JSON.stringify(base + '/api'));
  }, BASE);
  const p = await c.newPage();
  await p.goto(BASE + '/#/music');
  await p.waitForSelector('.music-page');
  await p.waitForFunction(() => window.BRIIX_MUSIC_LIVE?.active?.() === true, null, { timeout: 20000 });
  await p.locator('[data-music-action="kind"][data-id="song"]').click();
  await p.waitForSelector('#music-lyrics');
  await p.locator('#music-prompt').fill('Песня про любовь, ночной город и тёплый дождь');

  // 1. Набор лирики во время работы сервера.
  await p.locator('#music-generate').click();
  await p.waitForTimeout(1500);
  await p.locator('#music-lyrics').click();
  await p.locator('#music-lyrics').fill('[verse]\nГород засыпает, фонари в дождю\n[chorus]\nМы ещё успеем домой');
  await p.locator('#music-lyrics').scrollIntoViewIfNeeded();
  await p.waitForTimeout(3200);
  await p.screenshot({ path: path.join(OUT, '1-typing.png') });

  // 2. Автолирика и улучшенный промпт.
  await p.locator('#music-lyrics').fill('');
  await p.locator('#music-auto-lyrics').check();
  await p.waitForFunction(() => (document.querySelector('#music-lyrics')?.value || '').length > 100, null, { timeout: 30000 });
  await p.locator('[data-music-action="base-prompt"]').click();
  await p.waitForFunction(() => !document.querySelector('#music-prompt-source')?.hidden, null, { timeout: 30000 });
  await p.locator('#music-lyrics').scrollIntoViewIfNeeded();
  await p.waitForTimeout(6500); // тосты должны уйти, чтобы не закрывать элементы
  await p.screenshot({ path: path.join(OUT, '2-auto.png') });

  // 3. Поиск по своей базе.
  await p.locator('#music-base-browser > summary').click();
  await p.locator('#music-base-query').fill('night city rain female vocal');
  await p.waitForSelector('.music-base-card', { timeout: 20000 });
  await p.locator('#music-base-results').scrollIntoViewIfNeeded();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: path.join(OUT, '3-base.png') });

  console.log('SHOTS', OUT);
  await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
