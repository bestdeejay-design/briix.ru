/* Простой мобильный чат: пишешь фразу — получаешь результат в ленте.
 * Под полем только помощник и «что делаем». Анкеты — в отдельном интерфейсе.
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

  await page.goto(BASE + '/#/chat/example-coffee');
  await page.waitForSelector('#prompt-input');

  // Под полем ровно два выбора: помощник и что делаем.
  const chip = page.locator('[data-action="choose-mode"]');
  assert.equal(await chip.isVisible(), true, 'на телефоне нет выбора «что делаем»');
  assert.equal(await page.locator('[data-action="choose-assistant"]').isVisible(), true);
  const clutter = await page.evaluate(() => ({
    hint: getComputedStyle(document.querySelector('.keyboard-hint')).display,
    example: getComputedStyle(document.querySelector('[data-action="attach-example"]')).display
  }));
  assert.equal(clutter.hint, 'none', 'подсказка про Enter мешает на телефоне');
  assert.equal(clutter.example, 'none', 'лишняя кнопка примера вложения');
  ok('composer shows only assistant and what-to-make', clutter);

  await chip.click();
  await page.waitForSelector('#mode-menu:not([hidden])');
  const options = await page.locator('.mode-option').allInnerTexts();
  assert.equal(options.length, 5, 'ожидались текст, фото, видео, музыка и песня');
  assert.match(await page.locator('.mode-advanced').innerText(), /Все настройки подробно/);
  ok('mode menu offers five plain choices and a way to full settings', { options: options.map(t => t.split('\n')[0]) });

  // Картинка: одна фраза — результат в ленте, без ухода в раздел.
  await page.locator('.mode-option[data-id="image"]').click();
  assert.match(await chip.innerText(), /Картинка/);
  await page.locator('#prompt-input').fill('Тёплый вечерний свет в комнате, мягкие тени');
  await page.locator('#send-button').click();
  await page.waitForSelector('.gen-card', { timeout: 15000 });
  assert.ok(page.url().includes('#/chat/'), 'ушли из чата вместо результата в ленте');
  await page.waitForSelector('.gen-image', { timeout: 30000 });
  const visible = await page.evaluate(() => {
    const card = document.querySelector('.gen-card');
    const r = card.getBoundingClientRect();
    const composer = document.querySelector('.chat-composer-wrap').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, composerTop: Math.round(composer.top) };
  });
  assert.ok(visible.top < visible.vh && visible.top >= 0, 'результат остался за экраном: ' + JSON.stringify(visible));
  ok('result is brought into view right after sending', visible);
  const imgSrc = await page.locator('.gen-image').getAttribute('src');
  assert.ok(imgSrc && imgSrc.length > 5, 'картинка не показана');
  assert.match(await page.locator('.gen-card .badge').last().innerText(), /мок|сервер/i);
  ok('image lands in the chat feed with an honest source badge', { src: imgSrc.slice(0, 34) });

  // Музыка: то же самое, звук прямо в ленте.
  await chip.click();
  await page.locator('.mode-option[data-id="music"]').click();
  await page.locator('#prompt-input').fill('Спокойная музыка для вечерней работы');
  await page.locator('#send-button').click();
  await page.waitForSelector('.gen-audio', { timeout: 40000 });
  const audioSrc = await page.locator('.gen-audio').last().getAttribute('src');
  assert.ok(audioSrc.startsWith('blob:'), 'звук не отдан в ленту');
  ok('music plays inside the feed', { src: audioSrc.slice(0, 20) });

  // Песня: лирику человек не пишет — она подбирается из его базы.
  await chip.click();
  await page.locator('.mode-option[data-id="song"]').click();
  assert.match(await page.locator('#prompt-input').getAttribute('placeholder'), /Лирику подберу/);
  await page.locator('#prompt-input').fill('Песня про ночной город и тёплый дождь');
  await page.locator('#send-button').click();
  await page.waitForTimeout(2500);
  const cards = await page.locator('.gen-card').count();
  assert.ok(cards >= 3, 'результаты не копятся в ленте: ' + cards);
  ok('song can be requested with one phrase', { cards });

  // Ссылка «настроить подробно» ведёт в полный интерфейс, а не в тупик.
  const href = await page.locator('.gen-foot .text-btn').last().getAttribute('href');
  assert.equal(href, '#/music');
  ok('advanced settings stay one tap away', { href });

  // Режим переживает перезагрузку.
  await page.reload();
  await page.waitForSelector('#prompt-input');
  assert.match(await page.locator('[data-action="choose-mode"]').innerText(), /Песня/);
  assert.ok(await page.locator('.gen-card').count() >= 3, 'результаты пропали после перезагрузки');
  ok('mode and results survive a reload');

  // Веб не тронут: на широком экране чипа нет.
  const wide = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const desktop = await wide.newPage();
  await desktop.goto(BASE + '/#/chat/example-coffee');
  await desktop.waitForSelector('#prompt-input');
  assert.equal(await desktop.locator('[data-action="choose-mode"]').isVisible(), false, 'на вебе появился новый чип');
  ok('desktop interface is untouched');
  await wide.close();

  assert.deepEqual(errors, [], 'ошибки страницы: ' + errors.join('; '));
  ok('no page errors');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'briix-simple-chat.json'), JSON.stringify({ passed: results.length, results }, null, 2));
  console.log('DONE', results.length, 'checks');
  await browser.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
