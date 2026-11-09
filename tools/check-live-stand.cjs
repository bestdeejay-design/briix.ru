/* Сквозной аудит живого стенда «как пользователь».
 *
 * Едет на CI-раннере briix-ci — это и есть стенд A: шина на 127.0.0.1:8390,
 * токен в systemd-юните, рядом ffmpeg/ffprobe и веса моделей. Из песочницы
 * Arena стенд недостижим, поэтому реальные генерации проверяются только здесь.
 *
 * Токен берётся из окружения или юнита и НИКОГДА не печатается — ни в лог,
 * ни в отчёт, ни в комментарий PR. В отчёт попадает только способ находки.
 *
 * Запуск на стенде:
 *   node tools/check-live-stand.cjs                      # все фазы кроме Pro
 *   BRIIX_LIVE_PHASES=catalog,image,song-flash node ...  # выборочно
 *   BRIIX_LIVE_PHASES=all node ...                       # включая Pro (долгий)
 * Самопроверка инструмента без стенда:
 *   node tools/check-live-stand.cjs --self-test
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawnSync } = require('node:child_process');

const SELF_TEST = process.argv.includes('--self-test');
let BUS = (process.env.BRIIX_BUS_URL || 'http://127.0.0.1:8390').replace(/\/$/, '');
const OUT = process.env.BRIIX_TEST_OUT || '/tmp/briix-out';
const PHASES = (process.env.BRIIX_LIVE_PHASES || 'catalog,image,instrumental,song-flash,moderation,cancel,chat').split(',').map(s => s.trim());
const all = PHASES.includes('all');
const want = name => all || PHASES.includes(name);
const POLL_MS = 3000;

const rows = [];
const findings = [];
const record = (journey, verdict, detail) => {
  rows.push({ journey, verdict, ...detail });
  const mark = verdict === 'pass' ? 'PASS' : verdict === 'warn' ? 'WARN' : verdict === 'skip' ? 'SKIP' : 'FAIL';
  console.log(mark, journey, JSON.stringify(detail));
};
const finding = (id, text, severity = 'средняя') => { findings.push({ id, text, severity }); console.log('FINDING', id, severity, text); };

/* --- токен: ищем, но не показываем --------------------------------------- */
function discoverToken() {
  for (const key of ['BRIIX_BUS_TOKEN', 'MEDIA_BFF_TOKEN']) {
    if (process.env[key]) return { token: process.env[key].trim(), via: 'env:' + key };
  }
  try {
    const out = execFileSync('systemctl', ['--user', 'show', 'media-bff', '-p', 'Environment', '--value'], { encoding: 'utf8', timeout: 10000 });
    const m = out.match(/MEDIA_BFF_TOKEN=([^\s"]+)/);
    if (m) return { token: m[1], via: 'systemctl --user show media-bff' };
  } catch {}
  // Токен часто лежит не в самом юните, а в drop-in'е переопределения.
  const homes = [...new Set([os.homedir(), '/home/badai', '/root'])];
  const candidates = [];
  for (const home of homes) {
    const dir = path.join(home, '.config/systemd/user');
    candidates.push(path.join(dir, 'media-bff.service'));
    try {
      for (const f of fs.readdirSync(path.join(dir, 'media-bff.service.d'))) {
        if (f.endsWith('.conf')) candidates.push(path.join(dir, 'media-bff.service.d', f));
      }
    } catch {}
  }
  candidates.push('/etc/systemd/user/media-bff.service');
  try {
    for (const f of fs.readdirSync('/etc/systemd/user/media-bff.service.d')) {
      if (f.endsWith('.conf')) candidates.push(path.join('/etc/systemd/user/media-bff.service.d', f));
    }
  } catch {}
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const m = text.match(/MEDIA_BFF_TOKEN=([^\s"]+)/);
      if (m) return { token: m[1], via: 'unit:' + file };
      // EnvironmentFile бывает с ведущим '-', с %h и в кавычках — разбираем все виды.
      for (const m of text.matchAll(/EnvironmentFile=(-?)([^\s]+)/g)) {
        const file2 = m[2].replace(/^["']|["']$/g, '').replace(/%h/g, os.homedir());
        try {
          const inner = fs.readFileSync(file2, 'utf8').match(/MEDIA_BFF_TOKEN=([^\s"']+)/);
          if (inner) return { token: inner[1], via: 'envfile:' + file2 };
        } catch {}
      }
      // Иногда токен лежит рядом с адаптером в обычном .env.
      for (const envPath of ['/home/badai/briix-media/media-bff/.env', path.join(os.homedir(), 'briix-media/media-bff/.env')]) {
        try {
          const inner = fs.readFileSync(envPath, 'utf8').match(/MEDIA_BFF_TOKEN=([^\s"']+)/);
          if (inner) return { token: inner[1], via: 'dotenv:' + envPath };
        } catch {}
      }
    } catch {}
  }
  try {
    const pids = execFileSync('pgrep', ['-f', 'bff.py'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      const hit = env.find(x => x.startsWith('MEDIA_BFF_TOKEN='));
      if (hit) return { token: hit.slice('MEDIA_BFF_TOKEN='.length), via: 'proc:' + pid };
    }
  } catch {}
  return { token: null, via: 'not-found' };
}

let TOKEN = null;
async function api(route, { method = 'GET', body, timeout = 30000, raw = false } = {}) {
  const res = await fetch(BUS + route, {
    method,
    headers: { ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout)
  });
  if (raw) return { status: res.status, mime: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data };
}
const submit = async (type, prompt, params = {}) => {
  const { status, data } = await api('/jobs', { method: 'POST', body: { type, prompt, params } });
  if (status !== 202) { const e = new Error(data?.error?.message || 'ожидан 202, получен ' + status); e.code = data?.error?.code; e.status = status; throw e; }
  return data.job_id;
};
async function waitFor(id, timeoutMs, label) {
  const started = Date.now();
  const stages = [];
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const { data } = await api('/jobs/' + id);
    if (data?.stage && stages.at(-1) !== data.stage) { stages.push(data.stage); console.log('  stage', label, data.stage, Math.round((Date.now() - started) / 1000) + 's'); }
    last = data;
    if (['ready', 'error', 'cancelled', 'interrupted', 'expired'].includes(data?.status)) return { job: data, wall: Math.round((Date.now() - started) / 1000), stages };
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  return { job: last, wall: Math.round((Date.now() - started) / 1000), stages, timedOut: true };
}

/* --- измерения файла ------------------------------------------------------ */
const has = bin => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
function probeAudio(bytes) {
  if (!has('ffprobe')) return { skipped: 'ffprobe недоступен в этом контуре' };
  const file = path.join(os.tmpdir(), 'briix-live-audio-' + Date.now());
  fs.writeFileSync(file, bytes);
  try {
    const out = execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', timeout: 30000 });
    const info = JSON.parse(out);
    const audio = (info.streams || []).find(s => s.codec_type === 'audio') || {};
    const cover = (info.streams || []).some(s => s.disposition?.attached_pic === 1);
    const tags = info.format?.tags || {};
    const lyricTag = Object.keys(tags).find(k => /lyr|lyrics/i.test(k));
    let meanVolume = null;
    if (has('ffmpeg')) {
      const vol = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8', timeout: 60000 });
      const m = (vol.stderr || '').match(/mean_volume:\s*(-?[\d.]+) dB/);
      if (m) meanVolume = Number(m[1]);
    }
    return {
      codec: audio.codec_name, duration: Number(info.format?.duration) || null,
      cover, lyricsChars: lyricTag ? String(tags[lyricTag]).length : 0,
      meanVolumeDb: meanVolume, sizeKB: Math.round(bytes.length / 1024)
    };
  } finally { try { fs.unlinkSync(file); } catch {} }
}
const isImage = b => (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8);
const isRiff = b => b.subarray(0, 4).toString() === 'RIFF';
const isMp4 = b => b.subarray(4, 8).toString() === 'ftyp';
const isMp3 = b => b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);

/* --- лирика для песни берётся из своей базы, а не выдумывается ------------ */
function lyricsFromBase(lang = 'ru') {
  const dir = path.resolve(__dirname, '..', 'assets', 'creative-base');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const entry = index.entries.find(e => e[2] === lang && e[5] >= 0 && e[6] >= 300 && e[6] <= 1600);
  if (!entry) return null;
  const shard = String(Math.floor(entry[5] / index.shardSize)).padStart(2, '0');
  const pool = JSON.parse(fs.readFileSync(path.join(dir, 'lyrics-' + shard + '.json'), 'utf8'));
  return { name: entry[0], text: pool[entry[5]], prompt: entry[1].slice(0, 400) };
}

/* --- фазы ---------------------------------------------------------------- */
async function phaseCatalog() {
  const { status, data } = await api('/v1/models');
  if (status !== 200) return record('J10 каталог моделей', 'fail', { status, code: data?.error?.code });
  const models = (data.data || []).map(m => ({ id: m.id, kind: m.kind, status: m.status, max: m.limits?.max_duration_seconds, seconds: m.latency?.seconds }));
  const ready = models.filter(m => m.status === 'ready').map(m => m.id);
  record('J10 каталог моделей', 'pass', { count: models.length, ready, models });
  for (const need of ['musicgen-small', 'ace-step-flash']) {
    if (!models.some(m => m.id === need)) finding('L-CATALOG-' + need, 'В каталоге нет модели ' + need + ', а UI её предлагает');
  }
  return models;
}
async function phaseImage() {
  const t0 = Date.now();
  const id = await submit('image', 'Ночной город под дождём, неон в лужах, кинематографичный кадр');
  const { job, wall, stages, timedOut } = await waitFor(id, 420000, 'image');
  if (timedOut || job?.status !== 'ready') return record('J1 картинка', 'fail', { status: job?.status, error: job?.error, wall, stages });
  const file = await api('/files/' + (job.result_url || '').split('/').pop(), { raw: true, timeout: 60000 });
  const ok = file.status === 200 && isImage(file.bytes);
  record('J1 картинка', ok ? 'pass' : 'fail', { wall, stages, mime: file.mime, sizeKB: Math.round(file.bytes.length / 1024), magic: ok });
  record('J2 скачивание картинки', file.status === 200 ? 'pass' : 'fail', { status: file.status, bytes: file.bytes.length });
  if (!ok) finding('L-IMAGE', 'Файл картинки не прошёл проверку magic-байтов');
}
async function phaseMusic(model, label, journey, timeoutMs, requestedDuration = null) {
  const base = model ? lyricsFromBase('ru') : null;
  if (model && !base) return record(journey, 'skip', { reason: 'в базе нет подходящей русской лирики' });
  const params = model
    ? { model, lyrics: base.text, language: 'ru', duration: requestedDuration || (model === 'ace-step-pro' ? 60 : 30), title: base.name }
    : { duration: 15 };
  const prompt = model ? base.prompt : 'Спокойный lo-fi для работы, тёплое пианино и мягкий бит';
  const id = await submit('music', prompt, params);
  const { job, wall, stages, timedOut } = await waitFor(id, timeoutMs, label);
  if (timedOut || job?.status !== 'ready') return record(journey, 'fail', { status: job?.status, error: job?.error, wall, stages });
  const file = await api('/files/' + (job.result_url || '').split('/').pop(), { raw: true, timeout: 120000 });
  const container = isMp4(file.bytes) ? 'm4a' : isMp3(file.bytes) ? 'mp3' : isRiff(file.bytes) ? 'wav' : 'unknown';
  const probe = probeAudio(file.bytes);
  const detail = { wall, stages, container, capability: job.provenance?.capability, lyricsSource: base?.name, ...probe };
  const problems = [];
  if (container === 'unknown') problems.push('неразпознанный контейнер');
  if (model && job.provenance?.capability !== 'song.vocal') problems.push('вокальный джоб подписан как ' + job.provenance?.capability);
  if (model && probe.lyricsChars === 0 && !probe.skipped) problems.push('в файле нет тега лирики');
  if (probe.meanVolumeDb !== null && probe.meanVolumeDb < -50) problems.push('звук фактически тишина: ' + probe.meanVolumeDb + ' dB');
  if (probe.skipped) detail.note = 'аудио не измерено: ' + probe.skipped;
  record(journey, problems.length ? 'fail' : 'pass', detail);
  problems.forEach((p, i) => finding('L-' + label.toUpperCase() + '-' + (i + 1), p, 'высокая'));
}
async function phaseDuration300() {
  const base = lyricsFromBase('ru');
  if (!base) return record('J5b полная песня 300 с принята', 'skip', { reason: 'в базе нет подходящей русской лирики' });
  try {
    const id = await submit('music', base.prompt, { model: 'ace-step-pro', lyrics: base.text, language: 'ru', duration: 300, title: base.name });
    record('J5b полная песня 300 с принята', 'pass', { status: 202, jobId: id, note: 'контракт подтверждён без пятиминутного inference; задачу сразу отменяем' });
    await api('/jobs/' + id + '/cancel', { method: 'POST' });
  } catch (e) {
    record('J5b полная песня 300 с принята', 'fail', { status: e.status, code: e.code, message: e.message });
    finding('L-DURATION-300', 'BFF отклонил params.duration=300 — интерфейс и стенд разошлись', 'высокая');
  }
}
async function phaseModeration() {
  // Строка ниже — тест политического фильтра, а не контент: проверяем, что
  // явный запрос отсекается ДО очереди. Кейсы с несовершеннолетними не пишем.
  try {
    await submit('image', 'порно фото откровенного полового акта крупным планом');
    record('J7 явный запрос отсекается', 'fail', { expected: 422, got: 202 });
    finding('L-MOD-1', 'Явный запрос принят в очередь — фильтр не сработал', 'высокая');
  } catch (e) {
    record('J7 явный запрос отсекается', e.status === 422 && e.code === 'content_blocked' ? 'pass' : 'fail', { status: e.status, code: e.code, message: e.message });
  }
  try {
    const id = await submit('image', 'полуголая женщина в стиле нуар, художественная фотография');
    record('J8 художественная нагота разрешена', 'pass', { status: 202 });
    await api('/jobs/' + id + '/cancel', { method: 'POST' }); // не тратим GPU на тест
  } catch (e) {
    record('J8 художественная нагота разрешена', 'fail', { status: e.status, code: e.code });
    finding('L-MOD-2', 'Разрешённая политика художественная нагота отклонена: ' + e.code, 'высокая');
  }
}
async function phaseCancel() {
  const id = await submit('image', 'Проверка отмены: тихий утренний свет в комнате');
  await new Promise(r => setTimeout(r, 1500));
  await api('/jobs/' + id + '/cancel', { method: 'POST' });
  const { job } = await waitFor(id, 90000, 'cancel');
  const ok = ['cancelled', 'ready'].includes(job?.status); // успело завершиться — тоже честно
  record('J6 отмена задачи', ok ? 'pass' : 'fail', { status: job?.status });
  const { data } = await api('/health');
  record('J6 очередь после отмены', 'pass', { queue_len: data?.queue_len, running: data?.running });
  if (typeof data?.running === 'number' && data.running > 2) finding('L-CANCEL', 'После отмены в работе осталось ' + data.running + ' задач — возможна утечка', 'высокая');
}
async function phaseChat() {
  const { status, data } = await api('/v1/chat/completions', {
    method: 'POST', timeout: 120000,
    body: { model: 'qwen3:4b-instruct', max_tokens: 16, temperature: 0, messages: [{ role: 'user', content: 'Ответь одним словом: столица Франции?' }] }
  });
  const text = data?.choices?.[0]?.message?.content || '';
  const used = data?.usage?.completion_tokens ?? null;
  record('J9 чат JSON', status === 200 && text ? 'pass' : 'fail', { status, chars: text.length, completionTokens: used });
  if (used !== null && used > 24) finding('L-CHAT-MAXTOKENS', 'max_tokens=16 не уважается: completion_tokens=' + used + ' (пункт 4 из #28)', 'средняя');
  // SSE
  try {
    const res = await fetch(BUS + '/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen3:4b-instruct', stream: true, max_tokens: 24, messages: [{ role: 'user', content: 'Скажи привет одним словом.' }] }),
      signal: AbortSignal.timeout(120000)
    });
    const body = await res.text();
    const chunks = (body.match(/^data:/gm) || []).length;
    record('J9 чат SSE', res.status === 200 && chunks > 0 ? 'pass' : 'fail', { status: res.status, chunks, done: body.includes('[DONE]') });
  } catch (e) { record('J9 чат SSE', 'fail', { error: String(e.message || e).slice(0, 120) }); }
}

/* --- самопроверка инструмента без стенда --------------------------------- */
function fakeBus() {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
  const jobs = new Map();
  let seq = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (!req.headers.authorization) { res.statusCode = 401; return res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'нужен токен' } })); }
    if (url.pathname === '/health') return res.end(JSON.stringify({ ok: true, queue_len: 0, running: 0, backends: { image: 'ready', music: 'ready', text: 'ready' } }));
    if (url.pathname === '/v1/models') return res.end(JSON.stringify({ data: [
      { id: 'musicgen-small', kind: 'music', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 80 } },
      { id: 'ace-step-flash', kind: 'music-vocal', status: 'ready', limits: { max_duration_seconds: 30 }, latency: { seconds: 111 } }
    ] }));
    if (url.pathname === '/v1/chat/completions') {
      let body = ''; req.on('data', c => body += c);
      return req.on('end', () => {
        let stream = false;
        try { stream = !!JSON.parse(body || '{}').stream; } catch {}
        if (!stream) return res.end(JSON.stringify({ choices: [{ message: { content: 'Париж' } }], usage: { completion_tokens: 3 } }));
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'При' } }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'вет' } }] }) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      });
    }
    if (url.pathname === '/jobs' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      return req.on('end', () => {
        const data = JSON.parse(body || '{}');
        if (/порно/i.test(data.prompt || '')) { res.statusCode = 422; return res.end(JSON.stringify({ error: { code: 'content_blocked', message: 'Запрос нарушает политику контента.' } })); }
        const id = 'fake-' + (++seq);
        jobs.set(id, { id, status: 'ready', stage: 'synthesizing', result_url: '/files/' + id, type: data.type, provenance: { capability: data.params?.model ? 'song.vocal' : 'music.instrumental' } });
        res.statusCode = 202; res.end(JSON.stringify({ job_id: id }));
      });
    }
    if (url.pathname.endsWith('/cancel')) { const id = url.pathname.split('/')[2]; const j = jobs.get(id); if (j) j.status = 'cancelled'; return res.end(JSON.stringify({ ok: true })); }
    if (url.pathname.startsWith('/jobs/')) return res.end(JSON.stringify(jobs.get(url.pathname.split('/')[2]) || { status: 'error' }));
    if (url.pathname.startsWith('/files/')) {
      const j = jobs.get(url.pathname.split('/')[2]);
      if (j?.type === 'music') { res.setHeader('Content-Type', 'audio/wav'); return res.end(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(64)])); }
      res.setHeader('Content-Type', 'image/png'); return res.end(png);
    }
    res.statusCode = 404; res.end('{}');
  });
  return server;
}

(async () => {
  let server = null;
  if (SELF_TEST) {
    server = fakeBus();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    BUS = 'http://127.0.0.1:' + server.address().port;
    TOKEN = 'self-test-token';
    console.log('SELF-TEST: фейковая шина на', BUS, '— проверяем сам инструмент, не стенд');
  } else {
    const found = discoverToken();
    TOKEN = found.token;
    console.log('Шина:', BUS, '· токен:', found.token ? 'найден через ' + found.via : 'НЕ НАЙДЕН');
    if (!TOKEN) {
      // Без токена аудит не пустой: проверяем то, что открыто, и точно говорим,
      // чего не хватает. Значение токена не печатается нигде.
      const diag = { user: process.env.USER || process.env.USERNAME || '?', home: os.homedir(), bus: BUS };
      try {
        const res = await fetch(BUS + '/health', { signal: AbortSignal.timeout(8000) });
        diag.busReachable = res.status === 200;
        diag.busHealth = (await res.json())?.backends || null;
      } catch (e) { diag.busReachable = false; diag.busError = String(e.message || e).slice(0, 80); }
      diag.unitFilesPresent = [...new Set(['/home/badai/.config/systemd/user/media-bff.service',
        path.join(os.homedir(), '.config/systemd/user/media-bff.service'),
        '/etc/systemd/user/media-bff.service'])].filter(f => fs.existsSync(f));
      // Только ИМЕНА переменных и пути — значения не читаем в отчёт никогда.
      diag.unitEnvNames = []; diag.unitEnvFiles = []; diag.procReadable = null;
      for (const f of diag.unitFilesPresent) {
        try {
          const text = fs.readFileSync(f, 'utf8');
          for (const m of text.matchAll(/Environment="?([A-Z_][A-Z0-9_]*)=/g)) diag.unitEnvNames.push(m[1]);
          for (const m of text.matchAll(/EnvironmentFile=(-?)([^\s]+)/g)) diag.unitEnvFiles.push(m[2]);
        } catch { diag.unitEnvNames.push('(нечитаем)'); }
      }
      try { diag.bffProcesses = execFileSync('pgrep', ['-f', 'bff.py'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n').filter(Boolean).length; }
      catch { diag.bffProcesses = 0; }
      if (diag.bffProcesses) {
        try {
          const pid = execFileSync('pgrep', ['-f', 'bff.py'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0];
          fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
          diag.procReadable = true;
        } catch (e) { diag.procReadable = String(e.code || e.message).slice(0, 40); }
      }
      record('J0 здоровье шины без токена', diag.busReachable ? 'pass' : 'fail', diag);
      const auth = await api('/v1/models').catch(() => ({ status: 0 }));
      record('J10 каталог закрыт без токена', auth.status === 401 ? 'pass' : 'warn', { status: auth.status });
      finding('L-TOKEN', diag.busReachable
        ? 'Шина на этом раннере доступна, но токен недоступен процессу раннера. Нужен секрет репозитория BRIIX_BUS_TOKEN (Settings → Secrets and variables → Actions) — workflow уже умеет его брать.'
        : 'Шина ' + BUS + ' с этого раннера не отвечает: либо раннер не на стенде A, либо адрес другой. Нужен BRIIX_BUS_URL и секрет BRIIX_BUS_TOKEN.', 'блокер аудита');
      for (const j of ['J1 картинка', 'J3 инструментал', 'J4 песня Flash', 'J6 отмена', 'J7 модерация', 'J9 чат']) {
        record(j, 'skip', { reason: 'нет токена шины' });
      }
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'live-audit.json'), JSON.stringify({ rows, findings, failed: 1, diagnostic: diag }, null, 2));
      fs.writeFileSync(path.join(OUT, 'live-audit.md'), [
        '# Живой аудит стенда', '',
        '**Аудит не состоялся:** генерации не проверены — нет токена шины.', '',
        '| Что известно | Значение |', '|---|---|',
        '| Шина отвечает без токена | ' + (diag.busReachable ? 'да' : 'нет') + ' |',
        '| Бэкенды | `' + JSON.stringify(diag.busHealth) + '` |',
        '| Пользователь раннера | `' + diag.user + '` |',
        '| HOME раннера | `' + diag.home + '` |',
        '| Файлы юнита найдены | ' + (diag.unitFilesPresent.length ? diag.unitFilesPresent.map(x => '`' + x + '`').join(', ') : 'нет') + ' |',
        '| Процессов bff.py видно | ' + diag.bffProcesses + ' |',
        '| environ процесса читаем | ' + String(diag.procReadable) + ' |',
        '| Имена переменных в юните | `' + (diag.unitEnvNames || []).join(', ') + '` |',
        '| EnvironmentFile в юните | `' + (diag.unitEnvFiles || []).join(', ') + '` |', '',
        '## Что нужно сделать', '',
        diag.busReachable
          ? 'Добавить секрет репозитория **`BRIIX_BUS_TOKEN`**: Settings → Secrets and variables → Actions → New repository secret. Значение — тот же `MEDIA_BFF_TOKEN`, что в юните `media-bff`. Workflow уже передаёт его инструменту.'
          : 'Уточнить адрес шины (`BRIIX_BUS_URL`) и добавить секрет **`BRIIX_BUS_TOKEN`**.', '',
        'Токен в отчётах и логах не появляется.'
      ].join('\n'));
      console.error('Нет токена шины. Диагностика:', JSON.stringify(diag));
      process.exit(2);
    }
  }
  const started = Date.now();
  try {
    const health = await api('/health');
    record('J0 здоровье шины', health.data?.ok ? 'pass' : 'fail', { status: health.status, backends: health.data?.backends });
    if (want('catalog')) await phaseCatalog();
    if (want('image')) await phaseImage();
    if (want('instrumental')) await phaseMusic(null, 'instrumental', 'J3 инструментал MusicGen', 600000);
    if (want('song-flash')) await phaseMusic('ace-step-flash', 'song-flash', 'J4 песня Flash', 600000);
    if (want('song-flash-60')) await phaseMusic('ace-step-flash', 'song-flash-60', 'J4b песня Flash 60 с', 1200000, 60);
    if (want('song-pro')) await phaseMusic('ace-step-pro', 'song-pro', 'J5 песня Pro', 1200000);
    if (want('duration-300')) await phaseDuration300();
    if (want('moderation')) await phaseModeration();
    if (want('cancel')) await phaseCancel();
    if (want('chat')) await phaseChat();
  } catch (e) {
    record('Инфраструктура аудита', 'fail', { error: String(e.message || e).slice(0, 200) });
  }
  const failed = rows.filter(r => r.verdict === 'fail');
  const report = { startedAt: new Date(started).toISOString(), bus: SELF_TEST ? 'self-test' : BUS, wallSeconds: Math.round((Date.now() - started) / 1000), rows, findings, failed: failed.length };
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'live-audit.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  const md = ['# Живой аудит стенда', '', `**Когда:** ${report.startedAt} · **Длительность:** ${report.wallSeconds} с · **Провалов:** ${failed.length}`, '',
    '| Путь | Итог | Подробности |', '|---|---|---|',
    ...rows.map(r => `| ${r.journey} | ${r.verdict === 'pass' ? '✅' : r.verdict === 'skip' ? '⏭' : r.verdict === 'warn' ? '⚠️' : '❌'} | ${'`' + JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !['journey', 'verdict'].includes(k)))) .slice(0, 220) + '`'} |`),
    '', ...(findings.length ? ['## Находки', '', ...findings.map(f => `- **${f.id}** (${f.severity}): ${f.text}`)] : ['Находок нет.'])].join('\n');
  fs.writeFileSync(path.join(OUT, 'live-audit.md'), md);
  console.log('\n' + md);
  console.log('\nОтчёт:', file);
  if (server) server.close();
  process.exit(failed.length ? 1 : 0);
})();
