/* Сборка творческой базы для раздела «Музыка».
 *
 * Источник — собственная галерея владельца DJ1: репозиторий bestdeejay-design/dj1,
 * файл data/tags-data.json (экспорт треков с полями sound = промпт и lyrics = текст).
 * Nothing is invented here: скрипт только переупаковывает то, что уже есть в базе.
 *
 * Зачем переупаковка: исходник весит 25 МБ, телефону столько качать нельзя.
 * На выходе — лёгкий индекс промптов и отдельные шарды лирики, которые
 * подгружаются по одному, только когда текст действительно понадобился.
 *
 * Запуск:
 *   gh api repos/bestdeejay-design/dj1/git/blobs/<sha> --jq .content | tr -d '\n' | base64 -d > /tmp/dj1-tags.json
 *   node tools/build-creative-base.cjs /tmp/dj1-tags.json
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SOURCE_REPO = 'bestdeejay-design/dj1';
const SOURCE_PATH = 'data/tags-data.json';
const SHARD_SIZE = 200; // уникальных текстов на шард ≈ 230 КБ
const OUT = path.resolve(__dirname, '..', 'assets', 'creative-base');

const input = process.argv[2];
if (!input) { console.error('Укажите путь к выгрузке tags-data.json'); process.exit(1); }
const raw = fs.readFileSync(input);
const data = JSON.parse(raw);
const tracks = Object.values(data.tracks || {}).filter(t => t && typeof t === 'object');
if (!tracks.length) { console.error('В выгрузке нет треков'); process.exit(1); }

const cyrillic = s => (s.match(/[а-яё]/gi) || []).length;
const latin = s => (s.match(/[a-z]/gi) || []).length;
function languageOf(lyrics) {
  const body = String(lyrics || '').replace(/\[[^\]]*\]/g, '');
  const ru = cyrillic(body), en = latin(body);
  if (ru < 40 && en < 40) return 'x';
  return ru > en ? 'ru' : 'en';
}

// Лирику дедуплицируем: в галерее много вариантов одного текста, а подсказка
// должна давать разные варианты, а не пять копий подряд.
const lyricsPool = [];
const lyricsId = new Map();
const entries = [];
for (const t of tracks) {
  const sound = String(t.sound || '').trim();
  const lyrics = String(t.lyrics || '').trim();
  if (!sound && !lyrics) continue;
  let lid = -1;
  if (lyrics) {
    if (!lyricsId.has(lyrics)) { lyricsId.set(lyrics, lyricsPool.length); lyricsPool.push(lyrics); }
    lid = lyricsId.get(lyrics);
  }
  entries.push([
    String(t.name || '').trim().slice(0, 120),
    sound.slice(0, 1400),
    languageOf(lyrics),
    Number(t.plays) || 0,
    Number(t.favorites) || 0,
    lid,
    lyrics.length
  ]);
}
// Популярные и любимые владельцем записи — раньше в подсказках при равном совпадении.
entries.sort((a, b) => (b[3] + b[4] * 8) - (a[3] + a[4] * 8));

const provenance = {
  repo: SOURCE_REPO,
  path: SOURCE_PATH,
  sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  sourceGeneratedAt: data.generatedAt || null,
  sourceTotalTracks: data.totalTracks || null,
  builtAt: new Date().toISOString().slice(0, 10),
  note: 'Промпты и лирика взяты из личной базы владельца без изменений; изменена только упаковка.'
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const write = (name, value) => {
  const text = JSON.stringify(value);
  fs.writeFileSync(path.join(OUT, name), text);
  return Buffer.byteLength(text);
};

let bytes = write('index.json', { v: 1, fields: ['name', 'sound', 'lang', 'plays', 'favorites', 'lyricId', 'lyricLen'], shardSize: SHARD_SIZE, source: provenance, entries });
const shards = Math.ceil(lyricsPool.length / SHARD_SIZE);
for (let i = 0; i < shards; i++) {
  const chunk = {};
  for (let j = i * SHARD_SIZE; j < Math.min(lyricsPool.length, (i + 1) * SHARD_SIZE); j++) chunk[j] = lyricsPool[j];
  bytes += write('lyrics-' + String(i).padStart(2, '0') + '.json', chunk);
}
const ru = entries.filter(e => e[2] === 'ru').length;
console.log(JSON.stringify({
  entries: entries.length, uniqueLyrics: lyricsPool.length, shards, russian: ru,
  totalMB: +(bytes / 1e6).toFixed(2), indexMB: +(fs.statSync(path.join(OUT, 'index.json')).size / 1e6).toFixed(2),
  avgShardKB: Math.round((bytes - fs.statSync(path.join(OUT, 'index.json')).size) / shards / 1000)
}, null, 2));
