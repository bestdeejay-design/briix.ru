# Ревью PR #103 — «Add opt-in music producer drafts to studio»

VERDICT: pass-with-findings

Ревьюер: независимый саб-агент, правки в поставку не вносились.
Проверялось: коммит `90da875` (ветка `arena/d08e073f-briix-ru`) поверх `origin/main` (f7abf18, после слияния #102/#104).
Работа в отдельном worktree `/tmp/briix-review-103`.

## Что сделано в поставке (по diff)

- `studio/producer-brain.js` (новый): системный промпт продюсера, `messages()`, `parse()` с валидацией JSON, лимиты 160/2000/8000 (+MAX_IDEA 8000), эвристики-предупреждения.
- `studio/studio.js`: кнопка `#prepareMusic` (только music-режим, opt-in), `prepareMusic()` через существующий `chatNonStream` → `/v1/chat/completions` (не `/jobs`), карточка черновика `producer_draft` с редактированием/принятием/откатом/резервными копиями, session guard.
- `studio/index.html`, `studio/studio.css`: кнопка-entrу, стили карточки; `?v=`-бампы кэша.
- `tools/check-producer.cjs` (новый), `tools/check-studio.cjs` (+7 сценариев, только добавления), `demo-ci.yml` (в цикл CI добавлен suite `producer` — единственная строка, лёгкая).

## Ключевые риски — проверка по коду

1. **Сессии.** `producerRequests` (Map по session.id) ставится до первого `await`; после ответа guard `handle.cancelled || timedOut || !sessionProfile?.sessions.includes(session)`. `card()` рендерит в `rootFor(session)`, не в активный feed; check-studio подтверждает: поздний ответ не появляется в активной сессии и не дописывается в неё, но находится в исходной. Стоп-кнопка (`appendStop(wait.row, handle)`) отменяет только свой запрос через собственный `handle.controller`. Подтверждено тестами «producer cancellation and parallel chat…» и «late producer result is isolated…».
2. **Лирика.** Авторский текст передаётся как `existing_lyrics` в user-сообщении; в `parse()` — `const lyrics = existingLyrics || value.lyrics.trim()`: ответ модели **не может** заменить авторскую лирику. В быстром режиме скрытая лирика не уходит (`snapshot.advanced && … ? snapshot.lyrics : ''` — и в messages, и в parse). Инструментал лирику не шлёт; если модель вернула лирику для инструментала — `parse()` бросает. В check-studio: `chatPosts[0].messages[1].content` содержит авторскую строку, `#lyrics` после принятия = авторский текст.
3. **producer-brain.js.** `parse()`: fence-срез, JSON.parse c осмысленными ошибками, проверка типов/полей, лимиты. Fallback на сырой текст реализован на уровне studio.js: при ошибке парсинга карточка «Ответ для ручного восстановления» (`textContent`, без innerHTML). Предупреждения (`warnings()`) — только информационный текст в `.producer-warning`, ничего не блокируют.
4. **Запреты владельца.** `grep duration` по studio.js/producer-brain.js — пусто; тест фиксирует `params.duration === undefined`. CDN-ссылок нет. `[hidden] { display: none !important; }` на месте (studio.css:7), `.producer-entry` управляется через `hidden`, авторского `display`-конфликта нет (правило важнее). Жёстких цветов вне `:root` в добавленном CSS нет — только `var(--…)` (`--amber` объявлен). `controlsList='nodownload'` — все 3 точки на месте (studio.js:332, 916, 1808).
5. **Хранилище.** `producer_draft` — необязательная запись в существующем `session.feed` (schema sessions/events не менялась; session-store кладёт feed как JSON-объекты). Резервная копия `entry.beforeApply` снимается и **персистится до** изменения полей; после persist — повторная проверка, что поля не изменились; при ошибке сохранения поля не трогаются. Откат восстанавливает `quick/style/lyrics/advanced` из `beforeApply`, текущее состояние перед заменой дополнительно сохраняется как `beforeRevert`-снимок. Всё покрыто тестом с reload и dismiss/accept confirm.
6. **Чат-эндпоинт.** Генерация не запускается ни на prepare, ни на accept (тесты `state.jobPosts.length === 0` в 4 местах). По `max_tokens`: клиент шлёт `max_tokens` в `/v1/chat/completions` (studio.js:91) — это прежнее поведение `chatNonStream`, используемое и `improve()`. Гарантия «не пробрасывается upstream» относится к BFF на стенде, кода которого в этом репозитории нет — **проверить по коду невозможно**, см. «Не проверено».
7. **CI.** demo-ci.yml — только добавление `producer` в список suite. check-studio.cjs: diff чисто добавляющий (117 строк, 0 удалений), прежние ассерты не ослаблены. Новый check-producer.cjs покрывает: парсинг JSON/fence, авторская лирика побеждает, throw на битом JSON/пустой лирике/лирике у инструментала/превышении MAX_PROMPT, форма messages с existing_lyrics, анти-галлюцинация темпа в system, срабатывание эвристик. Плюс 7 интеграционных сценариев в check-studio (мобильный review/edit/apply/restore/reload, guard лирики, инструментал+битый JSON+модерация, отмена+параллельный чат, поздняя сессия, 429).

## Прогнано лично (worktree на 90da875, NODE_PATH=/opt/homebrew/lib/node_modules)

- `node tools/check-producer.cjs` — PASS
- `node tools/check-studio.cjs` — **SUITE PASS: 46 checks** (заявленные 46/46 подтверждены)
- `node tools/check-wait-phrases.cjs` — DONE 10 checks (10/10)
- `node tools/check-session-store.cjs` — PASS
- `node tools/check-studio-storage.cjs` — PASS
- `node tools/check-waveform.cjs` — PASS
- `node --check studio/studio.js && node --check studio/producer-brain.js` — OK
- conflict-маркеры (`^<{7}|={7}|>{7}`) по всем изменённым файлам — пусто
- скобки studio.css: 297/297
- grep duration / CDN / `[hidden]` / controlsList — см. выше

## Находки

### Мажорные

Не обнаружены.

### Минорные

1. **studio.js:91 (chatNonStream) — `max_tokens` уходит клиентом в чат-эндпоинт.** Это прежнее поведение (используется и `improve()`), но обещание «max_tokens не пробрасывается upstream» проверяется только на стороне BFF стенда, кода которого в репо нет. Риск низкий: параметр chats-эндпоинта, не генерации.
2. **studio.js, prepareMusic: тихая потеря ответа при выходе из профиля.** Если пользователь вышел из профиля (`sessionProfile` сменился) пока запрос летел, guard `!sessionProfile?.sessions.includes(session)` молча отбрасывает уже полученный черновик (сырой текст тоже не сохраняется как «ручное восстановление»). При switch внутри профиля — сохраняется корректно. Редкий сценарий, потеря только черновика, поля не трогаются.
3. **producer-brain.js: лимит MAX_IDEA (8000) проверяется только в studio.js** перед запросом; сам brain не валидирует длину idea на входе `messages()`. Не проблема, просто проверка живёт не в модуле.
4. **studio.css: у `.producer-entry span` на ≤480px `display: none`** — подпись пропадает на узких экранах, остаётся только кнопка. Косметика, задуманно (компактность мобильной ленты).

## Честно не проверено

- **Живой чат/BFF/стенд** — не моя зона: реальное поведение `/v1/chat/completions` (в т.ч. strip `max_tokens` upstream, модерация, 429 queue_full) проверено только через моки Playwright.
- Реальная генерация музыки после принятия черновика — в тестах мокается (`jobPosts`), живой прогон генерации не делался.
- Кроссбраузерность (только Playwright-движок) и реальная печать/тёмная тема студии глазами.
- Поведение при переполнении localStorage большими черновиками (лирика до 8000 символов × несколько черновиков в сессии) — только статическая оценка, стресс-теста не было.

## Итог

Поставка соответствует постановке: opt-in черновик через существующий чат-эндпоинт, без неявной генерации, с сохранением авторской лирики, корректной изоляцией по сессиям, резервными копиями до замены. Все ключевые обещания подтверждены кодом и прогоном тестов. Найти мажорные дефекты не удалось; минорные — перечислены выше и не блокируют.
