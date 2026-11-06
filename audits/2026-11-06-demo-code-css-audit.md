# Аудит кода и CSS: демо BRIIX + Медиа-студия

**Дата:** 06.11.2026; финальные прогоны — 07.11.2026.  
**Область изменений:** `index.html`, `demo.js`, `demo.css`, `media.js`, `media.css`, `assets/media/`, `tools/`.  
**Только аудит, без правок:** `site/`, `ai-platform*`, `docs/`, старые отчёты в `audits/`.  
**Вердикт:** scoped-демо проходит функциональные, визуальные, доступностные и статические проверки. Остаточные ограничения перечислены ниже и не скрыты.

## 1. Что исправлено

| Зона | Проблема / риск | Решение | Проверка |
|---|---|---|---|
| Импорт/экспорт | Некорректные поля могли ломать состояние; временные данные попадали в экспорт | Нормализация и лимиты `validateState`, durable-экспорт без ephemeral-диалогов и черновиков | `import normalization`, `durable export excludes ephemeral` |
| Повреждённый storage | Молчаливая перезапись повреждённых данных | Баннер, защита от записи, явная очистка; сброс recovery-flags после загрузки | `corrupt storage protected until explicit clear`, media recovery |
| Черновики и вкладки | Потеря черновика при переходе; cross-tab clobber | Flush на hashchange/pagehide, guard against stale remote state, toast только если запись реально сохранена | `draft flush and cross-tab guard` |
| Отправка/стрим | Двойной Enter создавал два сообщения; стрим терялся при навигации | Pending-send guard, stream holder, pause-on-render, корректная остановка/повтор | `pending-send guard`, `stream holder across navigation` |
| Варианты ответа | `regenerate` мог превысить лимит variant, хотя import его ограничивал | Guard `variant >= 10000` до создания нового варианта | `regenerate variant cap` |
| Фокус и навигация | Modal focus race, skip link менял route; в старом `main` смена темы из хедера рендерила экран настроек на любом маршруте | Версионированный modal focus, skip link без route change, theme route guard: header toggle меняет тему на месте, settings перерисовываются только если пользователь уже в настройках; ссылка-шестерёнка ведёт в настройки | `modal version focus guard`, `skip link`, `theme route guard and settings focus`, `header theme toggle stays on route` |
| Markdown/код | Raw HTML и malformed copy-code могли бросать ошибку | Escape-first markdown, только известные теги, guard decodeURIComponent | `markdown escaping and copy-code guard` |
| Контраст | `--faint`, warning banner, code head, media label не проходили axe | Токены и solid backgrounds; `--warning:#805b20` даёт 5.38 на `#f7f0df` | axe light/dark, `code header contrast`, `populated image label contrast` |
| Motion/print/hover | Универсальный reduced-motion ломал переходы; print-токены и hover-only состояния | Scoped reduced-motion без глобального transition-duration, print tokens, hover/focus polish | `reduced motion and axe`, CSS parse |
| Медиа-очередь | Retry мог обойти capacity; toast обещал сохранение при недоступном storage | `trimCapacity()` на submit и retry, persist-aware toast, bounded eviction с защитой favorites/active | `active limit`, `bounded eviction`, `retry capacity remains reloadable` |
| Видео CSS | Portrait video как grid item раздувал track: mobile frame 354×300, video 354×629.33 | Video absolute/inset/100%/object-fit contain; detail media fixed height, label не перекрывает controls | `check-media-visual`: video ≤ frame на desktop/mobile, modal geometry stable до/после play |
| Скачивание | Несоответствие формата и фактического кропа | Canvas center-crop для фото, готовый MP4/WebM для видео, fallback source | 4 image ratios + 2 video ratios + WebM fallback |

## 2. Результаты проверок

### Browser regression

- `tools/check-demo.cjs`: **20 PASS**. Маршруты home/assistants/prompts/favorites/settings/media/chat; light/dark; header theme toggle проверен на месте для каждого маршрута; axe violations `[]` на 7 маршрутах × 2 темы; reduced-motion animation `none`; no page errors; no external requests.
- `tools/check-media.cjs`: **25 PASS**. Валидация брифа/референсов, фото/видео, скачивание, WebM fallback, медиатека, экспорт/удаление, ошибка/retry/cancel, reload recovery, capacity/eviction, corrupt storage, keyboard tabs, modal focus/escape, axe на 390/1440 × create/library/queue/models; no page errors/external requests.
- `tools/check-media-visual.cjs`: все **12 MP4/WebM** загрузили metadata, duration 5 s; desktop frame/video 629.20×365, mobile frame/video 354×300; horizontal overflow false; dark/mobile axe `[]`; modal video geometry не меняется после play; errors/external `[]`.

Скачанные изображения проверены по фактическим размерам: 365×365, 292×365, 629×354, 205×365. Видео скачивается как готовый локальный файл; MP4 и WebM воспроизводятся в Chromium.

JSON-доказательства: `evidence/2026-11-06-demo-regression.json`, `evidence/2026-11-06-media-regression.json`, `evidence/2026-11-06-media-visual.json`.

### Статические проверки

- `node --check`: demo/data/media/tools/site JS — OK.
- ESLint demo/data/media/tools: **0 problems**.
- ESLint `site/assets/js` только для отчёта: `theme.js:25,45` — `no-empty` errors; `landing.js:138` — unused `template` warning. Файлы сайта не изменялись.
- tinycss2: `demo.css` 395 rules, `media.css` 173 rules, `site/assets/css/main.css` 592 rules; parse errors 0, braces balanced. Evidence: `evidence/2026-11-06-css-check.json`.
- Scan out-of-token colors: чисто. Conflict markers: нет.
- Runtime network scan: в demo/media/data нет `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, dynamic `import()`; browser harness подтвердил отсутствие внешних запросов.
- Local links: `index.html` — 7 ссылок, bad 0; ссылки media.js на отчёты существуют; media assets проверены manifest/build.

### Ассеты

- `tools/build-media-assets.py --check`: OK, 15 файлов, около 1.94 MiB.
- Manifest schema 1: имена, размеры, SHA-256, codec, fps, frames, audio flag, tool versions.
- Повторная сборка: все 15 SHA-256 unchanged.
- Unit smoke для `normalize_jpeg`: маленький upright RGB JPEG копируется байт-в-байт; большой уменьшается до 1400 px; EXIF orientation применяется.

## 3. Остаточные ограничения

1. **Это мок, не inference.** Видео — ffmpeg pan/zoom из неподвижного кадра; фото не являются результатом указанной модели. Интерфейс маркирует это явно.
2. **localStorage не durable storage.** Очистка браузера, приватный режим и квоты могут удалить данные; экспорт JSON — пользовательская копия.
3. **Multi-tab media:** используется last-writer semantics; полноценная синхронизация/блокировки не реализованы. Demo workspace имеет cross-tab guard, но это не распределённая БД.
4. **Browser coverage:** автоматизация выполнена в Chromium. Реальные Safari/Firefox, мобильные устройства и assistive tech требуют отдельного ручного прогона.
5. **Site lint:** две `no-empty` ошибки и один warning в read-only `site/` оставлены как находки, не исправлялись в этой задаче.
6. **AGENTS.md:** содержит устаревшие пути проверок `assets/js|css`; фактические root demo files проверены адаптированными командами. Сам AGENTS.md не переписывался.
7. **Внешние провайдеры:** каталог моделей не подключён; цены/лицензии/региональная доступность требуют ручной сверки перед production.

## 4. Как повторить

```bash
python3 -m http.server 3000 --bind 0.0.0.0

export BRIIX_URL=http://127.0.0.1:3000
export NODE_PATH=/tmp/briix-tools/node_modules
export BRIIX_CHROMIUM=/tmp/chromium

node tools/check-demo.cjs
node tools/check-media.cjs
node tools/check-media-visual.cjs

PYTHONPATH=/tmp/briix-py python3 tools/build-media-assets.py --check --ffmpeg /path/to/ffmpeg
```

`BRIIX_TEST_OUT` задаёт каталог артефактов; по умолчанию используется системный temp. Скриншоты и JSON не попадают в рабочую страницу.
