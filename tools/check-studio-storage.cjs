/* Integrated storage migration and failure checks in a browser; no live server. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./browser-env.cjs');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const server = http.createServer((req, res) => {
    let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launch();
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get() { return null; } });
      localStorage.setItem('briix-studio-user', 'fallback');
      localStorage.setItem('briix-studio-profiles', JSON.stringify({ fallback: { pinHash: 'x' } }));
      localStorage.setItem('briix-media-live-token', 'test-token');
      if (!localStorage.getItem('briix-studio-feed-fallback')) localStorage.setItem('briix-studio-feed-fallback', JSON.stringify([{ t: 'user', who: 'Вы', text: 'Старый текст' }]));
    });
    await page.goto(origin + '/studio/');
    await page.waitForSelector('#storageWarning:not([hidden])');
    assert.match(await page.locator('#storageWarning').innerText(), /localStorage/);
    await page.getByText('Старый текст').waitFor();
    await page.locator('#newChat').click();
    await page.waitForFunction(() => document.querySelectorAll('.session-feed:not([hidden]) .card').length === 0);
    await page.locator('#sessionsOpen').click();
    await page.locator('.session-item').filter({ hasText: 'Старый текст' }).click();
    await page.locator('#feed .session-feed:not([hidden])').getByText('Старый текст').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => localStorage.getItem('briix-studio-sessions-backend-fallback')), 'local');
    assert.match(await page.evaluate(() => localStorage.getItem('briix-studio-feed-fallback')), /Старый текст/);
    await context.close();

    const blocked = await browser.newContext();
    const p = await blocked.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      localStorage.setItem('briix-studio-user', 'quota');
      localStorage.setItem('briix-studio-profiles', JSON.stringify({ quota: { pinHash: 'x' } }));
      localStorage.setItem('briix-media-live-token', 'test-token');
      localStorage.setItem('briix-studio-feed-quota', JSON.stringify([{ t: 'user', text: 'Беречь' }]));
      IDBObjectStore.prototype.add = function () { throw new DOMException('full', 'QuotaExceededError'); };
    });
    await p.goto(origin + '/studio/');
    await p.waitForSelector('#storageWarning:not([hidden])');
    assert.match(await p.locator('#storageWarning').innerText(), /Не удалось открыть сессии/);
    assert.match(await p.evaluate(() => localStorage.getItem('briix-studio-feed-quota')), /Беречь/);
    await p.locator('#prompt').fill('Не потерять');
    assert.equal(await p.locator('#send').isDisabled(), true);
    await blocked.close();
    assert.deepEqual(errors, []);
    console.log('PASS integrated fallback and failed migration preserve source, with visible warning');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
