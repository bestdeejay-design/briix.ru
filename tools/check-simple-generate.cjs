/* Простой вход в генерацию: одна фраза -> результат, без открытого раздела и без формы.
 * На этом стоит мобильный «чат + лента»: человек пишет, а не заполняет анкету.
 */
const { launch, OUT } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BRIIX_URL || 'http://127.0.0.1:8320';

(async () => {
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Именно чат: разделы «Музыка» и «Изображения» ни разу не открывались.
  await page.goto(BASE + '/#/chat/example-coffee');
  await page.waitForSelector('#prompt-input');

  assert.equal(await page.evaluate(() => typeof window.BRIIX_MUSIC?.generate), 'function', 'нет простого входа в музыку');
  assert.equal(await page.evaluate(() => typeof window.BRIIX_MEDIA?.generate), 'function', 'нет простого входа в картинки');
  ok('generators expose a form-free entry point');

  // Короткая фраза отсекается так же, как в форме.
  const short = await page.evaluate(() => window.BRIIX_MUSIC.generate({ prompt: 'мало' }));
  assert.ok(short.error, 'короткий бриф должен отсеиваться');
  ok('short brief is rejected without a form', { error: short.error.slice(0, 40) });

  // Инструментал: одна фраза, никаких жанров и BPM.
  const music = await page.evaluate(() => window.BRIIX_MUSIC.generate({ prompt: 'Спокойная музыка для вечерней работы', kind: 'instrumental' }));
  assert.ok(music.id, 'задача не создана: ' + JSON.stringify(music));
  await page.waitForFunction(id => window.BRIIX_MUSIC.track(id)?.status === 'ready', music.id, { timeout: 30000 });
  const track = await page.evaluate(id => window.BRIIX_MUSIC.track(id), music.id);
  const url = await page.evaluate(id => window.BRIIX_MUSIC.audioUrl(id), music.id);
  assert.ok(url && url.startsWith('blob:'), 'звук не отдан');
  assert.ok(track.bpm >= 60 && track.bpm <= 160, 'темп не подобран сам');
  ok('one phrase produces a playable instrumental with smart defaults', { mode: music.mode, bpm: track.bpm, genre: track.genre, duration: track.duration });

  // Картинка: то же самое.
  const media = await page.evaluate(() => window.BRIIX_MEDIA.generate({ prompt: 'Тёплый вечерний свет в комнате, мягкие тени' }));
  assert.ok(media.id, 'картинка не создана: ' + JSON.stringify(media));
  await page.waitForFunction(id => window.BRIIX_MEDIA.job(id)?.status === 'ready', media.id, { timeout: 30000 });
  const imgUrl = await page.evaluate(id => window.BRIIX_MEDIA.resultUrl(id), media.id);
  assert.ok(imgUrl, 'картинка не отдана');
  ok('one phrase produces a viewable image', { mode: media.mode, url: imgUrl.slice(0, 40) });

  // Песня без лирики честно отказывает — автолирику подставляет чат, а не генератор.
  const song = await page.evaluate(() => window.BRIIX_MUSIC.generate({ prompt: 'Песня про ночной город и дождь', kind: 'song' }));
  assert.ok(song.id, 'в моке песня должна собираться как минусовка');
  ok('song brief accepted in demo mode', { mode: song.mode });

  // Результаты легли в общие библиотеки — ничего не потеряно.
  const stored = await page.evaluate(() => ({
    tracks: (JSON.parse(localStorage.getItem('briix-music-v1') || '{}').tracks || []).length,
    jobs: (JSON.parse(localStorage.getItem('briix-media-v1') || '{}').jobs || []).length
  }));
  assert.ok(stored.tracks >= 2 && stored.jobs >= 1, 'результаты не сохранились: ' + JSON.stringify(stored));
  ok('results land in the shared libraries', stored);

  // Разделы после этого открываются нормально и видят те же результаты.
  await page.goto(BASE + '/#/music');
  await page.waitForSelector('.music-page');
  await page.locator('.music-tab[data-id="library"]').click();
  await page.waitForTimeout(400);
  const cards = await page.locator('#music-panel [data-music-row], #music-panel .music-track-card, #music-panel article').count();
  assert.ok(cards > 0, 'библиотека не показывает созданное из чата');
  ok('music section sees what the chat created', { cards });

  assert.deepEqual(errors, [], 'ошибки страницы: ' + errors.join('; '));
  ok('no page errors');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'briix-simple-generate.json'), JSON.stringify({ passed: results.length, results }, null, 2));
  console.log('DONE', results.length, 'checks');
  await browser.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
