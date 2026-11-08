/* Чистый мобильный сценарий: Фото / Видео / Аудио → профильный помощник → подсказка → результат. */
const { launch, AxeBuilder, BASE_URL, OUT } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const results = [];
  const errors = [];
  const external = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const raw = r.url(); if (raw.startsWith('blob:' + BASE_URL)) return; const u = new URL(raw); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) external.push(raw); });
  fs.mkdirSync(OUT, { recursive: true });

  await page.goto(BASE_URL + '/#/home');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.mobile-media-switch');

  const labels = await page.locator('.mobile-media-option').allInnerTexts();
  assert.deepEqual(labels.map(x => x.trim()), ['Фото', 'Видео', 'Аудио', 'Текст']);
  const clutter = await page.evaluate(() => Object.fromEntries(['.assistant-strip', '.studio-links', '.home-bottom', '.home > .live-mode-banner', '.home .mode-select', '.home [data-action="attach"]'].map(selector => {
    const el = document.querySelector(selector); return [selector, el ? getComputedStyle(el).display : 'missing'];
  })));
  assert.ok(Object.values(clutter).every(display => display === 'none' || display === 'missing'), JSON.stringify(clutter));
  ok('mobile home has only media types, assistant, brief and hints', clutter);

  async function checkLayout(name) {
    const metrics = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const small = [...document.querySelectorAll('.home button, .home a[href]')].filter(el => el.getClientRects().length).map(el => {
        const b = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 50), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) };
      }).filter(b => b.w < 40 || b.h < 40 || b.right > width + 1);
      return { overflow: document.documentElement.scrollWidth - width, small };
    });
    assert.ok(metrics.overflow <= 1, name + ': horizontal overflow');
    assert.deepEqual(metrics.small, [], name + ': small/clipped controls');
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map(v => v.id), [], name + ': axe');
    ok('layout and axe: ' + name, metrics);
  }

  await page.locator('.mobile-media-option[data-id="image"]').click();
  assert.match(await page.locator('[data-action="choose-assistant"]').innerText(), /Визуальный дизайнер/);
  assert.equal(await page.locator('.quick-card').count(), 3);
  await page.locator('.quick-card').first().click();
  assert.match(await page.locator('#prompt-input').inputValue(), /керамической чашки/);
  await checkLayout('photo');
  await page.screenshot({ path: path.join(OUT, 'mobile-creator-photo.png'), fullPage: true });
  await page.locator('#send-button').click();
  await page.waitForSelector('.gen-image', { timeout: 40000 });
  assert.match(await page.locator('.gen-image').getAttribute('src'), /assets\/media\/ceramic-still\.jpg$/);
  ok('photo selects visual assistant, fills a brief and creates an image');

  await page.goto(BASE_URL + '/#/home');
  await page.waitForSelector('.mobile-media-switch');
  await page.locator('.mobile-media-option[data-id="video"]').click();
  assert.match(await page.locator('[data-action="choose-assistant"]').innerText(), /Видеограф/);
  assert.match(await page.locator('#prompt-input').getAttribute('placeholder'), /движение камеры/);
  await checkLayout('video');
  await page.screenshot({ path: path.join(OUT, 'mobile-creator-video.png'), fullPage: true });
  await page.locator('#prompt-input').fill('Пятисекундное видео керамической чашки, камера медленно приближается, мягкий свет');
  await page.locator('#send-button').click();
  await page.waitForSelector('.gen-video', { timeout: 40000 });
  const video = await page.locator('.gen-video').evaluate(async el => {
    if (el.readyState < 1) await new Promise(resolve => el.addEventListener('loadedmetadata', resolve, { once: true }));
    return { src: el.currentSrc, duration: el.duration, width: el.videoWidth, height: el.videoHeight };
  });
  assert.equal(video.duration, 5);
  assert.equal(video.width, 1280);
  assert.equal(video.height, 720);
  assert.match(video.src, /\.mp4$/);
  await page.reload();
  await page.waitForSelector('.gen-video', { timeout: 15000 });
  ok('video is a real local MP4 and survives reload', video);
  await page.screenshot({ path: path.join(OUT, 'mobile-creator-video-result.png'), fullPage: true });
  const liveVideo = await page.evaluate(async () => {
    const live = window.BRIIX_MEDIA_LIVE;
    const active = live.active, submit = live.submit;
    let submissions = 0;
    live.active = () => true;
    live.submit = async () => { submissions += 1; };
    const result = await window.BRIIX_MEDIA.generate({ type: 'video', prompt: 'Проверка честного отказа live-видео без подмены картинкой' });
    live.active = active; live.submit = submit;
    return { result, submissions };
  });
  assert.match(liveVideo.result.error, /Live-видео пока не подключено/);
  assert.equal(liveVideo.submissions, 0);
  ok('live video refuses honestly instead of submitting an image', liveVideo);

  await page.goto(BASE_URL + '/#/home');
  await page.waitForSelector('.mobile-media-switch');
  await page.locator('.mobile-media-option[data-id="music"]').click();
  await page.waitForFunction(() => document.querySelector('.quick-heading')?.textContent.includes('8 202'), null, { timeout: 15000 });
  assert.match(await page.locator('[data-action="choose-assistant"]').innerText(), /Музыкальный продюсер/);
  assert.equal(await page.locator('.quick-card').count(), 3);
  await checkLayout('audio');
  await page.screenshot({ path: path.join(OUT, 'mobile-creator-audio.png'), fullPage: true });
  ok('audio loads three owner-base suggestions lazily', { heading: await page.locator('.quick-heading').innerText() });

  await page.locator('[data-action="choose-assistant"]').click();
  const audioAssistants = await page.locator('.assistant-option').allInnerTexts();
  assert.equal(audioAssistants.length, 2);
  assert.ok(audioAssistants.some(x => /Автор песни/.test(x)));
  await page.locator('[data-action="modal-select-assistant"][data-id="songwriter"]').click();
  await page.waitForSelector('.mobile-media-option[data-id="song"][aria-pressed="true"]');
  assert.match(await page.locator('#prompt-input').getAttribute('placeholder'), /Лирику подберу/);
  ok('audio assistant choice separates producer and songwriter', { audioAssistants });

  await page.evaluate(() => {
    window.__mobileMusicBriefs = [];
    const original = window.BRIIX_MUSIC.generate;
    window.BRIIX_MUSIC.generate = async params => { window.__mobileMusicBriefs.push(params); return original(params); };
  });
  await page.locator('#prompt-input').fill('Песня на русском о ночном городе и тёплом дожде, спокойный куплет и светлый припев');
  await page.locator('#send-button').click();
  await page.waitForSelector('.gen-audio', { timeout: 50000 });
  const brief = await page.evaluate(() => window.__mobileMusicBriefs.at(-1));
  assert.equal(brief.kind, 'song');
  assert.equal(brief.language, 'ru');
  assert.ok(brief.lyrics.length >= 200, 'lyrics were not loaded from DJ1');
  const generation = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('briix-workspace-v2')).generations).at(-1));
  assert.equal(generation.kind, 'song');
  ok('song receives Russian lyrics from the owner base', { lyricsLength: brief.lyrics.length, generation });

  await page.goto(BASE_URL + '/#/assistants');
  await page.locator('#assistant-search').fill('Видеограф');
  await page.locator('[data-action="start-assistant"][data-id="director"]').click();
  await page.waitForSelector('.mobile-media-option[data-id="video"][aria-pressed="true"]');
  assert.match(await page.locator('[data-action="choose-assistant"]').innerText(), /Видеограф/);
  ok('catalog entry opens the matching mobile media mode');

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const wide = await desktop.newPage();
  await wide.goto(BASE_URL + '/#/home');
  await wide.waitForSelector('.assistant-strip');
  assert.equal(await wide.locator('.mobile-media-switch').count(), 0);
  assert.equal(await wide.locator('.studio-links').isVisible(), true);
  ok('desktop home remains unchanged');
  await desktop.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  ok('no page errors or external requests');
  fs.writeFileSync(path.join(OUT, 'briix-mobile-creator.json'), JSON.stringify({ passed: results.length, results, errors, external }, null, 2));
  console.log('DONE', results.length, 'checks');
  await browser.close();
})().catch(e => { console.error('FAIL', e.stack || e); process.exit(1); });
