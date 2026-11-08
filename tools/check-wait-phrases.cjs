/* Фаза 3, п.4: живое ожидание.
 * Пулы, привязка к стадии, анти-повтор ≥15, интервал 4–6 с, уменьшенное движение,
 * честные зоны мока и отсутствие «живых» фраз в сценарном чате.
 * Self-contained: репозиторий на 127.0.0.1:8388. Run: node tools/check-wait-phrases.cjs
 */
const { launch } = require('./browser-env.cjs');
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
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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
  const contexts = [];
  async function page({ reducedMotion = 'no-preference', hash = '#/music' } = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion });
    contexts.push(context);
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${PORT}/${hash}`);
    await p.waitForSelector('#main-content');
    await p.waitForFunction(() => !!window.BRIIX_WAIT, {}, { timeout: 10000 });
    return p;
  }

  // 1. Пулы: объём, уникальность, стадии сервера и зоны мока.
  let p = await page();
  const pools = await p.evaluate(() => {
    const data = window.BRIIX_WAIT_PHRASES;
    const out = {};
    for (const [type, set] of Object.entries(data)) {
      const all = Object.values(set).flatMap(v => Array.isArray(v) ? v : Object.values(v).flat());
      out[type] = { total: all.length, unique: new Set(all).size, stages: Object.keys(set), mock: set.mock ? Object.keys(set.mock) : [] };
    }
    return out;
  });
  for (const [type, info] of Object.entries(pools)) {
    assert.ok(info.total >= 40, type + ': пул меньше 40 фраз');
    assert.equal(info.total, info.unique, type + ': повторы внутри пула');
  }
  assert.ok(pools.music.stages.includes('writing-lyrics') && pools.music.stages.includes('synthesizing') && pools.music.stages.includes('album-cover'));
  assert.deepEqual(pools.music.mock, ['start', 'middle', 'final']);
  ok('pools: 40+ unique phrases per type, server stages and mock zones', pools);

  // 2. Привязка к стадии и к зоне мока.
  const binding = await p.evaluate(() => {
    const W = window.BRIIX_WAIT, D = window.BRIIX_WAIT_PHRASES;
    const staged = W.poolFor({ type: 'music', stage: 'album-cover' });
    const unknown = W.poolFor({ type: 'music', stage: 'несуществующая' });
    const mock = W.poolFor({ type: 'image', mock: true, zone: 'final' });
    return {
      stagedHasCover: D.music['album-cover'].every(x => staged.list.includes(x)),
      stagedFlag: staged.staged,
      unknownFallsBack: unknown.staged === null && unknown.list.length === D.music.any.length,
      mockOnlyZone: mock.list.every(x => D.image.mock.final.includes(x))
    };
  });
  assert.deepEqual(binding, { stagedHasCover: true, stagedFlag: 'album-cover', unknownFallsBack: true, mockOnlyZone: true });
  ok('stage and mock-zone binding', binding);

  // 3. Анти-повтор: окно 15 не нарушается на длинной серии.
  const repeat = await p.evaluate(() => {
    const W = window.BRIIX_WAIT;
    W.reset();
    const window_ = W.noRepeatWindow();
    const seen = [];
    let violations = 0;
    for (let i = 0; i < 60; i++) {
      const phrase = W.pick({ type: 'music', stage: 'synthesizing' });
      const last = seen.slice(-window_);
      if (last.includes(phrase)) violations++;
      seen.push(phrase);
    }
    return { window: window_, violations, stored: W.recentFor('music').length, distinct: new Set(seen).size };
  });
  assert.ok(repeat.window >= 15);
  assert.equal(repeat.violations, 0, 'фраза повторилась внутри окна анти-повтора');
  assert.ok(repeat.distinct > 20);
  ok('no repeat inside the 15-phrase window', repeat);

  // 4. История переживает перезагрузку страницы.
  const before = await p.evaluate(() => window.BRIIX_WAIT.recentFor('music').slice(-5));
  await p.reload();
  await p.waitForFunction(() => !!window.BRIIX_WAIT);
  const after = await p.evaluate(() => window.BRIIX_WAIT.recentFor('music').slice(-5));
  assert.deepEqual(after, before);
  ok('anti-repeat history survives reload', { kept: after.length });

  // 5. Ротация 4–6 секунд на постоянном узле.
  await p.evaluate(() => {
    window.BRIIX_WAIT.reset();
    const el = document.createElement('p');
    el.className = 'wait-line';
    el.id = 'wait-probe';
    el.setAttribute('data-wait', '');
    el.dataset.waitType = 'music';
    el.dataset.waitStage = 'writing-lyrics';
    document.querySelector('.music-page').appendChild(el);
    window.BRIIX_WAIT.refresh();
    window.__waitLog = [];
    let last = el.textContent;
    window.__waitTimer = setInterval(() => {
      if (el.textContent !== last) { last = el.textContent; window.__waitLog.push({ t: Date.now(), text: last }); }
    }, 100);
  });
  const firstText = await p.locator('#wait-probe').innerText();
  assert.ok(firstText.length > 10, 'новый узел заполняется сразу');
  await p.waitForFunction(() => window.__waitLog.length >= 3, {}, { timeout: 25000 });
  const rotation = await p.evaluate(() => {
    clearInterval(window.__waitTimer);
    const log = window.__waitLog;
    const gaps = log.slice(1).map((x, i) => x.t - log[i].t);
    return { changes: log.length, gaps, interval: window.BRIIX_WAIT.interval(), texts: log.map(x => x.text) };
  });
  assert.ok(rotation.changes >= 3);
  for (const gap of rotation.gaps) assert.ok(gap >= 3800 && gap <= 7100, 'интервал вне 4–6 с: ' + gap);
  assert.equal(new Set(rotation.texts).size, rotation.texts.length, 'фразы повторяются при ротации');
  ok('rotation every 4–6 seconds without repeats', { changes: rotation.changes, gaps: rotation.gaps });

  // 6. Смена стадии меняет пул немедленно.
  const stageSwitch = await p.evaluate(async () => {
    const el = document.querySelector('#wait-probe');
    el.dataset.waitStage = 'album-cover';
    await new Promise(r => setTimeout(r, 300));
    const D = window.BRIIX_WAIT_PHRASES.music;
    return { text: el.textContent, allowed: [...D['album-cover'], ...D.any].includes(el.textContent) };
  });
  assert.equal(stageSwitch.allowed, true);
  ok('stage change re-pools the line immediately', stageSwitch);
  await p.close();

  // 7. Уменьшенное движение: одна фраза, без ротации.
  p = await page({ reducedMotion: 'reduce' });
  await p.evaluate(() => {
    window.BRIIX_WAIT.reset();
    const el = document.createElement('p');
    el.id = 'wait-probe';
    el.setAttribute('data-wait', '');
    el.dataset.waitType = 'image';
    document.querySelector('.music-page').appendChild(el);
    window.BRIIX_WAIT.refresh();
  });
  const still = await p.locator('#wait-probe').innerText();
  await p.waitForTimeout(7500);
  assert.equal(await p.locator('#wait-probe').innerText(), still, 'при reduced-motion ротации быть не должно');
  assert.equal(await p.evaluate(() => window.BRIIX_WAIT.stats().rotations), 0);
  ok('reduced motion: no rotation', { phrase: still });
  await p.close();

  // 8. настоящий хук: локальный мок музыки показывает строку под прогрессом.
  p = await page();
  await p.locator('#music-prompt').fill('Спокойная инструментальная подложка для ролика о мастерской.');
  await p.locator('#music-generate').click();
  await p.waitForSelector('.music-page [data-wait]', { timeout: 15000 });
  const hook = await p.evaluate(() => {
    const el = document.querySelector('.music-page [data-wait]');
    const bar = document.querySelector('.music-progress');
    return {
      text: el.textContent, mock: el.dataset.waitMock, type: el.dataset.waitType,
      zone: el.dataset.waitZone,
      underProgress: !!(bar && bar.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
      fontSize: parseFloat(getComputedStyle(el).fontSize)
    };
  });
  assert.ok(hook.text.length > 10);
  assert.equal(hook.mock, '1', 'мок не должен притворяться серверной стадией');
  assert.equal(hook.type, 'music');
  assert.equal(hook.underProgress, true, 'строка должна идти ПОСЛЕ прогресса');
  assert.ok(hook.fontSize <= 12, 'мелкий кегль');
  ok('mock music job shows an honest wait line under the progress', hook);
  await p.close();

  // 9. Сценарный чат не показывает «живые» фразы ожидания.
  p = await page({ hash: '#/' });
  await p.locator('#prompt-input').fill('Что ты умеешь?');
  await p.locator('#send-button').click();
  await p.waitForSelector('.message.assistant', { timeout: 15000 });
  assert.equal(await p.locator('.message [data-wait]').count(), 0, 'сценарный ответ не имитирует работу модели');
  ok('scripted chat has no live wait line', {});

  assert.deepEqual(errors, [], 'page errors');
  ok('no page errors', {});
  console.log('DONE', results.length, 'checks');
  for (const c of contexts) await c.close();
  await browser.close();
  srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
