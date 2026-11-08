/* Фаза 3, п.3: галерея сохранённых результатов стенда.
 * Реальные файлы assets/media/showcase/: карточки, плеер, текст из ©lyr, обложка из covr,
 * честная маркировка «не live», честное пустое состояние и защита манифеста.
 * Self-contained: репозиторий на 127.0.0.1:8388. Run: node tools/check-showcase.cjs
 */
const { launch, AxeBuilder } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8388;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function staticServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('#')[0].split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
      const stat = fs.statSync(file);
      const range = req.headers.range;
      // Аудио браузер тянет диапазонами — отдаём их честно, иначе плей не начнётся.
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const from = Number(m[1]), to = m[2] ? Number(m[2]) : stat.size - 1;
        res.writeHead(206, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Range': `bytes ${from}-${to}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': to - from + 1 });
        fs.createReadStream(file, { start: from, end: to }).pipe(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const srv = await staticServer(PORT);
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  const errors = [];
  const external = [];
  const contexts = [];
  async function page({ hash = '#/music', blockManifest = false, manifestMode = null, blockModule = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    contexts.push(context);
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (!r.url().startsWith(`http://127.0.0.1:${PORT}`) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
    if (blockManifest) await p.route('**/assets/media/showcase/*.json', route => route.fulfill({ status: 404, body: 'nf' }));
    if (manifestMode === '500') await p.route('**/assets/media/showcase/*.json', route => route.fulfill({ status: 500, body: 'boom' }));
    if (manifestMode === 'garbage') await p.route('**/assets/media/showcase/*.json', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>не json</html>' }));
    if (manifestMode === 'hang') await p.route('**/assets/media/showcase/*.json', async route => {
      // Ответ приходит позже клиентского таймаута — вкладка обязана показать «нет данных».
      await new Promise(r => setTimeout(r, 15000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }).catch(() => {});
    });
    if (blockModule) await p.route('**/showcase.js', route => route.fulfill({ status: 404, body: 'nf' }));
    await p.goto(`http://127.0.0.1:${PORT}/${hash}`);
    await p.waitForSelector('#main-content');
    return p;
  }
  const openGallery = async p => {
    await p.locator('[data-music-action="tab"][data-id="showcase"]').click();
    await p.waitForSelector('.showcase-card', { timeout: 15000 });
  };

  // 1. Каталог: шесть реальных треков, честная маркировка.
  let p = await page();
  await openGallery(p);
  const cards = await p.locator('.showcase-card').count();
  assert.equal(cards, 6);
  assert.match(await p.locator('.showcase-intro').innerText(), /Реальная генерация стенда \(сохранённый результат\)/);
  assert.match(await p.locator('.showcase-badge').innerText(), /Не live/);
  const firstMeta = await p.locator('.showcase-card').first().locator('.showcase-meta').innerText();
  assert.match(firstMeta, /ace-step-pro/);
  assert.match(firstMeta, /08\.11\.2026/);
  assert.match(firstMeta, /2:30/);
  ok('six saved stand tracks with honest labelling', { cards, meta: firstMeta.replace(/\s+/g, ' ') });

  // 2. Промпт и происхождение — по клику, без выдумок.
  const card = p.locator('[data-showcase-card="ballad30.m4a"]');
  await card.locator('.showcase-prompt summary').click();
  const prompt = await card.locator('.showcase-prompt').innerText();
  assert.match(prompt, /Тёплая акустическая баллада/);
  assert.match(prompt, /ace-step-flash/);
  assert.match(prompt, /ballad30\.m4a/);
  ok('prompt and provenance come from the manifest', {});

  // 3. Плеер: играет сохранённый файл, полоса идёт, черновики молчат.
  await card.locator('[data-music-action="showcase-play"]').click();
  await p.waitForFunction(() => {
    const s = window.BRIIX_MUSIC._api.showcaseState();
    return s.current === 'ballad30.m4a' && !s.paused && s.currentTime > 0.2;
  }, {}, { timeout: 20000 });
  await p.waitForFunction(() => {
    const bar = document.querySelector('[data-showcase-progress="ballad30.m4a"] span');
    return bar && parseFloat(bar.style.width) > 0;
  }, {}, { timeout: 15000 });
  const playing = await p.evaluate(() => window.BRIIX_MUSIC._api.showcaseState());
  assert.ok(playing.duration > 25 && playing.duration < 35, 'длительность из реального AAC-файла');
  ok('saved M4A plays with a moving progress bar', { duration: playing.duration, currentTime: playing.currentTime });

  // 4. Текст песни читается из тега ©lyr самого файла.
  await card.locator('[data-music-action="showcase-lyrics"]').click();
  await p.waitForFunction(() => {
    const box = document.querySelector('[data-showcase-lyrics="ballad30.m4a"]');
    return box && !box.hidden && /Тихий вечер/.test(box.textContent);
  }, {}, { timeout: 20000 });
  const lyrics = await card.locator('.showcase-lyrics').innerText();
  assert.match(lyrics, /\[verse\]/);
  assert.match(lyrics, /©lyr/);
  const tags = await p.evaluate(() => window.BRIIX_MUSIC._api.showcaseState().tags['ballad30.m4a']);
  assert.ok(tags.lyrics > 100, 'текст прочитан из файла');
  assert.equal(tags.cover, true, 'обложка прочитана из covr');
  assert.equal(await card.locator('.showcase-cover img').count(), 1);
  ok('lyrics and cover are read from the M4A itself', { lyricsChars: tags.lyrics });

  // 5. Инструментал честно говорит, что текста нет.
  const lofi = p.locator('[data-showcase-card="lofi.m4a"]');
  await lofi.locator('[data-music-action="showcase-lyrics"]').click();
  await p.waitForFunction(() => /инструментал/i.test(document.querySelector('[data-showcase-lyrics="lofi.m4a"]')?.textContent || ''), {}, { timeout: 20000 });
  ok('instrumental reports that it has no lyrics', {});

  // 6. Уход с вкладки останавливает звук.
  await p.locator('[data-music-action="tab"][data-id="create"]').click();
  await p.waitForFunction(() => window.BRIIX_MUSIC._api.showcaseState().paused, {}, { timeout: 10000 });
  assert.equal(await p.evaluate(() => window.BRIIX_MUSIC._api.showcaseState().current), null);
  ok('leaving the gallery stops playback', {});

  // 7. Манифест защищён: пути наружу и мусор не попадают в галерею.
  const guard = await p.evaluate(() => {
    const S = window.BRIIX_SHOWCASE;
    return {
      traversal: S.normalize({ file: '../../etc/passwd.m4a', title: 'x' }),
      nested: S.normalize({ file: 'sub/dir/x.m4a', title: 'x' }),
      noTitle: S.normalize({ file: 'x.m4a' }),
      exe: S.normalize({ file: 'virus.exe', title: 'x' }),
      good: !!S.normalize({ file: 'ok.m4a', title: 'Трек', model: 'm', date: '2026-11-08', duration_seconds: 30 })
    };
  });
  assert.deepEqual(guard, { traversal: null, nested: null, noTitle: null, exe: null, good: true });
  ok('manifest entries are validated', guard);
  await p.close();

  // 8. Нет каталога — честное пустое состояние, а не выдуманные треки.
  p = await page({ blockManifest: true });
  await p.locator('[data-music-action="tab"][data-id="showcase"]').click();
  await p.waitForSelector('.music-empty', { timeout: 15000 });
  const empty = await p.locator('#music-panel-content').innerText();
  assert.match(empty, /Каталог сохранённых результатов не найден|Сохранённых треков стенда ещё нет/);
  assert.equal(await p.locator('.showcase-card').count(), 0);
  ok('missing catalogue: honest empty state', {});
  await p.close();

  // 9. Изображения: галерея есть, картинок стенда нет — так и написано.
  p = await page({ hash: '#/media' });
  await p.locator('[data-media-action="tab"][data-id="showcase"]').click();
  await p.waitForSelector('.showcase-intro', { timeout: 15000 });
  const images = await p.locator('#media-panel-content').innerText();
  assert.match(images, /Реальная генерация стенда/);
  assert.match(images, /Сохранённых изображений стенда пока нет|Каталог сохранённых результатов не найден/);
  assert.match(images, /Подменять их демо-картинками мы не будем/);
  assert.equal(await p.locator('.showcase-card-image').count(), 0);
  ok('images gallery is honest about having no saved FLUX results yet', {});

  // 10. Доступность новых состояний: галерея музыки и пустая галерея изображений.
  const axe = [];
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 900 });
    const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    axe.push({ width, where: 'media-showcase', violations: r.violations.map(v => v.id) });
  }
  await p.close();
  p = await page();
  await openGallery(p);
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 900 });
    const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    axe.push({ width, where: 'music-showcase', violations: r.violations.map(v => v.id) });
  }
  for (const run of axe) assert.deepEqual(run.violations, [], 'axe: ' + run.where + ' @' + run.width);
  ok('gallery states pass axe on desktop and mobile', { runs: axe });

  // 11. Вкладка живёт при любом сбое каталога: 500, мусор вместо JSON, зависший запрос,
  // отсутствующий модуль. Именно это подозревали в CI — проверяем в обе стороны.
  const resilience = [];
  for (const scenario of [{ manifestMode: '500' }, { manifestMode: 'garbage' }, { manifestMode: 'hang' }, { blockModule: true }]) {
    const label = Object.entries(scenario).map(([k, v]) => k + '=' + v).join(',');
    for (const [hash, action, tabId] of [['#/music', 'music', 'music-tab-showcase'], ['#/media', 'media', 'media-tab-showcase']]) {
      const rp = await page({ hash, ...scenario });
      await rp.waitForSelector('.' + action + '-page');
      const tab = rp.locator('#' + tabId);
      assert.equal(await tab.count(), 1, label + ': вкладка ' + tabId + ' должна быть в DOM всегда');
      await tab.click({ timeout: 10000 });
      assert.equal(await tab.getAttribute('aria-selected'), 'true', label + ': вкладка выбирается');
      const text = await rp.locator('#' + action + '-panel-content').innerText();
      assert.ok(text.length > 20, label + ': вкладка показывает содержимое, а не пустоту');
      if (scenario.blockModule) assert.match(text, /не загрузился|не подключена/i);
      else assert.ok(!/Читаем каталог/.test(text), label + ': вечного «Читаем каталог» быть не должно');
      resilience.push({ scenario: label, section: action, chars: text.length });
      await rp.close();
    }
  }
  ok('gallery tab survives every catalogue failure', { cases: resilience.length });

  assert.deepEqual(external, [], 'никаких внешних запросов');
  assert.deepEqual(errors, [], 'page errors');
  ok('no external requests and no page errors', {});
  console.log('DONE', results.length, 'checks');
  for (const c of contexts) await c.close();
  await browser.close();
  srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
