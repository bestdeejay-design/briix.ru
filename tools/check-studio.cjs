/* Studio v2 checks: composer-first dark UI on the private bus.
 * Self-contained: repo on 127.0.0.1:18388, fake media-bff on 127.0.0.1:18300.
 * Run: node tools/check-studio.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = Number(process.env.BRIIX_STUDIO_STATIC_PORT || 18388);
const BFF_PORT = Number(process.env.BRIIX_STUDIO_BFF_PORT || 18300);
const TOKEN = 'test-token';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.m4a': 'audio/mp4', '.json': 'application/json', '.woff2': 'font/woff2' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const M4A_PATH = path.join(ROOT, 'assets/media/showcase/ballad30.m4a');
const M4A = fs.existsSync(M4A_PATH) ? fs.readFileSync(M4A_PATH) : Buffer.from('fake-m4a');
const POLICY_MESSAGE = 'Запрос нарушает политику контента.';

let state;
function resetBff() {
  state = {
    chatPosts: [], chatBlocked: false, chatImproveText: 'УЛУЧШЕННЫЙ ТЕКСТ', chatSlow: false,
    jobPosts: [], jobBlock: false, polls: 0
  };
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

function sse(res, fullText, intervalMs = 5) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` });
  const words = fullText.split(' ');
  let i = 0;
  const timer = setInterval(() => {
    if (i < words.length) {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: (i ? ' ' : '') + words[i] } }] }) + '\n\n');
      i++;
    } else {
      res.write('data: [DONE]\n\n');
      clearInterval(timer);
      res.end();
    }
  }, intervalMs);
  res.on('close', () => clearInterval(timer));
}

function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      const readBody = cb => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => cb(JSON.parse(raw || '{}'))); };

      if (req.url === '/health') { send(200, { ok: true }); return; }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'no' } }); return; }

      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        readBody(body => {
          state.chatPosts.push(body);
          if (state.chatBlocked) { send(422, { error: { code: 'content_blocked', message: POLICY_MESSAGE } }); return; }
          const last = body.messages.at(-1)?.content || '';
          // Кнопка «Улучшить» ходит non-stream, чат — stream.
          if (body.stream === false) return send(200, { choices: [{ message: { content: state.chatImproveText } }] });
          if (state.chatSlow) return sse(res, 'медленное слово '.repeat(80), 120);
          sse(res, 'Стрим пришёл: ' + last.slice(-40));
        });
        return;
      }

      if (req.url === '/jobs' && req.method === 'POST') {
        readBody(body => {
          state.jobPosts.push(body);
          if (state.jobBlock) { send(422, { error: { code: 'content_blocked', message: POLICY_MESSAGE } }); return; }
          send(202, { job_id: 'job-studio-1' });
        });
        return;
      }

      if (req.url.startsWith('/jobs/job-studio-1')) {
        state.polls++;
        const post = state.jobPosts.at(-1) || {};
        if (state.polls <= 2) {
          const stage = post.type === 'music' ? (state.polls === 1 ? 'writing-lyrics' : 'synthesizing') : 'generating';
          send(200, { id: 'job-studio-1', type: post.type, status: 'running', stage });
          return;
        }
        send(200, { id: 'job-studio-1', type: post.type, status: 'ready', result_url: post.type === 'music' ? '/files/job-studio-1.m4a' : '/files/job-studio-1.png' });
        return;
      }

      if (req.url.startsWith('/files/job-studio-1.png')) { res.writeHead(200, { 'Content-Type': 'image/png', ...cors }); res.end(PNG); return; }
      if (req.url.startsWith('/files/job-studio-1.m4a')) { res.writeHead(200, { 'Content-Type': 'audio/mp4', ...cors }); res.end(M4A); return; }
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
  const ok = (name, data = {}) => { results.push({ name }); console.log('PASS', name, JSON.stringify(data)); };
  const errors = [];
  const URL_ = `http://127.0.0.1:${STATIC_PORT}/studio.html`;

  async function page({ viewport = { width: 1440, height: 1000 }, token = TOKEN, user = 'tester' } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    const sessionScript = ({ t, port, user }) => {
      localStorage.setItem('briix-media-live-token', t);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
      if (user) { // предзаданная сессия v3: гейт входа пропускаем
        localStorage.setItem('briix-studio-profiles', JSON.stringify({ [user]: { pinHash: 'x', created: 0 } }));
        localStorage.setItem('briix-studio-user', user);
      }
    };
    if (token) await p.addInitScript(sessionScript, { t: token, port: BFF_PORT, user });
    else await p.addInitScript(({ port, user }) => {
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
      if (user) {
        localStorage.setItem('briix-studio-profiles', JSON.stringify({ [user]: { pinHash: 'x', created: 0 } }));
        localStorage.setItem('briix-studio-user', user);
      }
    }, { port: BFF_PORT, user });
    await p.goto(URL_);
    await p.waitForSelector(user ? '#send' : '#gate');
    return p;
  }

  // 1. Загрузка без ошибок, 3 режима, чип помощника по режимам, состояния send.
  let p = await page();
  await p.waitForTimeout(300);
  assert.deepEqual(errors, [], 'no page errors on load');
  assert.equal(await p.locator('.mode').count(), 3);
  assert.equal(await p.locator('.mode[data-mode="chat"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await p.locator('#send').isDisabled(), true, 'send disabled on empty field');
  assert.equal(await p.locator('#assistantChip').isVisible(), true, 'assistant is a toolbar chip');
  // Чат: 3 помощника в меню чипа.
  await p.locator('#assistantChip').click();
  assert.equal(await p.locator('#assistantMenu button').count(), 7, 'chat has 7 assistants');
  assert.match(await p.locator('#assistantMenu').innerText(), /Универсальный/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Маркетолог/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Наставник/);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#assistantMenu').isVisible(), false, 'Escape closes the menu');
  // Фото: 1 помощник, музыкальные чипы скрыты.
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#assistantChip').click();
  assert.equal(await p.locator('#assistantMenu button').count(), 2, 'photo has 2 assistants');
  assert.match(await p.locator('#assistantMenu').innerText(), /Арт-директор/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Визуальный дизайнер/);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#modelChip').isVisible(), false, 'model chip hidden outside music');
  // Музыка: 2 помощника + муз-чипы видимы.
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#assistantChip').click();
  assert.equal(await p.locator('#assistantMenu button').count(), 3, 'music has 3 assistants');
  assert.match(await p.locator('#assistantMenu').innerText(), /Продюсер/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Лирик/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Автор песни/);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#modelChip').isVisible(), true, 'model chip visible in music');
  assert.equal(await p.locator('#durationChip').isVisible(), true, 'duration chip visible in music');
  assert.equal(await p.locator('#vocalChip').isVisible(), true, 'vocal toggle visible in music');
  assert.equal(await p.locator('#tuneToggle').isVisible(), true, 'fine-tune toggle visible in music');
  assert.equal(await p.locator('#advanced').isVisible(), false, 'advanced fields hidden by default (Simple)');
  // Поле активно — send разблокируется.
  await p.locator('#prompt').fill('dream pop track');
  assert.equal(await p.locator('#send').isDisabled(), false, 'send enabled once the prompt is filled');
  await p.locator('#prompt').fill('');
  ok('loads clean, 3 modes, assistant chip menus per mode, music toolbar', {});

  // 2. Инлайн-ввод ключа, когда localStorage пуст.
  p = await page({ token: '' });
  await p.locator('.mode[data-mode="chat"]').click();
  await p.locator('#prompt').fill('привет');
  await p.locator('#send').click();
  await p.waitForSelector('#keyCard:not([hidden])');
  await p.locator('#keyInput').fill(TOKEN);
  await p.locator('#keySave').click();
  const stored = await p.evaluate(() => localStorage.getItem('briix-media-live-token'));
  assert.equal(stored, TOKEN);
  ok('missing key shows inline card, saved to localStorage', {});

  // 3. Чат-стрим + inline-кнопка «Сделать из этого трек».
  p = await page();
  await p.locator('#prompt').fill('Вопрос про музыку');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('.card.assistant .body').length &&
    document.querySelector('.card.assistant .body').textContent.includes('Стрим пришёл'), {}, { timeout: 15000 });
  assert.ok(state.chatPosts.at(-1).stream === true, 'chat went as SSE stream');
  assert.match(state.chatPosts.at(-1).messages[0].content, /система|Наставник|собеседник/i);
  assert.equal(await p.locator('.card.user').count(), 1);
  await p.waitForSelector('.card .action.make-track', { timeout: 5000 });
  ok('chat SSE stream lands in the feed with system prompt + make-track action', {});

  // 4. «Сделать из этого трек» → музыка с подставленным брифом.
  await p.locator('.card .action.make-track').click();
  assert.equal(await p.locator('.mode[data-mode="music"]').getAttribute('aria-pressed'), 'true', 'switched to music mode');
  assert.match(await p.locator('#prompt').inputValue(), /Стрим пришёл/, 'brief inserted into the music field');
  assert.match(await p.locator('#prompt').getAttribute('placeholder'), /Опиши трек/);
  ok('make-track switches to music with the brief prefilled', {});

  // 5. «Тонко настроить»: два поля, улучшение лирики (few-shot, non-stream, отмена).
  await p.locator('#prompt').fill('');
  await p.locator('#tuneToggle').click();
  assert.equal(await p.locator('#advanced').isVisible(), true, 'advanced panel opens');
  assert.equal(await p.locator('#prompt').isVisible(), false, 'single field hides in advanced mode');
  assert.match(await p.locator('#lyrics').getAttribute('placeholder'), /Текст песни/);
  assert.equal(await p.locator('#improveLyrics').isDisabled(), true, 'improve disabled on empty lyrics');
  const originalLyrics = 'Город спит, а я не сплю';
  await p.locator('#lyrics').fill(originalLyrics);
  assert.equal(await p.locator('#improveLyrics').isDisabled(), false);
  await p.locator('#improveLyrics').click();
  await p.waitForFunction(() => document.getElementById('lyrics').value.includes('УЛУЧШЕННЫЙ ТЕКСТ'), {}, { timeout: 15000 });
  const improvePost = state.chatPosts.at(-1);
  assert.equal(improvePost.stream, false);
  assert.ok(Array.isArray(improvePost.messages) && improvePost.messages[0].role === 'system');
  const sys = improvePost.messages[0].content;
  assert.ok(/<example source=/.test(sys), 'system prompt carries few-shot examples');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/creative-base.json'), 'utf8'));
  const exampleCount = (sys.match(/<example source=/g) || []).length;
  assert.equal(exampleCount, 5, 'exactly 5 few-shot examples');
  assert.ok(base.lyrics.some(l => sys.includes(l.text)), 'examples come from owner lyrics pool');
  assert.ok(improvePost.max_tokens <= 600);
  assert.equal(await p.locator('#undoLyrics').isVisible(), true);
  await p.locator('#undoLyrics').click();
  assert.equal(await p.locator('#lyrics').inputValue(), originalLyrics, 'undo restores original text');
  ok('lyrics improve: few-shot from creative-base, replace + undo, disabled when empty', { exampleCount });

  // 6. Структурные теги вставляются в лирику.
  await p.locator('#tags .tag[data-tag="[Chorus]"]').click();
  await p.locator('#tags .tag[data-tag="[Verse]"]').click();
  const tagged = await p.locator('#lyrics').inputValue();
  assert.match(tagged, /\[Chorus\]/);
  assert.match(tagged, /\[Verse\]/);
  ok('structure tags insert into lyrics field', { tagged: tagged.trim() });

  // 7. Музыка-джоба: лирика + стиль, длительность, инструментал по дефолту, Pro/вокал, стадии, плеер.
  await p.locator('#lyrics').fill('[Verse]\nГород спит\n[Chorus]\nА я не сплю');
  await p.locator('#musicPrompt').fill('dream pop, 90 BPM, female vocals');
  await p.locator('#durationChip').click();
  await p.locator('#durationMenu button', { hasText: '60 с' }).click();
  assert.equal(await p.locator('#durationName').innerText(), '60 с');
  assert.equal(await p.locator('#vocalChip').getAttribute('aria-pressed'), 'true', 'instrumental is the default while vocal route is broken (infra#79)');
  assert.equal(await p.locator('#vocalChip').innerText(), 'Инструментал');
  await p.evaluate(() => {
    window.__stageSeen = [];
    new MutationObserver(muts => {
      for (const r of muts) {
        const t = (r.target.textContent || '').slice(0, 40);
        const m = t.match(/Пишем лирику|Синтезируем/);
        if (m && !window.__stageSeen.includes(m[0])) window.__stageSeen.push(m[0]);
      }
    }).observe(document.getElementById('feed'), { subtree: true, childList: true, characterData: true });
  });
  await p.locator('#send').click();
  await p.waitForSelector('.card.stage', { timeout: 10000 });
  await p.waitForSelector('.card.assistant audio', { timeout: 20000 });
  const seen = await p.evaluate(() => window.__stageSeen);
  assert.ok(seen.length >= 1, 'polling stages were shown: ' + seen.join(','));
  const musicPost = state.jobPosts.at(-1);
  assert.equal(musicPost.type, 'music');
  assert.equal(musicPost.prompt, 'dream pop, 90 BPM, female vocals');
  assert.match(musicPost.params.lyrics, /\[Chorus\]/);
  assert.equal(musicPost.params.model, 'ace-step-flash');
  assert.equal(musicPost.params.duration_seconds, 60);
  assert.equal(musicPost.params.instrumental, true);
  // Pro через чип модели + снова с вокалом (тумблер отжат).
  await p.locator('#vocalChip').click();
  assert.equal(await p.locator('#vocalChip').getAttribute('aria-pressed'), 'false', 'toggle off = vocal song');
  await p.locator('#modelChip').click();
  await p.locator('#modelMenu button', { hasText: 'Pro' }).click();
  assert.equal(await p.locator('#modelName').innerText(), 'Pro');
  await p.locator('#musicPrompt').fill('dream pop, 90 BPM, female vocals');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('audio').length >= 2, {}, { timeout: 20000 });
  assert.equal(state.jobPosts.at(-1).params.model, 'ace-step-pro');
  assert.equal(state.jobPosts.at(-1).params.instrumental, undefined, 'vocal toggle off removes the flag');
  ok('music job: lyrics + style + duration/instrumental/pro chips, stages, audio player', {});

  // 8. Фото-джоба: превью в ленту.
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('neon city at night');
  await p.locator('#send').click();
  await p.waitForSelector('.card img', { timeout: 20000 });
  const photoPost = state.jobPosts.at(-1);
  assert.equal(photoPost.type, 'image');
  const natural = await p.locator('.card img').first().evaluate(img => img.naturalWidth);
  assert.ok(natural > 0, 'PNG preview actually decoded');
  ok('photo job renders decoded PNG preview', {});

  // 9. Модерация 422 в чате и в джобе: карточка + сохранение текста.
  state.chatBlocked = true;
  await p.locator('.mode[data-mode="chat"]').click();
  const blockedText = 'запрещённый текст';
  await p.locator('#prompt').fill(blockedText);
  await p.locator('#send').click();
  await p.waitForSelector('.card.error', { timeout: 10000 });
  const errText = await p.locator('.card.error').last().innerText();
  assert.match(errText, /Не пройдена проверка контента/);
  assert.equal(await p.locator('#prompt').inputValue(), blockedText, 'blocked chat text kept in the field');
  state.chatBlocked = false;
  state.jobBlock = true;
  const errCount = await p.locator('.card.error').count();
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('запрещённая картинка');
  await p.locator('#send').click();
  await p.waitForFunction(n => document.querySelectorAll('.card.error').length > n, errCount, { timeout: 10000 });
  assert.equal(await p.locator('#prompt').inputValue(), 'запрещённая картинка', 'blocked job text kept in the field');
  state.jobBlock = false;
  ok('422 content_blocked: moderation card + text preserved (chat and jobs)', {});

  // 10. Кнопки-состояния: hover/active/disabled присутствуют в CSS.
  const css = fs.readFileSync(path.join(ROOT, 'studio.css'), 'utf8');
  for (const sel of ['.send:hover', '.send:disabled', '.tool:hover', '.tag:hover', '.mode[aria-pressed="true"]', ':focus-visible']) {
    assert.ok(css.includes(sel), 'css defines state ' + sel);
  }
  assert.ok(css.includes('#d97757'), 'single accent color used');
  ok('interactive states defined in css (hover/active/disabled/focus + accent)', {});

  // 11. Enter отправляет в чате; стоп-кнопка прерывает стрим, текст возвращается в поле.
  p = await page();
  state.chatSlow = true;
  await p.locator('#prompt').fill('останови меня');
  await p.locator('#prompt').press('Enter'); // Enter = отправка в чате
  await p.waitForSelector('.card.user');
  await p.waitForFunction(() => document.getElementById('send').classList.contains('stop'), {}, { timeout: 10000 });
  await p.waitForTimeout(700); // пусть стрим успеет отдать несколько слов
  const lenBefore = await p.evaluate(() => document.querySelector('.card.assistant .body').textContent.length);
  await p.locator('#send').click(); // во время работы кнопка = стоп
  await p.waitForSelector('.card.notice', { timeout: 10000 });
  assert.match(await p.locator('.card.notice').last().innerText(), /остановлено/i);
  const lenAfter = await p.evaluate(() => document.querySelector('.card.assistant .body').textContent.length);
  await p.waitForTimeout(900);
  assert.equal(await p.evaluate(() => document.querySelector('.card.assistant .body').textContent.length), lenAfter, 'stream frozen after stop');
  assert.equal(await p.locator('#prompt').inputValue(), 'останови меня', 'text returned to the field after stop');
  state.chatSlow = false;
  ok('Enter-to-send in chat + stop button aborts the stream and keeps the text', {});

  // 12. «Новый чат» чистит ленту и историю.
  await p.locator('#newChat').click();
  assert.equal(await p.locator('#feed .card').count(), 0, 'feed emptied');
  ok('new chat clears the feed and history', {});

  // 13. ✨ в Фото: арт-директор улучшает промпт, undo возвращает.
  await p.locator('.mode[data-mode="photo"]').click();
  const photoPrompt = 'кот в шляпе';
  await p.locator('#prompt').fill(photoPrompt);
  await p.locator('#improvePhoto').click();
  await p.waitForFunction(() => document.getElementById('prompt').value.includes('УЛУЧШЕННЫЙ ТЕКСТ'), {}, { timeout: 15000 });
  assert.equal(state.chatPosts.at(-1).stream, false, 'photo improve goes non-stream');
  assert.match(state.chatPosts.at(-1).messages[0].content, /Арт-директор/, 'photo improve uses the art-director system prompt');
  assert.equal(await p.locator('#undoPhoto').isVisible(), true);
  await p.locator('#undoPhoto').click();
  assert.equal(await p.locator('#prompt').inputValue(), photoPrompt, 'undo restores the prompt');
  ok('photo prompt improve via art-director + undo', {});

  // 14. Кнопка «Скачать» у готового фото.
  await p.locator('#prompt').fill('a lighthouse');
  await p.locator('#send').click();
  await p.waitForSelector('.card img', { timeout: 20000 });
  const dl = await p.locator('.card a.action[download]').last().getAttribute('download');
  assert.match(dl, /^briix-photo-.*\.png$/, 'download link carries a filename');
  ok('photo card carries a download link', { dl });

  // 15. Профиль-меню: ник, ключ через «Ключ стенда…», Escape закрывает меню.
  await p.locator('#profileBtn').click();
  await p.waitForSelector('#profileMenu:not([hidden])');
  assert.match(await p.locator('#profileNick').innerText(), /^tester$/, 'profile menu shows the nick');
  await p.locator('#profileKeyBtn').click();
  await p.waitForSelector('#keyCard:not([hidden])');
  assert.equal(await p.locator('#keyCard').isVisible(), true, 'key card opens from the profile menu');
  assert.equal(await p.locator('#profileMenu').isVisible(), false, 'menu closed after picking the item');
  await p.locator('#profileBtn').click();
  await p.waitForSelector('#profileMenu:not([hidden])');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#profileMenu').isVisible(), false, 'Escape closes the profile menu');
  ok('profile menu: nick label, key card via menu item, Escape closes', {});

  // 16. Гейт входа: ник + PIN-пад, регистрация, сессия, выход, неверный PIN.
  p = await page({ user: '' });
  await p.waitForTimeout(200);
  assert.equal(await p.locator('#gate').isVisible(), true, 'gate shown without a session');
  assert.equal(await p.locator('#studio').isVisible(), false, 'studio hidden behind the gate');
  await p.locator('#nickInput').fill('owner');
  for (const digit of '1234') await p.locator(`.pk[data-digit="${digit}"]`).click();
  assert.equal(await p.locator('.pd.on').count(), 4, 'four pin dots lit');
  await p.locator('#enterBtn').click();
  await p.waitForSelector('#studio:not([hidden])');
  assert.equal(await p.locator('#profileNick').innerText(), 'owner');
  await p.reload();
  await p.waitForSelector('#studio:not([hidden])');
  assert.equal(await p.locator('#gate').isVisible(), false, 'session survives reload');
  p.once('dialog', d => d.accept());
  await p.locator('#profileBtn').click();
  await p.waitForSelector('#profileMenu:not([hidden])');
  await p.locator('#profileLogoutBtn').click();
  await p.waitForSelector('#gate:not([hidden])');
  await p.locator('#nickInput').fill('owner');
  for (const digit of '9999') await p.locator(`.pk[data-digit="${digit}"]`).click();
  await p.locator('#enterBtn').click();
  await p.waitForFunction(() => document.getElementById('gateHint').textContent.includes('Неверный PIN'));
  ok('gate: nick+pinpad login, registration, session persistence, logout, wrong pin', {});

  // 17. Вкладки/библиотека: музыка с лирикой и фото попадают в библиотеку, избранное и удаление.
  p = await page();
  // Музыкальная джоба в advanced-режиме с лирикой (быстрее полной секции 7).
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#tuneToggle').click();
  const libLyrics = '[Verse]\nГород спит\n[Chorus]\nА я не сплю';
  await p.locator('#lyrics').fill(libLyrics);
  await p.locator('#musicPrompt').fill('dream pop, 90 BPM');
  await p.locator('#send').click();
  await p.waitForSelector('.card.assistant audio', { timeout: 20000 });
  // Фото-джоба.
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('a lighthouse in fog');
  await p.locator('#send').click();
  await p.waitForSelector('.card img', { timeout: 20000 });
  await p.locator('.tab[data-tab="library"]').click();
  assert.equal(await p.locator('#lib').isVisible(), true, 'library tab opens');
  assert.equal(await p.locator('#composer').isVisible(), false, 'composer hidden in library');
  await p.waitForSelector('.lib-item', { timeout: 10000 });
  assert.match(await p.locator('.lib-item .lib-prompt', { hasText: 'lighthouse' }).innerText(), /lighthouse/);
  // Музыкальная запись: модель в .who, подпись M4A, сворачиваемый текст песни.
  const musicItem = p.locator('.lib-item', { hasText: /Музыка/i }).first();
  const musicWho = await musicItem.locator('.who').innerText();
  assert.match(musicWho, /ace-step/i, 'music .who carries the model');
  assert.match(musicWho, /\d+\s*с/i, 'music .who carries the duration');
  assert.match(await musicItem.locator('a.action').first().innerText(), /M4A/, 'music download labelled M4A');
  const lyricsToggle = musicItem.locator('.lib-lyrics-toggle');
  assert.equal(await lyricsToggle.isVisible(), true, 'lyrics toggle exists');
  await lyricsToggle.click();
  const lyricsBlock = musicItem.locator('.lib-lyrics.open .lib-lyrics-text');
  assert.equal(await lyricsBlock.isVisible(), true, 'lyrics block opens');
  assert.match(await lyricsBlock.innerText(), /Город спит/, 'lyrics block carries the lyrics text');
  await p.locator('.lib-filters .tag', { hasText: '★ Избранное' }).click();
  assert.equal(await p.locator('.lib-item').count(), 0, 'not a favorite yet');
  await p.locator('.lib-filters .tag', { hasText: 'Все' }).click();
  await p.locator('.lib-item .action', { hasText: 'В избранное' }).first().click();
  assert.ok(await p.locator('.lib-item.fav').count() >= 1, 'favorite applied');
  await p.locator('.lib-filters .tag', { hasText: '★ Избранное' }).click();
  assert.ok(await p.locator('.lib-item').count() >= 1, 'favorite filter shows it');
  await p.locator('.lib-filters .tag', { hasText: 'Все' }).click();
  const beforeDel = await p.locator('.lib-item').count();
  p.once('dialog', d => d.accept());
  await p.locator('.lib-item .action', { hasText: 'Удалить' }).first().click();
  await p.waitForFunction(n => document.querySelectorAll('.lib-item').length < n, beforeDel);
  await p.locator('.tab[data-tab="chat"]').click();
  assert.equal(await p.locator('#composer').isVisible(), true, 'chat tab restores composer');
  ok('library: entry from job, favorite toggle + filter, delete, tab switching', {});

  // 18. Мобильный 390×844: композер у низа, без горскролла, тач-таргеты ≥44.
  p = await page({ viewport: { width: 390, height: 844 } });
  await p.waitForTimeout(300);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, 'no horizontal scroll at 390px, overflow=' + overflow);
  const geo = await p.evaluate(() => {
    const wrap = (document.querySelector('.tabs') || document.querySelector('.composer-wrap')).getBoundingClientRect();
    const sizes = [...document.querySelectorAll('button, textarea, input')]
      .filter(el => el.offsetParent !== null && !el.closest('[hidden]'))
      .map(el => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height));
    return { bottomGap: window.innerHeight - Math.round(wrap.bottom), minTarget: Math.min(...sizes.filter(s => s > 0)) };
  });
  assert.ok(geo.bottomGap >= 0 && geo.bottomGap <= 16, 'composer + tabs pinned to viewport bottom, gap=' + geo.bottomGap);
  assert.ok(geo.minTarget >= 44, 'smallest touch target >= 44px, got ' + geo.minTarget);
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-390.png'), fullPage: false });
  // Музыка на мобайле: тулбар не ломается.
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#tuneToggle').click();
  const overflow2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow2 <= 0, 'no h-scroll in music advanced at 390px, overflow=' + overflow2);
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-390-music.png'), fullPage: false });
  ok('mobile 390x844: composer sticky bottom, no h-scroll, touch targets >=44', { ...geo });

  assert.deepEqual(errors, [], 'no page errors anywhere');
  await browser.close();
  staticSrv.close();
  bff.close();
  console.log('SUITE PASS: ' + results.length + ' checks');
})().catch(e => { console.error('SUITE FAIL:', e); process.exit(1); });
