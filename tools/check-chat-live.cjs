/* Phase 2 checks: chat on the private bus (SSE, stop, mid-stream error, honest fallback).
 * Self-contained: repo on 127.0.0.1:8388, fake media-bff on 127.0.0.1:8300.
 * Run: node tools/check-chat-live.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = 8388, BFF_PORT = 8300;
const TOKEN = 'test-token';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain' };
const PIECES = ['ОТВЕТ-МОДЕЛИ: ', 'первый ', 'второй ', 'третий ', 'фрагмент.'];
const WHOLE = PIECES.join('');

let state;
function resetBff() { state = { up: true, chatReady: true, mode: 'sse', calls: [], aborted: 0, blocked: false }; }
const POLICY_MESSAGE = 'Запрос нарушает политику контента: откровенный материал не генерируется.';
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

function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (!state.up) { req.socket.destroy(); return; }
      const origin = req.headers.origin;
      const allowed = origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '';
      const cors = { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      if (req.url === '/health') { send(200, { ok: true, backends: { text: state.chatReady ? 'ready' : 'unavailable' } }); return; }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'no' } }); return; }
      if (req.url === '/v1/models') { send(200, { object: 'list', data: [{ id: 'qwen3:4b-instruct', capabilities: ['chat', 'text.generate'], status: state.chatReady ? 'ready' : 'unavailable', limits: { max_concurrent_jobs: 2 } }] }); return; }
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
          const body = JSON.parse(raw || '{}');
          state.calls.push(body);
          if (state.blocked) { send(422, { error: { code: 'content_blocked', message: POLICY_MESSAGE } }); return; }
          const chunk = (delta, extra = {}) => 'data: ' + JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', model: 'qwen3:4b-instruct', choices: [{ index: 0, delta, finish_reason: null }], ...extra }) + '\n\n';
          if (!body.stream) { send(200, { id: 'chatcmpl-1', object: 'chat.completion', model: 'qwen3:4b-instruct', choices: [{ index: 0, message: { role: 'assistant', content: WHOLE }, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 12 } }); return; }
          if (state.mode === 'json-only') { send(200, { id: 'chatcmpl-1', choices: [{ message: { role: 'assistant', content: WHOLE } }] }); return; }
          // Real bff sets CORS after prepare(): the header never reaches the wire on SSE.
          const sseCors = state.mode === 'sse-no-cors' ? { Vary: 'Origin' } : cors;
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...sseCors });
          let i = 0;
          const tick = () => {
            if (res.destroyed) return;
            if (state.mode === 'sse-mid-error' && i === 2) {
              res.write('data: ' + JSON.stringify({ error: { code: 'upstream_error', message: 'ollama закрыл соединение' } }) + '\n\n');
              res.end(); return;
            }
            if (i < PIECES.length) { res.write(chunk({ content: PIECES[i++] })); setTimeout(tick, 260); return; }
            res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
            res.write('data: [DONE]\n\n'); res.end();
          };
          res.on('close', () => { if (!res.writableEnded) state.aborted++; });
          tick();
        });
        return;
      }
      send(404, { error: { code: 'not_found', message: 'nf' } });
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const staticSrv = await staticServer(STATIC_PORT);
  const bff = await bffServer(BFF_PORT);
  const browser = await launch();
  const contexts = [];
  const errors = [];
  const results = [];
  const ok = (name, data = {}) => { results.push(name); console.log('PASS', name, JSON.stringify(data)); };

  async function page() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(token => {
      localStorage.setItem('briix-media-live-token', token);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:8300'));
    }, TOKEN);
    await p.goto(`http://127.0.0.1:${STATIC_PORT}/#/`);
    await p.waitForSelector('#prompt-input');
    return p;
  }
  // Фаза 3: ключ в браузере → чат отвечает моделью сразу, без тоггла.
  const enableLive = async p => {
    await p.waitForFunction(() => window.BRIIX_CHAT_LIVE.active(), {}, { timeout: 15000 });
  };
  const send = async (p, text) => { await p.locator('#prompt-input').fill(text); await p.locator('#send-button').click(); };
  const lastMessage = p => p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('briix-workspace-v2') || 'null');
    const chat = s?.chats?.[0]; // новый диалог всегда первый: demo.js делает unshift
    return chat?.messages.filter(m => m.role === 'assistant').at(-1) || null;
  });
  // Предикат по всему списку диалогов исторически ловил complete-ответы из seedChats()
  // и падал на JSON.parse(null), пока демо ещё не персистилось. Ждём только свой диалог.
  const waitAssistant = (p, status) => p.waitForFunction(want => {
    const s = JSON.parse(localStorage.getItem('briix-workspace-v2') || 'null');
    return !!s?.chats?.[0]?.messages.some(m => m.role === 'assistant' && m.status === want);
  }, status, { timeout: 20000 });

  // Streaming: text arrives in pieces, the answer is labelled and carries provenance.
  resetBff();
  let p = await page();
  await enableLive(p);
  assert.match(await p.locator('.composer-context').innerText(), /Приватный live/);
  assert.equal(await p.locator('[data-action="toggle-chat-live"]').getAttribute('aria-pressed'), 'true');
  assert.match(await p.locator('#topbar').innerText(), /Приватный live/);
  assert.ok(!(await p.locator('#topbar').innerText()).includes('Демо без backend'), 'topbar must not claim there is no backend');
  assert.match(await p.locator('.local-card').innerText(), /уходит на ваш собственный сервер/);
  await send(p, 'Объясни, что такое приватная шина моделей.');
  await p.waitForFunction(() => {
    const el = document.querySelector('.message.assistant .prose');
    return el && el.textContent.includes('ОТВЕТ-МОДЕЛИ') && !el.textContent.includes('фрагмент.');
  }, {}, { timeout: 10000 });
  const partial = await p.locator('.message.assistant .prose').last().innerText();
  await p.waitForFunction(() => window.BRIIX_CHAT_LIVE.provenanceFor(document.querySelector('.message.assistant:last-of-type')?.dataset.messageId) !== null, {}, { timeout: 15000 });
  let msg = await lastMessage(p);
  assert.equal(msg.content, WHOLE);
  assert.equal(msg.status, 'complete');
  assert.match(await p.locator('.chat-live-badge').last().innerText(), /Live · qwen3/);
  assert.match(await p.locator('.chat-live-provenance').last().innerText(), /поток SSE/);
  assert.equal(state.calls[0].stream, true);
  assert.ok(state.calls[0].messages.some(m => m.role === 'system'), 'assistant persona sent as system message');
  ok('SSE stream renders piece by piece with provenance', { partialLength: partial.length, finalLength: msg.content.length });

  // History is sent back to the model on the next turn.
  await send(p, 'А как это связано с туннелем?');
  await p.waitForFunction(() => document.querySelectorAll('.chat-live-provenance').length >= 2, {}, { timeout: 15000 });
  const second = state.calls.at(-1);
  assert.ok(second.messages.filter(m => m.role === 'user').length >= 2, 'previous turn included');
  assert.ok(second.messages.some(m => m.role === 'assistant' && m.content === WHOLE), 'previous answer included');
  ok('client-side history is sent to the model', { messages: second.messages.length });

  // No token and no server address inside the exported chat history.
  const storedRaw = await p.evaluate(() => localStorage.getItem('briix-workspace-v2'));
  assert.ok(!storedRaw.includes(TOKEN), 'token never enters chat storage');
  assert.ok(!storedRaw.includes('127.0.0.1:8300'), 'server address never enters chat storage');
  ok('chat storage keeps no token and no server address', {});
  await p.close();

  // Stop aborts the in-flight stream.
  resetBff();
  p = await page();
  await enableLive(p);
  await send(p, 'Расскажи длинную историю про сервер.');
  await p.waitForFunction(() => (document.querySelector('.message.assistant .prose')?.textContent || '').includes('ОТВЕТ-МОДЕЛИ'), {}, { timeout: 10000 });
  await p.locator('#send-button').click(); // becomes "stop" while streaming
  await waitAssistant(p, 'stopped');
  const stopped = await lastMessage(p);
  await p.waitForTimeout(1200);
  assert.equal((await lastMessage(p)).content, stopped.content, 'no chunks after stop');
  assert.ok(stopped.content.length < WHOLE.length, 'stopped before the end');
  ok('stop aborts the stream and keeps partial text', { length: stopped.content.length, aborted: state.aborted });
  await p.close();

  // Mid-stream failure: partial text stays, error is visible, no scripted substitution.
  resetBff(); state.mode = 'sse-mid-error';
  p = await page();
  await enableLive(p);
  await send(p, 'Проверь обрыв потока на середине ответа.');
  await waitAssistant(p, 'error');
  msg = await lastMessage(p);
  assert.ok(msg.content.startsWith('ОТВЕТ-МОДЕЛИ'), 'partial model text preserved');
  assert.ok(msg.content.length < WHOLE.length);
  assert.match(await p.locator('#chat-live-banner').innerText(), /оборвался/);
  const errorBlock = await p.locator('.message-error').last().innerText();
  assert.ok(!errorBlock.includes('демонстрационная ошибка'), 'a live failure is not labelled as a scripted demo error');
  assert.match(errorBlock, /сбой приватного live-режима/);
  assert.equal(state.calls.length, 1, 'no silent retry that would duplicate the answer');
  ok('mid-stream error keeps partial answer and shows the reason', { kept: msg.content, calls: state.calls.length });
  await p.close();

  // The real bff cannot send CORS headers on SSE (audit F-02): honest whole-answer fallback.
  resetBff(); state.mode = 'sse-no-cors';
  p = await page();
  await enableLive(p);
  await send(p, 'Ответь целиком, если поток недоступен.');
  await p.waitForFunction(() => document.querySelectorAll('.chat-live-provenance').length >= 1, {}, { timeout: 20000 });
  msg = await lastMessage(p);
  assert.equal(msg.content, WHOLE);
  assert.match(await p.locator('.chat-live-provenance').last().innerText(), /ответ целиком/);
  assert.match(await p.locator('#chat-live-banner').innerText(), /Стрим недоступен/);
  assert.ok(state.calls.some(c => c.stream === false), 'fallback uses stream:false');
  ok('SSE without CORS → honest non-stream fallback', { calls: state.calls.map(c => c.stream) });
  await p.close();

  // Server that answers JSON to a stream request is also handled without pretending.
  resetBff(); state.mode = 'json-only';
  p = await page();
  await enableLive(p);
  await send(p, 'Сервер не умеет поток.');
  await p.waitForFunction(() => document.querySelectorAll('.chat-live-provenance').length >= 1, {}, { timeout: 20000 });
  assert.equal((await lastMessage(p)).content, WHOLE);
  assert.match(await p.locator('.chat-live-provenance').last().innerText(), /ответ целиком/);
  ok('non-SSE answer is labelled as a whole response', {});
  await p.close();

  // Dead tunnel at switch-on: the scripted demo stays scripted and says so.
  resetBff(); state.up = false;
  p = await page();
  await p.waitForFunction(() => !window.BRIIX_CHAT_LIVE.active() && !document.querySelector('#chat-live-banner').hidden, {}, { timeout: 15000 });
  assert.match(await p.locator('#chat-live-banner').innerText(), /сценарными/);
  assert.equal(await p.locator('[data-action="toggle-chat-live"]').getAttribute('aria-pressed'), 'false');
  await send(p, 'Что ты умеешь?');
  await waitAssistant(p, 'complete');
  msg = await lastMessage(p);
  assert.ok(!msg.content.includes('ОТВЕТ-МОДЕЛИ'));
  assert.equal(await p.locator('.chat-live-badge').count(), 0, 'scripted answers are not labelled live');
  assert.match(await p.locator('#topbar').innerText(), /Демо без backend/);
  ok('dead tunnel keeps the scripted demo honest', { calls: state.calls.length });
  await p.close();

  // Backend marked unavailable must not switch the chat to live.
  resetBff(); state.chatReady = false;
  p = await page();
  await p.waitForFunction(() => !document.querySelector('#chat-live-banner').hidden, {}, { timeout: 15000 });
  assert.equal(await p.evaluate(() => window.BRIIX_CHAT_LIVE.active()), false);
  assert.match(await p.locator('#chat-live-banner').innerText(), /unavailable/);
  ok('catalog unavailable keeps chat scripted', {});
  await p.close();

  // 422 in chat is a polite refusal with status complete — not an error, not a retry button.
  resetBff(); state.blocked = true;
  p = await page();
  await enableLive(p);
  const callsBefore = state.calls.length;
  await send(p, 'Запрос, который сервер отклонит по политике контента.');
  await waitAssistant(p, 'complete');
  msg = await lastMessage(p);
  assert.equal(msg.status, 'complete');
  assert.match(msg.content, /Этот запрос я генерировать не буду — политика контента briix\.ru/);
  assert.ok(msg.content.includes(POLICY_MESSAGE), 'server explanation kept verbatim');
  assert.ok(!msg.liveError, 'refusal is not a live error');
  assert.equal(state.calls.length, callsBefore + 1, 'no non-stream retry after a policy verdict');
  assert.equal(await p.locator('.message-error').count(), 0);
  assert.equal(await p.locator('[data-action="regenerate"]').count(), 0, 'no "another variant" on a refusal');
  assert.match(await p.locator('.chat-policy-note').innerText(), /Проверка контента/);
  assert.equal(await p.evaluate(() => window.BRIIX_CHAT_LIVE.active()), true, 'chat stays live');
  ok('422 in chat: complete refusal, server text, no retry, live intact', {});
  await p.close();

  assert.deepEqual(errors, [], 'page errors');
  ok('no page errors', {});
  console.log('DONE', results.length, 'checks');
  for (const c of contexts) await c.close();
  await browser.close();
  staticSrv.close(); bff.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
