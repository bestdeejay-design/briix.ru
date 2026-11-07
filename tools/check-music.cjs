/* Developer-only browser checks for the Music studio. The static site never loads this file.
 * Run: BRIIX_URL=http://127.0.0.1:3000 node tools/check-music.cjs
 */
const { launch, AxeBuilder, BASE_URL, OUT } = require('./browser-env.cjs');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const KEY = 'briix-music-v1';
const read = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)) || { tracks: [] }, KEY);
const waitReady = (p, id) => p.waitForFunction(({ k, id }) => JSON.parse(localStorage.getItem(k))?.tracks.find(t => t.id === id)?.status === 'ready', { k: KEY, id }, { timeout: 30000 });
const BRIEF = 'Спокойная подложка для минутного видео о керамической мастерской, тёплое настроение.';
(async () => {
  const b = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  await c.newPage();
  const p = c.pages()[0];
  const errors = [];
  const external = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  p.on('request', r => { const u = r.url(); if (!u.startsWith(BASE_URL) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });

  // Navigation: renamed images section, new music section, legacy and alias routes.
  await p.goto(`${BASE_URL}/#/home`);
  await p.waitForSelector('.home');
  const nav = await p.locator('.nav-list a.nav-item > span:first-of-type').allTextContents();
  assert.ok(nav.includes('Изображения') && nav.includes('Музыка'), nav.join(','));
  assert.equal(await p.locator('.studio-link').count(), 2);
  await p.locator('.studio-link[href="#/music"]').click();
  await p.waitForSelector('.music-page');
  assert.equal(await p.locator('.breadcrumb-current').textContent(), 'Музыка');
  for (const [route, sel] of [['images', '.media-page'], ['media', '.media-page'], ['music', '.music-page']]) {
    await p.goto(`${BASE_URL}/#/` + route); await p.waitForSelector(sel);
  }
  ok('navigation, images rename and #/images alias', { nav });

  // Theme toggle must not leave the music route.
  await p.locator('[data-action="toggle-theme"]').click();
  assert.ok(p.url().endsWith('#/music'));
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await p.locator('[data-action="toggle-theme"]').click();
  ok('theme toggle stays on music route');

  // Brief validation.
  await p.locator('#music-prompt').fill('коротко');
  await p.locator('#music-generate').click();
  assert.equal(await p.locator('#music-prompt').getAttribute('aria-invalid'), 'true');
  assert.equal((await read(p)).tracks.length, 0);
  ok('short brief rejected');

  // Kind switch: vocal honesty and defaults; genre drives BPM.
  await p.locator('[data-music-action="kind"][data-id="song"]').click();
  assert.match(await p.locator('#music-kind-hint').textContent(), /минусовка .*Вокал и текст появятся только на live-модели/);
  await p.locator('#music-genre').selectOption('electronic');
  assert.equal(await p.locator('#music-bpm-value').textContent(), '116');
  await p.locator('[data-music-action="kind"][data-id="instrumental"]').click();
  await p.locator('#music-genre').selectOption('lofi');
  await p.locator('#music-mood').selectOption('calm');
  assert.equal(await p.locator('#music-bpm-value').textContent(), '74');
  ok('kind defaults and genre/mood BPM suggestion');

  // Instrumental: queue, real local synthesis, waveform.
  await p.locator('#music-project').fill('Мастерская <b>глины</b>');
  await p.locator('#music-prompt').fill(BRIEF);
  await p.locator('#music-generate').click();
  let s = await read(p);
  const first = s.tracks[0];
  assert.equal(first.status, 'queued');
  assert.equal(first.kind, 'instrumental');
  await waitReady(p, first.id);
  await p.waitForSelector('#music-wave .music-wave-bars span');
  assert.equal(await p.locator('#music-wave .music-wave-bars span').count(), 256);
  assert.equal(await p.locator('.music-preview-head h2 b').count(), 0);
  assert.match(await p.locator('.music-mock-badge').textContent(), /Мок/);
  ok('instrumental synthesis and escaped project', { id: first.id, seed: first.seed });

  // Playback advances, seek works, pause resets.
  await p.locator('[data-music-action="play"]').click();
  await p.waitForFunction(() => document.querySelector('#music-audio').currentTime > 0.4, {}, { timeout: 10000 });
  const played = await p.evaluate(() => { const a = document.querySelector('#music-audio'); return { time: a.currentTime, duration: a.duration, paused: a.paused }; });
  assert.equal(played.duration, 20);
  await p.waitForFunction(() => document.querySelector('#music-time-current').textContent !== '0:00', {}, { timeout: 10000 });
  assert.notEqual(await p.locator('#music-time-current').textContent(), '0:00');
  await p.locator('#music-seek').fill('12');
  await p.waitForFunction(() => Math.abs(document.querySelector('#music-audio').currentTime - 12) < 1.5);
  await p.locator('[data-music-action="play"]').click();
  assert.equal(await p.evaluate(() => document.querySelector('#music-audio').paused), true);
  ok('playback, seek and pause', played);

  // Deterministic WAV download: header, sample rate and duration.
  const dl = p.waitForEvent('download');
  await p.locator('[data-music-action="download"]').click();
  const d = await dl;
  const file = path.join(OUT, 'briix-music-download.wav');
  await d.saveAs(file);
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.readUInt32LE(24), 32000);
  assert.equal(buf.readUInt32LE(40) / 64000, 20);
  assert.ok(buf.length > 1000000);
  assert.match(d.suggestedFilename(), /^briix-music-[a-z0-9-]+-\d+bpm\.wav$/);
  ok('WAV download', { name: d.suggestedFilename(), bytes: buf.length });

  // Vocal task: backing track only, explicit no-vocals notice.
  await p.locator('[data-music-action="kind"][data-id="song"]').click();
  await p.locator('#music-prompt').fill('Песня о небольшом деле, которое выросло из домашнего хобби, тёплое настроение.');
  await p.locator('#music-generate').click();
  s = await read(p);
  const song = s.tracks[0];
  await waitReady(p, song.id);
  assert.match(await p.locator('.music-vocal-note').textContent(), /Это минусовка/);
  assert.match(await p.locator('.music-structure').textContent(), /Припев/);
  ok('vocal task returns backing track with structure', { id: song.id });

  // Jingle kind and duration switch.
  await p.locator('[data-music-action="kind"][data-id="jingle"]').click();
  await p.locator('[data-music-action="duration"][data-id="10"]').click();
  await p.locator('#music-prompt').fill('Короткая тёплая заставка для подкаста о городских прогулках.');
  await p.locator('#music-generate').click();
  s = await read(p);
  const jingle = s.tracks[0];
  assert.equal(jingle.duration, 10);
  await waitReady(p, jingle.id);
  assert.equal(await p.locator('#music-time-total').textContent(), '0:10');
  ok('jingle duration', { id: jingle.id });

  // Library: filters, search, favorite, reuse.
  await p.locator('[data-music-action="tab"][data-id="library"]').click();
  assert.equal(await p.locator('.music-library-card').count(), 3);
  await p.locator('[data-music-action="library-filter"][data-id="song"]').click();
  assert.equal(await p.locator('.music-library-card').count(), 1);
  await p.locator('[data-music-action="favorite"]').first().click();
  await p.locator('[data-music-action="library-filter"][data-id="favorite"]').click();
  assert.equal(await p.locator('.music-library-card').count(), 1);
  await p.locator('[data-music-action="reset-filter"]').count().then(async n => { if (!n) await p.locator('[data-music-action="library-filter"][data-id="all"]').click(); });
  await p.locator('#music-library-search').fill('несуществующий запрос');
  assert.equal(await p.locator('.music-library-card').count(), 0);
  await p.locator('[data-music-action="reset-filter"]').click();
  assert.equal(await p.locator('.music-library-card').count(), 3);
  await p.locator('[data-music-action="reuse"]').first().click();
  assert.equal(await p.locator('#music-brief-form').count(), 1);
  ok('library filters, search, favorite and reuse');

  // Brief export.
  await p.locator('[data-music-action="tab"][data-id="library"]').click();
  const ex = p.waitForEvent('download');
  await p.locator('[data-music-action="export"]').click();
  const exp = await ex;
  const expPath = path.join(OUT, 'briix-music-export.json');
  await exp.saveAs(expPath);
  const exported = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  assert.equal(exported.tracks.length, 3);
  assert.match(exported.notice, /No model inference, no vocals/);
  ok('brief export');

  // Delete requires confirmation.
  await p.locator('[data-music-action="delete"]').first().click();
  await p.waitForSelector('#modal[open]');
  await p.locator('#modal [data-modal-action="1"]').click();
  assert.equal((await read(p)).tracks.length, 2);
  ok('delete confirmation');

  // Simulated error, retry, cancel.
  await p.locator('[data-music-action="tab"][data-id="create"]').click();
  await p.locator('.music-extra summary').click();
  await p.locator('#music-fail').check();
  await p.locator('#music-prompt').fill(BRIEF);
  await p.locator('#music-generate').click();
  s = await read(p);
  const failed = s.tracks[0];
  await p.waitForFunction(({ k, id }) => JSON.parse(localStorage.getItem(k)).tracks.find(t => t.id === id)?.status === 'error', { k: KEY, id: failed.id }, { timeout: 15000 });
  await p.locator('[data-music-action="tab"][data-id="queue"]').click();
  await p.locator(`[data-music-action="retry"][data-id="${failed.id}"]`).click();
  await waitReady(p, failed.id);
  ok('simulated error and retry');
  await p.locator('[data-music-action="tab"][data-id="create"]').click();
  await p.locator('#music-generate').click();
  s = await read(p);
  const cancelled = s.tracks[0];
  await p.locator('[data-music-action="tab"][data-id="queue"]').click();
  await p.locator(`[data-music-action="cancel"][data-id="${cancelled.id}"]`).click();
  assert.equal((await read(p)).tracks.find(t => t.id === cancelled.id).status, 'cancelled');
  ok('cancel');

  // Reload recovery: a running job returns to the queue and finishes.
  await p.locator('[data-music-action="tab"][data-id="create"]').click();
  await p.locator('#music-generate').click();
  s = await read(p);
  const reloaded = s.tracks[0];
  await p.waitForTimeout(300);
  await p.reload();
  await p.waitForSelector('.music-page');
  assert.equal((await read(p)).tracks.find(t => t.id === reloaded.id).status, 'queued');
  await waitReady(p, reloaded.id);
  ok('running job recovered after reload');

  // Accessibility of the populated player in both themes.
  await p.locator('[data-music-action="tab"][data-id="create"]').click();
  await p.waitForSelector('#music-wave .music-wave-bars span');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await p.locator('[data-action="toggle-theme"]').click();
    const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(r.violations.map(v => v.id), [], 'music player ' + theme);
  }
  await p.locator('[data-action="toggle-theme"]').click();
  ok('axe clean in light and dark');

  // Keyboard tabs.
  await p.locator('#music-tab-create').focus();
  await p.keyboard.press('ArrowRight');
  assert.equal(await p.locator('#music-tab-library').getAttribute('aria-selected'), 'true');
  await p.keyboard.press('Home');
  assert.equal(await p.locator('#music-tab-create').getAttribute('aria-selected'), 'true');
  ok('tablist keyboard navigation');

  // Global search reaches the music studio.
  await p.locator('.nav-item[data-action="search"]').click();
  await p.waitForSelector('#search-modal[open]');
  await p.locator('#global-search').fill('музыка');
  await p.locator('[data-action="search-music"]').click();
  await p.waitForSelector('.music-page');
  ok('global search music');

  // Music assistant and prompt category.
  await p.goto(`${BASE_URL}/#/assistants`);
  await p.waitForSelector('.assistant-grid');
  await p.locator('#assistant-search').fill('Музыкальный');
  assert.equal(await p.locator('.assistant-card').count(), 1);
  await p.locator('[data-action="start-assistant"]').click();
  await p.waitForSelector('.home');
  await p.goto(`${BASE_URL}/#/prompts`);
  await p.waitForSelector('.prompt-grid');
  await p.locator('[data-action="filter-prompts"][data-id="Музыка"]').click();
  assert.equal(await p.locator('.prompt-card').count(), 3);
  await p.locator('[data-action="use-prompt"]').first().click();
  await p.waitForSelector('.home');
  await p.locator('#send-button').click();
  await p.waitForSelector('.chat-page');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('briix-workspace-v2')).chats[0].messages.some(m => m.role === 'assistant' && m.status === 'complete'), {}, { timeout: 20000 });
  const answer = await p.evaluate(() => JSON.parse(localStorage.getItem('briix-workspace-v2')).chats[0].messages.at(-1).content);
  assert.match(answer, /Вокал и текст песни не генерируются|минусовка/);
  ok('music assistant, prompt category and scripted answer');

  // Capacity guard.
  const c3 = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await c3.newPage();
  const p3 = c3.pages()[0];
  await p3.addInitScript(k => {
    const tracks = Array.from({ length: 24 }, (_, i) => ({ id: 'seed-' + i, kind: 'instrumental', genre: 'lofi', mood: 'calm', key: 'am', goal: 'social', duration: 10, bpm: 80, project: 'seed ' + i, prompt: 'Seed brief number ' + i, status: 'ready', progress: 100, favorite: true, seed: i, createdAt: Date.now() }));
    localStorage.setItem(k, JSON.stringify({ version: 1, tracks }));
  }, KEY);
  await p3.goto(`${BASE_URL}/#/music`);
  await p3.waitForSelector('.music-page');
  assert.equal((await read(p3)).tracks.length, 24);
  await p3.locator('#music-prompt').fill(BRIEF);
  await p3.locator('#music-generate').click();
  await p3.waitForFunction(() => document.querySelector('#toasts')?.textContent.includes('24 черновика'));
  assert.equal((await read(p3)).tracks.length, 24);
  assert.equal(await p3.locator('.music-library-card').count(), 0);
  await p3.locator('[data-music-action="tab"][data-id="library"]').click();
  assert.equal(await p3.locator('.music-library-card').count(), 24);
  ok('library capacity guard keeps favorites', { tracks: 24 });
  await c3.close();

  // Corrupt storage is protected until an explicit clear.
  const c4 = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await c4.newPage();
  const p4 = c4.pages()[0];
  await p4.addInitScript(k => localStorage.setItem(k, '{corrupt'), KEY);
  await p4.goto(`${BASE_URL}/#/music`);
  await p4.waitForSelector('.music-page');
  assert.equal(await p4.locator('#music-storage-notice').isVisible(), true);
  await p4.locator('#music-prompt').fill(BRIEF);
  await p4.locator('#music-generate').click();
  await p4.waitForFunction(() => document.querySelector('.music-player-card') !== null, {}, { timeout: 30000 });
  assert.equal(await p4.evaluate(k => localStorage.getItem(k), KEY), '{corrupt');
  await p4.locator('[data-music-action="tab"][data-id="library"]').click();
  await p4.locator('[data-music-action="clear"]').click();
  await p4.locator('#modal [data-modal-action="2"]').click();
  assert.equal((await read(p4)).tracks.length, 0);
  ok('corrupt storage protected until explicit clear');
  await c4.close();

  // Mobile: hamburger navigation, no horizontal overflow.
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await c2.newPage();
  const p2 = c2.pages()[0];
  await p2.goto(`${BASE_URL}/#/home`);
  await p2.waitForSelector('.home');
  await p2.locator('[data-action="toggle-sidebar"]').click();
  await p2.locator('.nav-item[href="#/music"]').click();
  await p2.waitForSelector('.music-page');
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, 'horizontal overflow ' + overflow);
  await p2.locator('#music-prompt').fill(BRIEF);
  await p2.locator('#music-generate').click();
  await p2.waitForFunction(() => JSON.parse(localStorage.getItem('briix-music-v1')).tracks[0].status === 'ready', {}, { timeout: 30000 });
  await p2.screenshot({ path: path.join(OUT, 'briix-music-mobile.png'), fullPage: true });
  ok('mobile navigation and layout', { overflow });
  await c2.close();

  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(external, [], 'external requests');
  ok('no page errors and no external requests');
  await p.screenshot({ path: path.join(OUT, 'briix-music-desktop.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'briix-music-results.json'), JSON.stringify({ passed: results.length, results }, null, 2));
  console.log('TOTAL PASS', results.length);
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
