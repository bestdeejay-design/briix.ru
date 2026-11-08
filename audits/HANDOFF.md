# ХЕНДОФ BRIIX — передача в новую сессию

Документ для следующего исполнителя: что просит владелец, что уже сделано, что не сделано,
какие факты о стенде подтверждены и на какие грабли не наступать. Всё ниже проверено по
репозиторию и по отчётам CI, а не по памяти.

---

## 0. Состояние репозитория

- Репозиторий `bestdeejay-design/briix.ru`, рабочая копия `/home/user/briix.ru`.
- **`main` = `c71bca0`** — «Merge pull request #52 from int-49». Вся предыдущая работа влита
  (проверено по содержимому: `paintStreamingMessage`, `SIMPLE_MODES`, `generateFromBrief`,
  сюиты `check-chat-typing` / `check-simple-chat` / `check-simple-generate` на месте).
  Старые SHA не являются предками `main`: история сведена интеграционным коммитом — это нормально.
- Смерджены: **#42, #43, #45, #47, #48, #49, #50, #51, #52**.
- Git identity: `bestdeejay-design <243793979+bestdeejay-design@users.noreply.github.com>`.

---

## 1. ЗАДАЧА: что просит владелец

Дословно, последними сообщениями:

> «наш помощник сам решит что добавить или убрать, он же спец… напишет пользователь в чат:
> **хочу современную песню про любовь** — и наш помощник должен всё сделать сам:
> и лирику подобрать, и музыкальный промпт, и отправить генерацию»

> «так же и про картинку… можно выбрать сразу музыканта, а можно дизайнера? а можно просто
> в чате что хочет… и у пользователя в чате и в его пространстве лежат все его генерации…
> он хочет просто картинку… мобильная версия должна быть максимально простой и свободной»

**Суть:** не «чат + переключатели режимов», а **помощник-специалист, который выполняет работу
целиком**. Пользователь выражает желание обычными словами — дальше специалист сам решает
параметры, готовит лирику/промпт, отправляет генерацию и приносит результат. Правки — тоже
словами в чате. Сильный интерфейс = умеет много, требует мало.

### Критерии приёмки

1. Фраза «хочу современную песню про любовь» → продюсер сам пишет лирику, составляет музыкальный
   промпт, выбирает **Pro** и длительность, отправляет job, показывает статус и **готовое аудио в ленте**.
2. Фраза «сделай картинку: …» → дизайнер сам готовит промпт и параметры, генерирует, показывает
   изображение в ленте.
3. Помощника можно выбрать явно (музыкант / дизайнер), **а можно не выбирать** — система определит сама.
4. Правки в чате («женский вокал», «убери людей», «сделай вертикальной») создают следующую версию
   **без повторного заполнения**.
5. Все работы пользователя — в едином пространстве («Мои работы»), независимо от чата;
   из работы виден исходный диалог.
6. Мобильный экран: диалог, поле, результаты. Подробные настройки — **отдельно и необязательны**.
7. Никакой тихой подмены: Pro ≠ Flash, live ≠ мок. Отказ сервера объясняется человеческим языком.
8. **Веб-версия не ломается.** Честные маркировки остаются видимыми.

---

## 2. Что уже есть — не переделывать

- **Тряска чата устранена** (#49): `paintStreamingMessage()` рисует только тело ответа; за потоком
  следуем лишь при `readerAtBottom() && !composerBusy()`; полная пересборка сохраняет черновик,
  каретку и прокрутку. Замеры: размах поля **0 px**, прокрутка 782→782 (было 1335→1671, +336 px за 1,8 с).
- **Безголовая генерация** (работает без открытого раздела):
  `window.BRIIX_MUSIC.generate(params)`, `.track(id)`, `.audioUrl(id)`;
  `window.BRIIX_MEDIA.generate(params)`, `.job(id)`, `.resultUrl(id)`.
- **Мобильный чат**: чип «что делаем» (`SIMPLE_MODES`: text/image/music/song), меню `#mode-menu`,
  карточки `.gen-card` в ленте, `state.generations` (валидируется в `validateState`).
- **База DJ1**: `window.BRIIX_MUSIC_BASE` (`load / ready / stats / match / pick / search / byId /
  lyrics / enrichPrompt / label / sourceLabel`). `assets/creative-base/index.json` —
  **8202 записи, 1487 ru**, 31 шард лирики, ~11 МБ. Источник: `bestdeejay-design/dj1`,
  `data/tags-data.json` (в источнике 9705 треков), собрано 2026-11-08.
  Пересборка: `node tools/build-creative-base.cjs /tmp/dj1-tags.json`.
- **Витрина GPU-матрицы**: `assets/media/showcase/manifest.json` + 13 файлов в `matrix/`.

---

## 3. Чего НЕТ — главный разрыв

| Что | Реальность в коде |
|---|---|
| Помощник-исполнитель | `producer` в `demo-data.js` даёт **сценарный текст-бриф** и отправляет в раздел. Цикла «сам сделал → отправил» нет |
| Дизайнер | **Отсутствует.** Помощники: universal, editor, analyst, developer, marketer, mentor, producer |
| Pro из чата | `startGeneration` вызывает `BRIIX_MUSIC.generate({prompt, kind, lyrics, language})` — **без `vocalMode` и `duration`** → уходит **Flash, 30 с** |
| Лирика | «Автолирика» = **поиск готового текста в базе**, а не сочинение под запрос |
| Единое пространство | Три независимых хранилища: `briix-workspace-v2`, `briix-music-v1`, `briix-media-v1`. Общей ленты работ нет |
| Приёмка на реальной GPU | Гонялись мок и фейковый BFF. Сквозного «телефон → Pro → файл» не было |

---

## 4. Живой стенд: подтверждённые факты

**Аудит 2026-11-08 17:57 UTC** (отчёт в issue **#46**, длительность 977 с, 1 провал).
Токен найден автоматически: `dotenv:/home/badai/briix-media/media-bff/.env` —
**секрет `BRIIX_BUS_TOKEN` больше не блокер**.

Каталог `/v1/models` — **все 5 моделей `ready`**:

| Модель | max, с | замер, с |
|---|---|---|
| `flux-2-klein-4b` (картинка) | 480 | 261 |
| `musicgen-small` | 420 | 80 |
| `ace-step-flash` | 30 | 111 |
| **`ace-step-pro`** | **150** | **596** |
| `qwen3:4b-instruct` (текст) | 180 | — |

Реально сгенерировано в том прогоне: картинка PNG 698 КБ за 237 с; инструментал m4a за 303 с;
**песня Flash** m4a за 261 с; модерация 422 / 202 корректна; отмена работает, очередь после отмены пуста.

**Два важных хвоста:**

- **`J9 чат SSE` — FAIL (timeout).** Единственный провал прогона. Подозрение на B4
  (CORS-заголовки выставляются после `resp.prepare`). Не исследовано.
- **Фаза `song-pro` не входит в дефолтные фазы** workflow
  (`catalog,image,instrumental,song-flash,moderation,cancel,chat`) — **автоматикой Pro ни разу не гонялся**.
  Запуск вручную: `workflow_dispatch` → `phases=song-pro`.

**Но Pro точно работает:** в репозитории лежат реальные треки GPU B —
`matrix/R05-pro-ru150-room7.m4a` (**150 с**), `R04-pro-ru60-bridge.m4a`, `14-pro-en-lowsling.m4a`,
`16-pro-en-eveningyard.m4a`, лирика в тегах.
**Вывод: проблема не в модели, а в пути до неё из интерфейса.**

Прочее о стенде: шина aiohttp на `:8390`, раннер `briix-ci` = стенд A, пользователь `badai`;
`THREAD_BUDGET=8`, `TEXT_BUDGET=4`, retention 24 ч. Результат — M4A AAC 192k с `covr` и `©lyr`.
Модерация: regex → 422 за мс, серая зона → qwen3 (`:11436`, fail-open), художественная нагота разрешена.

---

## 5. Техническая карта

**Файлы:** `demo.js` (чат, композер, `startGeneration`, `generationCard`), `demo-data.js` (помощники),
`music.js` (`VOCAL_MODES`, форма, `generateFromBrief`), `music-live.js` (маршрут вокала),
`media.js`, `bus-live.js` (транспорт), `music-base.js`, `chat-live.js`.

**Контракт шины:**

- `POST /jobs {type, prompt, params}` → `job_id`; `GET /jobs/{id}`; `GET /files/{id}`;
  отмена `POST /jobs/{id}/cancel`.
- Вокал: `type:'music'`, `params:{model:'ace-step-pro', lyrics, language:'ru'|'en', duration}`.
  Лирика обязательна, теги `[intro] [verse] [chorus] [bridge] [outro]`.
- Инструментал: `params:{duration}`. Картинка: `type:'image'`.
- Адрес: на опубликованном сайте — `location.origin + '/api'`; локально — `http://127.0.0.1:8300`.

**Ключи хранилища:** `briix-workspace-v2`, `briix-music-v1`, `briix-media-v1`,
`briix-media-live-token`, `briix-media-live-server`, `briix-live-off-v1`.

**Селекторы:** чат — `#prompt-input`, `#send-button`, `.chat-composer-wrap`, `[data-message-id]`,
`.gen-card`, `.mode-select`, `#mode-menu`; музыка — `#music-prompt`, `#music-lyrics`, `#music-generate`,
`[data-music-action="vocal-mode"][data-id="pro"]`, `[data-music-action="duration"][data-id="150"]`.
Маршрут чата: `#/chat/example-coffee` (**`#/chat` без id не рендерит композер**).

---

## 6. Окружение и тесты

Окружение **не переживает пересоздание песочницы** — поднимать заново:

```bash
mkdir -p /home/user/briix-tools && cd /home/user/briix-tools
npm i playwright @axe-core/playwright @sparticuz/chromium
# brotli: al2023.tar.br → /tmp/al2023, swiftshader.tar.br → /tmp, chromium → /tmp/chromium
```

Статик-сервер на **8320** (`start_process`, bind `0.0.0.0`). Прогон сюиты:

```bash
cd /home/user/briix.ru && export NODE_PATH=/home/user/briix-tools/node_modules \
 LD_LIBRARY_PATH=/tmp/al2023/lib:/tmp BRIIX_CHROMIUM=/tmp/chromium \
 BRIIX_CHROMIUM_ARGS='["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]' \
 BRIIX_TEST_OUT=/tmp/briix-out BRIIX_URL=http://127.0.0.1:8320
node tools/check-<suite>.cjs
```

Гейт CI (`.github/workflows/demo-ci.yml`):
`media music demo media-live music-live chat-live music-typing music-base chat-typing simple-generate simple-chat`
плюс расширенные `live-default wait-phrases showcase published-mode`.
Последнее известное состояние — всё зелёное, `mobile-ui` 16 экранов `FINDINGS {}`.

---

## 7. Грабли — не наступать повторно

- **Коммиты без push теряются.** После мержа PR пуши в ту же ветку workflow не запускают — нужен новый PR.
- Песочница может умереть на долгом ожидании; не строить план на многочасовом polling —
  CI отчитается в issue сам.
- Сеть ограничена (`github`, `npm`, `pypi`). **`demo.briix.ru` из bash недостижим** —
  реальные генерации только на раннере `briix-ci`.
- На раннере **нет `gh`** (только curl + python3), **нет ffprobe/ffmpeg**, `systemctl --user` не работает.
- `continue-on-error: true` даёт conclusion `success` — смотреть outcome/Verdict.
- Новые сюиты — **порт 0**; 8390 занят media-bff, 8321 занят published-mode, 8320 — статик для тестов.
- Тесты идентичности DOM мерить **во время** стрима (при `.streaming-caret`), иначе ложные FAIL.
  Отлистывание для проверки выдёргивания — **120 px**, не 300.
- `python-heredoc` ломает JS → всегда `node --check`. Патч-assert «найдено 2» → адресная замена по строке.
- Полная пересборка формы затирает свежий BPM; тосты перекрывают контролы ~6,5 с.
- Приватные `chats*` → **403** для GitHub App. `raw.githubusercontent.com` недоступен →
  `gh api .../git/blobs/<sha>`. `gh issue view` падает → `gh api repos/.../issues/<N>`.
- Не возвращать старые баги: wave-fill через clip-path, скачивание через `host.download`,
  theme-route push, universal reduced-motion duration, queue-eviction loop.
  Индексы помощников 0–5 завязаны на `seedChats`.

---

## 8. Долги и действия владельца

**Backlog шины (#28):** B1 чат мимо ThreadBudget; B2 retry при выключенном live → вечный queued;
B3 чат игнорирует `max_tokens`/`temperature`; B4 SSE CORS после `resp.prepare`
(**вероятная причина провала J9**); B5 гонка `jobs.json` в cron-cleanup; B6 flaky blob preview;
B7 `ThreadBudget.held` в минус при отмене; B8 авто-E2E.

**Нужен владелец:** доступ GitHub App к `bestdeejay-design/chats` и `chats-audit`
(Settings → Applications → Arena → Repository access). В manifest уже есть ссылки на
`PROMPTS_LIBRARY` и `chats-audit/music` — библиотека существует, но соединению недоступна.
**Токены в чат не запрашивать.**

**Не проверено вообще:** Pro из браузера end-to-end; стенд с живого телефона; Safari iOS;
retention/рестарт; 429 в браузере; качество вокала на слух.

---

## 9. С чего начать новую сессию

1. Прочитать `audits/PLAN-full-audit.md` (живой план, F-01…F-16, раздел 0.1 «Курс на простоту»)
   и пополнять его находками.
2. Спроектировать **помощника-исполнителя**: маршрут «фраза → намерение → лирика/промпт → job →
   результат в ленте», используя готовые `BRIIX_MUSIC.generate` / `BRIIX_MEDIA.generate`
   и `qwen3:4b-instruct` для сочинения лирики (а не только поиска в базе).
3. Добавить **дизайнера**, пробросить **`vocalMode:'pro'` и длительность** из чата.
4. Свести работы в **единую ленту пользователя** поверх трёх хранилищ.
5. Приёмку вести **на реальном стенде**, не на моке: `workflow_dispatch` с `phases=song-pro`
   и сквозной мобильный сценарий. Параллельно разобраться с провалом `J9 SSE`.

**Стиль работы, которого требует владелец:** проверять лично и честно говорить, что именно
проверено; для любой формы с потоковым ответом обязателен тест «печатаю во время стрима»;
не выдавать мок за генерацию.
