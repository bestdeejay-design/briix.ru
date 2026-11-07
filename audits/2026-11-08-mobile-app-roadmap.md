# BRIIX: подробный план мобильного пути — от текущей демки до PWA, iOS/Android-оболочек и сторов

<a id="top"></a>

- **Дата:** 2026-11-08, Europe/Moscow.
- **Автор:** arena-сессия `arena/969dcca5-briix-ru`.
- **Статус:** план/roadmap для согласования и передачи исполнителям. Это не реализация мобильного приложения, не изменение демо, не деплой и не закрытие #23.
- **Основание:** просьба владельца сформировать максимально подробный план мобильного пути и отправить его в ветку GitHub.
- **Текущая база:** `main` @ `a6849fc` после merge PR #24; ветка сессии `arena/969dcca5-briix-ru`.
- **Главные зависимости:** [#23](https://github.com/bestdeejay-design/briix.ru/issues/23) — приватный live-контур и шина моделей; [task-23-model-bus-request.md](task-23-model-bus-request.md) — контрактный запрос к INFRA; [PR #22](https://github.com/bestdeejay-design/briix.ru/pull/22) — CPU-пилот медиа.
- **Границы этой поставки:** изменены только материалы в `audits/`. `demo.js`, `media.js`, `docs/`, `site/`, серверные контуры, модели, сторы и чужие ветки не трогались.

## Короткий вывод

1. **Сейчас не делаем отдельное нативное приложение.** Ждём шину моделей и live-контракт.
2. **Сначала доводим мобильный web/live-демо до нормального состояния.** Это самый дешёвый способ проверить сценарии: чат, изображения, музыка, очередь, файлы, ошибки.
3. **Затем делаем PWA.** Установка на главный экран, offline-shell, аккуратное кэширование, мобильные метаданные.
4. **Для сторов делаем тонкие нативные оболочки вокруг общего web-клиента.** Предпочтительный путь — Capacitor iOS/Android в отдельном packaging-контуре, а не npm внутри текущей статической демки.
5. **В сторы идём только с реальной app-like ценностью.** Push “результат готов”, файлы/share, безопасная сессия, offline/error states, нормальная навигация. Пустой WebView с сайтом — высокий риск отказа.
6. **Модели на старте живут на сервере/стенде за шиной.** Телефон — клиент. On-device inference — отдельный R&D-этап, не MVP мобильного приложения.
7. **Текущий мок нельзя отправлять в сторы как live AI-сервис.** Сначала реальный путь: вход → запрос → генерация → результат → сохранение/отправка.

## Содержание

- [1. Исходные факты и ограничения](#facts)
- [2. Целевая архитектура](#architecture)
- [3. Решения, которые нужно зафиксировать](#decisions)
- [4. Этапы M0–M9](#phases)
- [5. Детальный backlog по этапам](#backlog)
- [6. UX и информационная архитектура](#ux)
- [7. Контракты шины для мобильного клиента](#contracts)
- [8. Безопасность, приватность и данные](#security)
- [9. Тестирование и приёмка](#qa)
- [10. Сборка, CI/CD, подписи и релизы](#release)
- [11. Сторы: Apple, Google Play, RuStore/альтернативы](#stores)
- [12. Монетизация и платежи](#payments)
- [13. Наблюдаемость, аналитика и поддержка](#ops)
- [14. Риски и mitigations](#risks)
- [15. Оценка последовательности и критический путь](#timeline)
- [16. Роли и ответственность](#raci)
- [17. Ближайшие 10 действий](#next)
- [18. Что осталось непроверенным](#unverified)
- [19. Источники](#sources)
- [20. Письмо о поставке](#delivery)

---

<a id="facts"></a>
## 1. Исходные факты и ограничения

### 1.1. Что есть в репозитории сейчас

| Факт | Источник | Следствие для мобильного плана |
|---|---|---|
| Демо — статический HTML/CSS/JS без сборки, npm, бандлеров и внешних CDN | `AGENTS.md`, `index.html` | Нельзя просто “добавить Capacitor” в текущую статику без отдельного packaging-контура |
| В демо есть мобильные breakpoint’ы и mobile-menu | `demo.css`, `index.html` | База для mobile web уже есть, но live-сценарии не проверены |
| Медиа-студия сейчас local-mock | `media.js`, `audits/task-media-local-mock.md` | До шины нельзя показывать фиктивную live-генерацию |
| Запрошена единая шина: chat/SSE, jobs, files, models | `audits/task-23-model-bus-request.md` | Мобильный клиент должен использовать тот же контракт, что и web |
| #23 ещё открыт, live-контур в работе | GitHub issue #23 | Мобильный этап стартует после передачи контракта и smoke-артефактов |
| Канон продукта относит мобильное приложение к более позднему этапу | `docs/BRIIX.md` | Не ломать приоритет web/MVP; мобильный план делать как надстройку |
| AI-platform docs: основной интерфейс — web, мобильная адаптация обязательна, отдельные native apps не входят в MVP | `ai-platform-docs/README.md`, `PRODUCT.md` | Подтверждает web-first подход |
| Публичный сайт/демо не должен содержать runtime-зависимости и внешние запросы по умолчанию | standing constraints, `AGENTS.md` | Live-конфигурация только явно включаемая; публичная статика остаётся безопасной |

### 1.2. Жёсткие ограничения

1. **Не публиковать секреты, внутренние адреса, токены, порты стендов и приватные пути.**
2. **Не хранить upstream/model API keys в браузере или мобильном JS.**
3. **Не отправлять в сторы мок как реальный AI-сервис.**
4. **Не обещать вокальные песни, если маршрут `song.vocal` не готов.** MusicGen — инструментал.
5. **Не делать тихий fallback live → mock.** Если live упал, показываем `unavailable`/ошибку; mock только явным действием пользователя.
6. **Не кэшировать приватные prompts/responses/media в service worker без отдельного решения.**
7. **Не менять `docs/` и `site/` в рамках этого плана.**
8. **Не создавать второй серверный контур молча.** Сначала инвентаризация существующего шлюза.
9. **Не тащить тяжёлые модели на телефон в первом релизе.** Сначала серверная генерация.
10. **Не считать App Store/Google Play approval гарантированным.** Нужны compliance-гейты и запас на отказ ревью.

### 1.3. Что означает “приложение для мобильных телефонов” в этом плане

В плане рассматриваются три уровня:

| Уровень | Что это | Когда нужно |
|---|---|---|
| Mobile web | Адаптивный сайт в браузере телефона | Сразу после live-шины |
| PWA | Устанавливаемый web app: manifest, icons, standalone, service worker | После стабилизации mobile web |
| Store app | Нативная оболочка iOS/Android вокруг web-клиента + нативные функции | Когда нужны сторы, push, файлы, secure storage, app-like UX |

Если под “модельными телефонами” имелся в виду **on-device inference**, это отдельный трек M9. В первом мобильном релизе телефон не запускает модели локально.

---

<a id="architecture"></a>
## 2. Целевая архитектура

### 2.1. Слои

```text
┌──────────────────────────────────────────────────────────────┐
│ Пользовательское устройство                                   │
│                                                              │
│  iOS App Shell        Android App Shell        PWA/Browser    │
│  WKWebView/Capacitor  WebView/Capacitor        Chrome/Safari  │
│        │                    │                       │        │
│        └────────────┬───────┴───────────────┬───────┘        │
│                     │   Общий BRIIX web UI  │                │
│                     │   chat/images/music   │                │
└─────────────────────┼───────────────────────┼────────────────┘
                      │ HTTPS + auth/session  │
┌─────────────────────▼───────────────────────▼────────────────┐
│ BRIIX API Gateway / Model Bus                                │
│  /v1/models                                                  │
│  /v1/chat/completions (JSON/SSE)                             │
│  /jobs, /jobs/{id}, /jobs/{id}/cancel                        │
│  /files/{id}                                                 │
│  auth/session, quotas, errors, request-id, provenance        │
└───────────────┬───────────────────────┬──────────────────────┘
                │                       │
┌───────────────▼─────────────┐ ┌───────▼──────────────────────┐
│ Queue / Job state            │ │ File storage / TTL / cleanup │
│ queued/running/ready/error   │ │ PNG/WAV/text artifacts       │
└───────────────┬─────────────┘ └───────┬──────────────────────┘
                │                       │
┌───────────────▼───────────────────────▼──────────────────────┐
│ Inference adapters/workers                                   │
│ chat: qwen3:4b-instruct                                      │
│ image: FLUX.2-klein-4B                                       │
│ music instrumental: MusicGen small                           │
│ vocal song: ACE-Step candidate, only after gate              │
│ future: TTS/ASR/video, only by capability                    │
└──────────────────────────────────────────────────────────────┘
```

### 2.2. Основные потоки

#### Чат

1. Клиент отправляет `POST /v1/chat/completions` с `stream=true`.
2. Шина проверяет auth, квоты, модель, лимиты.
3. Ответ идёт SSE chunks.
4. Клиент рендерит поток, умеет stop/cancel.
5. При обрыве сети клиент показывает interrupted/reconnect, не выдумывает завершённый ответ.
6. История хранится согласно политике: локально/серверно/opt-in.

#### Фото/музыка

1. Клиент отправляет `POST /jobs`.
2. Шина возвращает `202` и `job_id` только после durable принятия.
3. Клиент показывает честный queued/running/indeterminate progress.
4. Статус приходит polling или server events.
5. По готовности клиент получает metadata и `file_id`.
6. Файл скачивается через авторизованный `GET /files/{id}`.
7. Клиент сохраняет/шарит результат нативно или через web download.
8. После TTL результат помечается expired, а не показывается как битый.

#### Push “результат готов”

1. Мобильное приложение регистрирует device/push token.
2. Шина связывает token с user/session/workspace.
3. Job completion создаёт событие.
4. Push-сервис отправляет уведомление через APNs/FCM.
5. Приложение открывает deep link на job/result.
6. Если push недоступен, работает polling и экран очереди.

### 2.3. Среды

| Среда | Назначение | Кто видит | Ограничения |
|---|---|---|---|
| `local-mock` | Текущая публичная демка без сети | все | честная маркировка, no inference |
| `private-live` | Проверка шины через приватный контур/туннель | команда/владелец | не для сторов, не публичный ingress |
| `staging` | Предрелизная проверка мобильного клиента | тестировщики | отдельный backend, тестовые данные |
| `production` | Публичный live-сервис | пользователи | только после security/legal/store gates |

### 2.4. Feature flags

Минимальные флаги:

```text
FEATURE_LIVE_CHAT
FEATURE_LIVE_IMAGE
FEATURE_LIVE_MUSIC_INSTRUMENTAL
FEATURE_LIVE_SONG_VOCAL
FEATURE_PWA_INSTALL
FEATURE_PUSH_NOTIFICATIONS
FEATURE_NATIVE_SHARE
FEATURE_BIOMETRIC_UNLOCK
FEATURE_ON_DEVICE_MODELS
FEATURE_STORE_BILLING
```

Правила:

- флаг не должен включать недоступную модель без capability;
- выключенный live-режим показывает `unavailable`, а не mock под видом live;
- сторы-сборка не должна иметь скрытый debug/live-reload endpoint;
- приватный tunnel config не попадает в production bundle.

---

<a id="decisions"></a>
## 3. Решения, которые нужно зафиксировать

| ID | Решение | Статус | Обоснование |
|---|---|---|---|
| D-MOB-001 | Web-first: сначала mobile web, потом PWA, потом store shells | proposed | совпадает с каноном MVP и снижает риск |
| D-MOB-002 | Не переписывать BRIIX полностью на Swift/Kotlin на старте | proposed | один UI, одна команда, быстрее итерации |
| D-MOB-003 | Capacitor — основной кандидат для iOS/Android shells | proposed | общий web-код, нативные плагины, WKWebView/WebView |
| D-MOB-004 | TWA — альтернатива только для Android, если PWA достаточно сильная | proposed | меньше нативного контроля, зависит от Chrome/Digital Asset Links |
| D-MOB-005 | Mobile packaging вынести в отдельный контур/репо | proposed | текущая статика без npm/build; нельзя ломать публичную демку |
| D-MOB-006 | В сторы идти только после реального live E2E | proposed | иначе риск отказа и обмана пользователей |
| D-MOB-007 | Модели на старте серверные; on-device — отдельный R&D | proposed | CPU/GPU-стенды уже есть, телефоны не готовы к тяжёлой генерации |
| D-MOB-008 | MusicGen не маркировать как вокальную песню | accepted по смыслу #23 | честность capability |
| D-MOB-009 | Приватные prompts/media не кэшировать по умолчанию | proposed | безопасность и приватность |
| D-MOB-010 | Payments/store billing — отдельное решение до submission | proposed | влияет на экономику и review |

Все `proposed` решения утверждает координатор/владелец. До утверждения исполнители не должны молча выбирать стек, платежи или публичный запуск.

---

<a id="phases"></a>
## 4. Этапы M0–M9

<a id="m0"></a>
### M0. Ожидание шины и контрактный гейт

**Цель:** не начинать мобильную разработку на угаданных API.

**Вход:** #23 в работе, шина ещё не передана.

**Задачи:**

- получить от INFRA фактический contract pack/OpenAPI;
- получить список реально готовых моделей и capabilities;
- получить безопасные smoke-артефакты: text/PNG/WAV;
- зафиксировать auth/session модель для web и mobile;
- зафиксировать job states, cancel, retry, idempotency, TTL;
- зафиксировать error envelope и request ID;
- зафиксировать, какие маршруты demo-only/commercial-ready;
- проверить, что приватный контур не требует публикации секретов;
- согласовать, какие мобильные функции потребуют backend-расширений.

**Выход:**

- `mobile-contract-handoff.md` или эквивалентный файл от исполнителя #23;
- fixtures для мобильного/web клиента;
- список blockers;
- решение: можно стартовать M1 или нужно ждать.

**Acceptance:**

- [ ] контракт версионирован;
- [ ] есть примеры успешных и ошибочных запросов;
- [ ] есть реальные PNG/WAV/text, а не только описание;
- [ ] auth не требует upstream key в клиенте;
- [ ] job recovery/cancel/TTL описаны;
- [ ] vocal route либо готов, либо явно unavailable;
- [ ] нет внутренних адресов/секретов в публичных артефактах.

<a id="m1"></a>
### M1. Mobile web hardening поверх live-шины

**Цель:** текущая демка/клиент нормально работает на телефоне до всяких сторов.

**Задачи:**

- проверить чат на узких экранах, клавиатуре, safe-area;
- проверить SSE при сворачивании, потере сети, возврате;
- проверить stop/cancel и partial response;
- проверить image/music job creation, polling, recovery;
- проверить download/open/share результата в мобильном браузере;
- проверить состояния local-mock/curated/live/unavailable;
- проверить ошибки шины, таймауты, expired files;
- проверить тёмную/светлую тему на мобильном;
- проверить accessibility: focus, screen reader, contrast, touch targets;
- убрать фиктивные таймеры из live-режима;
- добавить честную маркировку отправки данных в приватный/live контур.

**Выход:**

- mobile web acceptance report;
- список исправленных UX/contract bugs;
- решение о готовности к PWA.

**Acceptance:**

- [ ] на 360–430px ширины нет горизонтального overflow в ключевых сценариях;
- [ ] чат можно остановить, ошибка mid-stream видна;
- [ ] job восстанавливается после reload;
- [ ] результат можно скачать/открыть;
- [ ] live не подменяется моком;
- [ ] нет секретов в JS/localStorage/URL;
- [ ] пройдены базовые axe/manual checks.

<a id="m2"></a>
### M2. PWA

**Цель:** устанавливаемый web app без сторов.

**Задачи:**

- добавить web app manifest;
- подготовить иконки 192/512, maskable, apple-touch-icon;
- настроить `display: standalone`, `start_url`, `scope`, theme/background colors;
- добавить service worker для offline-shell;
- определить cache strategy: static cache-first, API network-only/no-store;
- добавить экран offline/retry;
- добавить update flow: “доступна новая версия”;
- проверить install prompt/Add to Home Screen;
- проверить iOS standalone behavior;
- проверить Android Chrome installability;
- не кэшировать приватные ответы/media без отдельного решения;
- подготовить PWA privacy/security notes.

**Выход:**

- PWA-сборка в отдельной задаче/контуре;
- manifest/SW/icons;
- PWA test report;
- решение: достаточно ли PWA или идём в сторы.

**Acceptance:**

- [ ] manifest валиден;
- [ ] иконки отображаются;
- [ ] приложение устанавливается на iOS/Android;
- [ ] offline показывает нормальный экран, не браузерную ошибку;
- [ ] приватные API-ответы не попадают в cache;
- [ ] обновление не ломает активный job;
- [ ] публичная статика по умолчанию не делает неожиданных внешних запросов.

<a id="m3"></a>
### M3. Mobile packaging foundation

**Цель:** подготовить iOS/Android-оболочки, не ломая текущую статику.

**Задачи:**

- создать отдельный mobile-packaging контур/репо;
- определить источник web-ассетов: экспорт из BRIIX web-клиента;
- настроить Capacitor project;
- задать appId/bundleId, appName, webDir;
- добавить iOS/Android platforms;
- настроить environment-specific config: staging/production;
- запретить live-reload/server URL в release;
- настроить signing/provisioning;
- настроить CI builds;
- определить versioning: marketing version + build number;
- подготовить splash/icon assets;
- подготовить native project README/runbook.

**Выход:**

- собираемые iOS/Android debug builds;
- signing/CI runbook;
- web assets export pipeline;
- решение о готовности к native value.

**Acceptance:**

- [ ] debug build запускается на симуляторе/эмуляторе и реальном устройстве;
- [ ] web UI загружается из packaged assets, не с случайного localhost;
- [ ] release config не содержит debug endpoints;
- [ ] appId/bundleId утверждены;
- [ ] секреты не лежат в репо;
- [ ] CI может собрать артефакт без ручных секретов в логах.

<a id="m4"></a>
### M4. Native value: то, что отличает приложение от сайта

**Цель:** дать пользователю реальную причину установить приложение и пройти store review.

**Задачи:**

- нативная/адаптивная навигация: Чат, Изображения, Музыка, Работы, Настройки;
- safe-area, status bar, splash, keyboard handling;
- push notifications: job ready/error;
- deep links/universal links/app links на job/result;
- secure storage для session/token;
- files: сохранение PNG/WAV, share sheet, open in system player;
- offline/error screens;
- network state handling;
- audio session/playback policy для музыки;
- haptics/clipboard/share — только где уместно;
- biometric unlock — опционально, не единственный вход;
- app-level settings: notifications, theme, storage, logout, delete account.

**Выход:**

- app-like UX;
- native plugin matrix;
- push/file/session test report;
- решение о готовности к beta.

**Acceptance:**

- [ ] push приходит после реальной job completion;
- [ ] тап по push открывает нужный результат;
- [ ] PNG/WAV можно сохранить и расшарить;
- [ ] session token не в localStorage/UserDefaults plain text;
- [ ] offline/error states не выглядят как браузерная ошибка;
- [ ] приложение работает без push, если пользователь отказал;
- [ ] нет browser chrome/progress bar в release;
- [ ] навигация и back gesture предсказуемы.

<a id="m5"></a>
### M5. Backend/mobile contract extensions

**Цель:** шина поддерживает мобильные сценарии безопасно и предсказуемо.

**Задачи:**

- device registration endpoint;
- push token storage/rotation/revoke;
- job completion events;
- deep link resolver;
- file TTL/expired semantics;
- session lifecycle для mobile;
- account deletion flow;
- data export/delete request flow;
- moderation/reporting для AI-generated/UGC content;
- quota/usage display;
- safe analytics events;
- rate limit и anti-abuse;
- audit/request-id для мобильных клиентов.

**Выход:**

- обновлённый OpenAPI/contract pack;
- mobile backend acceptance report;
- privacy/data mapping.

**Acceptance:**

- [ ] push token можно зарегистрировать и отозвать;
- [ ] job event не раскрывает prompt/media в push payload;
- [ ] expired file возвращает понятную ошибку;
- [ ] account deletion удаляет связанные данные согласно политике;
- [ ] moderation/reporting работает для генераций;
- [ ] mobile client не получает чужие jobs/files;
- [ ] все ошибки имеют safe request ID.

<a id="m6"></a>
### M6. Beta: TestFlight / Google Play testing / RuStore beta

**Цель:** проверить приложение на реальных устройствах и собрать feedback до публичного релиза.

**Задачи:**

- iOS: TestFlight internal, затем external;
- Android: internal testing, затем closed testing;
- RuStore: beta только если основная версия уже опубликована и это нужно;
- подготовить tester instructions;
- собрать crash/ANR/performance;
- проверить push на разных устройствах;
- проверить плохую сеть, offline, background/foreground;
- проверить download/share/audio playback;
- проверить login/logout/delete account;
- собрать feedback и закрыть blocker bugs.

**Выход:**

- beta report;
- список исправлений;
- решение о store submission.

**Acceptance:**

- [ ] нет crash blocker на ключевых сценариях;
- [ ] push/file/session сценарии пройдены на iOS и Android;
- [ ] feedback канал работает;
- [ ] тестировщики понимают, что это beta;
- [ ] для нового personal Google Play account выполнено closed testing требование, если применимо;
- [ ] TestFlight build не истёк до завершения теста.

<a id="m7"></a>
### M7. Store submission

**Цель:** подготовить и подать приложения так, чтобы минимизировать риск отказа.

**Задачи:**

- Apple: App Store Connect metadata, screenshots, privacy labels, age rating, review notes, demo account;
- Google Play: store listing, Data safety, privacy policy, content rating, target API, AAB, testing track;
- RuStore/альтернативы: отдельная карточка, модерация, APK/AAB, подписи;
- проверить minimum functionality/app-like value;
- проверить UGC/AI moderation requirements;
- проверить account deletion;
- проверить payments/subscription flow;
- проверить export compliance/encryption;
- подготовить rejection response plan.

**Выход:**

- submitted builds;
- store compliance checklist;
- review notes;
- решение о публикации.

**Acceptance:**

- [ ] все обязательные формы заполнены;
- [ ] privacy policy доступна в приложении и в сторе;
- [ ] account deletion есть в приложении и web resource, если требуется;
- [ ] demo account работает для ревьюера;
- [ ] screenshots показывают приложение, а не просто сайт;
- [ ] нет placeholder/mock контента под видом live;
- [ ] payments соответствуют правилам стора;
- [ ] есть план ответа на rejection.

<a id="m8"></a>
### M8. Launch и эксплуатация

**Цель:** безопасно выпустить и поддерживать мобильные приложения.

**Задачи:**

- staged rollout;
- monitoring crash/ANR/API errors/job failures;
- support channel;
- rollback plan;
- update cadence;
- SDK/target API compliance calendar;
- push certificate/key rotation;
- signing key backup;
- store listing updates;
- user feedback triage;
- incident runbooks.

**Выход:**

- production release;
- ops runbook;
- compliance calendar.

**Acceptance:**

- [ ] rollout можно остановить;
- [ ] crash rate отслеживается;
- [ ] job failures видны;
- [ ] support отвечает;
- [ ] signing/push secrets защищены;
- [ ] есть план обновления под требования сторов.

<a id="m9"></a>
### M9. Native-only / on-device R&D

**Цель:** не делать нативную перепись без причины, но иметь критерии, когда она нужна.

**Триггеры:**

- on-device chat/image/music models;
- фоновая запись/обработка аудио;
- аудио-редактор;
- widgets/Live Activities;
- глубокая интеграция с Photos/Files/Shortcuts;
- Bluetooth/камера/микрофон в сложных сценариях;
- offline inference;
- требования производительности, которые WebView не закрывает.

**Выход:**

- отдельный ADR;
- PoC на целевых устройствах;
- оценка размера моделей, RAM, батареи, thermal throttling;
- решение: native module vs full native app.

**Acceptance:**

- [ ] есть измеримая причина, а не “хотим нативнее”;
- [ ] PoC прошёл на реальных устройствах;
- [ ] лицензии моделей разрешают такой сценарий;
- [ ] безопасность/приватность не ухудшены.

---

<a id="backlog"></a>
## 5. Детальный backlog по этапам

Размеры условные: S — до 1 дня, M — 1–3 дня, L — 3–7 дней, XL — больше недели или зависит от внешнего контура. Это не календарное обещание.

### M0 — контрактный гейт

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M0-01 | Получить OpenAPI/contract pack от #23 | INFRA | #23 | contract file | версии/примеры есть | M |
| M0-02 | Получить capability matrix моделей | INFRA | M0-01 | models.json/docs | только реальные ready routes | S |
| M0-03 | Получить smoke text/PNG/WAV | INFRA | M0-01 | artifacts | provenance есть | M |
| M0-04 | Зафиксировать auth/session для mobile | Backend+Security | M0-01 | auth spec | нет upstream keys в клиенте | M |
| M0-05 | Зафиксировать job states/cancel/TTL | Backend | M0-01 | job spec | recovery/expired описаны | M |
| M0-06 | Зафиксировать error envelope/request-id | Backend | M0-01 | error spec | safe errors | S |
| M0-07 | Проверить vocal route status | INFRA+Product | M0-02 | decision | song.vocal ready/unavailable | S |
| M0-08 | Передать fixtures frontend/mobile | INFRA | M0-03 | fixtures | можно мокать контракт локально | S |
| M0-09 | Зафиксировать mobile blockers | Coordinator | M0-01..08 | handoff | список blockers закрыт/принят | S |

### M1 — mobile web

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M1-01 | Аудит текущих mobile breakpoints | Frontend | M0 | audit list | ключевые экраны проверены | S |
| M1-02 | Chat mobile layout/keyboard | Frontend | M0 | UI fixes | нет overflow, ввод удобен | M |
| M1-03 | SSE reconnect/stop/partial | Frontend+Backend | M0 | chat live client | обрыв не ломает UI | L |
| M1-04 | Image job mobile flow | Frontend | M0 | image live UI | job/recovery/download | M |
| M1-05 | Music job mobile flow | Frontend | M0 | music live UI | instrumental/vocal не путаются | M |
| M1-06 | Queue screen mobile | Frontend | M0 | queue UI | честные статусы | M |
| M1-07 | File download/open/share web | Frontend | M0 | file UX | результат открывается | M |
| M1-08 | Mode labels: mock/live/unavailable | Frontend+Product | M0 | labels | нет тихого fallback | S |
| M1-09 | Mobile accessibility pass | QA | M1-02..08 | axe/manual report | blocker a11y закрыты | M |
| M1-10 | Mobile network matrix | QA | M1-03..07 | test report | offline/weak net passed | M |
| M1-11 | Security check client storage | Security | M1-03..07 | report | нет секретов/приватных blobs | S |
| M1-12 | Mobile web acceptance | Coordinator | M1-01..11 | decision | можно M2 | S |

### M2 — PWA

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M2-01 | Manifest/icons/splash assets | Frontend+Design | M1 | manifest/assets | валидно, отображается | M |
| M2-02 | Service worker offline-shell | Frontend | M1 | SW | offline screen работает | M |
| M2-03 | Cache policy for API/private data | Security+Frontend | M2-02 | policy | приватное не кэшируется | S |
| M2-04 | Install flow iOS/Android | QA | M2-01..03 | test report | установка проверена | M |
| M2-05 | Update flow | Frontend | M2-02 | update UX | активный job не ломается | M |
| M2-06 | PWA privacy/security notes | Security | M2-03 | docs | риски описаны | S |
| M2-07 | PWA acceptance | Coordinator | M2-01..06 | decision | можно M3 или остаться на PWA | S |

### M3 — packaging

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M3-01 | Утвердить appId/bundleId/name | Owner+Coordinator | M2 | decision | имена зафиксированы | S |
| M3-02 | Создать mobile-packaging контур | Mobile+DevOps | M3-01 | repo/dir | не ломает статику | M |
| M3-03 | Web assets export pipeline | Frontend+DevOps | M3-02 | export script | воспроизводимо | M |
| M3-04 | Capacitor init/config | Mobile | M3-02 | config | webDir/platforms есть | M |
| M3-05 | iOS project/signing | Mobile | M3-04 | Xcode project | debug build запускается | L |
| M3-06 | Android project/signing | Mobile | M3-04 | Gradle project | debug build запускается | L |
| M3-07 | Environment configs | Mobile+DevOps | M3-04 | staging/prod | no debug in release | M |
| M3-08 | CI builds | DevOps | M3-05..07 | pipeline | артефакты собираются | L |
| M3-09 | Versioning scheme | Coordinator+Mobile | M3-08 | version policy | build numbers уникальны | S |
| M3-10 | Packaging runbook | Mobile | M3-01..09 | docs | другой агент может собрать | M |

### M4 — native value

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M4-01 | Native navigation/safe-area | Mobile+Frontend | M3 | app shell | app-like navigation | M |
| M4-02 | Push backend contract | Backend | M3 | push spec | token/event/revoke | M |
| M4-03 | APNs setup | Mobile+DevOps | M4-02 | iOS push | push приходит | L |
| M4-04 | FCM setup | Mobile+DevOps | M4-02 | Android push | push приходит | L |
| M4-05 | Deep links/app links | Mobile+Backend | M4-02 | links | job открывается | M |
| M4-06 | Secure session storage | Mobile+Security | M3 | storage | keychain/keystore | M |
| M4-07 | File save/share/open | Mobile | M3 | files UX | PNG/WAV сохраняются | M |
| M4-08 | Offline/error screens | Mobile+Frontend | M3 | screens | не browser error | M |
| M4-09 | Audio playback/session | Mobile | M4-07 | playback | музыка играет корректно | M |
| M4-10 | Network state handling | Mobile | M4-08 | reconnect | job восстанавливается | M |
| M4-11 | Biometric unlock optional | Mobile | M4-06 | feature | не единственный вход | M |
| M4-12 | Native value acceptance | Coordinator | M4-01..11 | decision | можно beta | S |

### M5 — backend/mobile extensions

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M5-01 | Device registration API | Backend | M4-02 | endpoint | token привязан к user | M |
| M5-02 | Push token rotation/revoke | Backend+Security | M5-01 | lifecycle | старые токены не живут | M |
| M5-03 | Job completion events | Backend | M0-05 | events | ready/error пушатся | M |
| M5-04 | Safe push payloads | Security | M5-03 | payload spec | нет prompt/media утечек | S |
| M5-05 | File TTL/expired API semantics | Backend | M0-05 | errors | expired понятен | S |
| M5-06 | Account deletion flow | Backend+Legal | M0-04 | deletion | данные удаляются | L |
| M5-07 | Data export/request flow | Backend+Legal | M5-06 | export/delete | процесс документирован | M |
| M5-08 | Moderation/reporting | Backend+Product | M0 | report flow | UGC/AI требования закрыты | L |
| M5-09 | Quota/usage mobile display | Backend+Frontend | M0 | usage API | лимиты видны | M |
| M5-10 | Mobile tenant isolation tests | QA+Security | M5-01..09 | tests | чужие jobs/files недоступны | M |

### M6 — beta

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M6-01 | TestFlight internal | Mobile | M4/M5 | build | команда тестирует | M |
| M6-02 | TestFlight external | Mobile+Coordinator | M6-01 | external beta | review passed | M |
| M6-03 | Play internal testing | Mobile | M4/M5 | track | сборка доступна | M |
| M6-04 | Play closed testing | Mobile+Coordinator | M6-03 | closed track | требования выполнены | L |
| M6-05 | Tester instructions | Product+QA | M6-01..04 | guide | сценарии понятны | S |
| M6-06 | Crash/ANR monitoring | DevOps | M6-01..04 | dashboards | ошибки видны | M |
| M6-07 | Device/network beta matrix | QA | M6-01..04 | report | blocker bugs закрыты | L |
| M6-08 | Feedback triage | Product | M6-05..07 | backlog | решения приняты | M |
| M6-09 | Beta exit decision | Coordinator | M6-01..08 | decision | можно submission | S |

### M7 — stores

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M7-01 | Apple metadata/screenshots | Product+Design | M6 | listing | app-like screenshots | M |
| M7-02 | Apple privacy labels/manifests | Security+Mobile | M6 | forms | совпадает с кодом | M |
| M7-03 | Apple review notes/demo account | Coordinator | M6 | notes | ревьюер может войти | S |
| M7-04 | Google listing/Data safety | Product+Security | M6 | forms | privacy consistent | M |
| M7-05 | Google target API/AAB/signing | Mobile+DevOps | M6 | AAB | требования выполнены | M |
| M7-06 | Payments decision implementation | Owner+Backend | M6 | billing | правила сторов соблюдены | XL |
| M7-07 | UGC/AI moderation evidence | Product+Backend | M5-08 | docs/UI | report/block/filter есть | M |
| M7-08 | Account deletion evidence | Backend+QA | M5-06 | tests | in-app + web | M |
| M7-09 | Submit Apple | Coordinator | M7-01..08 | submission | принято в review | S |
| M7-10 | Submit Google | Coordinator | M7-01..08 | submission | принято в review | S |
| M7-11 | RuStore/alternative decision | Owner | M7-10 | decision | нужно/не нужно | S |
| M7-12 | Rejection response plan | Coordinator | M7-09..10 | runbook | ответы готовы | S |

### M8 — launch/ops

| ID | Задача | Owner | Depends | Output | Acceptance | Size |
|---|---|---|---|---|---|---|
| M8-01 | Staged rollout | DevOps+Coordinator | M7 | rollout | можно остановить | M |
| M8-02 | Monitoring dashboards | DevOps | M7 | dashboards | crash/API/jobs видны | M |
| M8-03 | Support channel | Product | M7 | support | feedback обрабатывается | S |
| M8-04 | Rollback runbook | DevOps | M8-01 | runbook | откат проверен | M |
| M8-05 | Compliance calendar | Coordinator | M7 | calendar | SDK/target API deadlines | S |
| M8-06 | Secrets rotation runbook | Security+DevOps | M7 | runbook | push/signing keys защищены | M |
| M8-07 | Post-launch review | Coordinator | M8-01..06 | report | решения зафиксированы | S |

---

<a id="ux"></a>
## 6. UX и информационная архитектура

### 6.1. Названия разделов

Рекомендация для пользователя:

- **Чат** — текстовое общение и помощники.
- **Изображения** — генерация фото/картинок/графики. Не “Фото”, если есть не-фотореалистичные результаты.
- **Музыка** — инструменталы, песни с вокалом, джинглы. Не “Аудио”, если TTS/SFX не выделены отдельно.
- **Работы** или **Медиатека** — сохранённые результаты.
- **Настройки** — профиль, уведомления, тема, данные, удаление аккаунта.

Старый route `#/media` можно сохранить как алиас, но пользовательское название должно быть понятнее.

### 6.2. Главный экран мобильного клиента

Быстрые действия:

1. Написать текст.
2. Создать изображение.
3. Создать музыку.
4. Открыть последнюю работу.

Не заставлять пользователя выбирать модель до выбора задачи.

### 6.3. Раздел “Музыка”

Первый экран:

| Режим | Capability | Что показывать |
|---|---|---|
| Песня с вокалом | `song.vocal` | текст песни, структура, язык, вокал, длительность |
| Инструментал | `music.generate` | жанр, настроение, длительность, BPM optional |
| Джингл/фон | `music.generate` | короткая длительность, назначение, CTA optional |

Если `song.vocal` unavailable:

- кнопка/режим явно disabled или “скоро/недоступно”;
- нельзя подменять MusicGen-инструменталом;
- можно предложить “написать текст песни” через chat capability.

### 6.4. Очередь и длительная генерация

Для мобильных сценариев критично:

- не держать экран открытым ради 30-минутной песни;
- показывать очередь;
- отправлять push “готово”;
- восстанавливать job после возвращения;
- показывать expired, если файл удалён;
- давать cancel без фиктивного “почти готово”.

### 6.5. Offline и ошибки

Экраны:

- нет сети;
- шина недоступна;
- модель недоступна;
- job interrupted;
- результат истёк;
- недостаточно квоты;
- требуется вход;
- сессия истекла;
- ошибка генерации;
- обновление приложения.

Каждый экран должен иметь понятное действие: повторить, открыть очередь, войти, настройки, поддержка.

---

<a id="contracts"></a>
## 7. Контракты шины для мобильного клиента

### 7.1. Минимальные endpoints

| Endpoint | Назначение | Мобильная особенность |
|---|---|---|
| `GET /v1/models` | capability catalog | кэшировать осторожно, уметь refresh |
| `POST /v1/chat/completions` | chat JSON/SSE | reconnect/stop/background |
| `POST /jobs` | создать media job | idempotency key |
| `GET /jobs/{id}` | статус | polling/backoff |
| `POST /jobs/{id}/cancel` | отмена | честный итог |
| `GET /files/{id}` | результат | auth, TTL, native download |
| `POST /devices` | регистрация устройства | push token, platform, app version |
| `DELETE /devices/{id}` | отзыв устройства | logout/revoke |
| `POST /account/deletion` | удаление аккаунта | store requirement |
| `POST /reports` | жалоба на контент | UGC/AI moderation |

Имена `/devices`, `/account/deletion`, `/reports` — предложение для контракта, не факт реализации. Финальный источник истины — OpenAPI от исполнителя шины.

### 7.2. Пример capability объекта

```json
{
  "id": "music.instrumental.small",
  "object": "model",
  "capabilities": ["music.generate"],
  "status": "ready",
  "limits": {
    "max_duration_seconds": 30,
    "max_concurrent_jobs": 1
  },
  "license_scope": "demo-only",
  "latency": {
    "source": "measured",
    "seconds": 60,
    "conditions": "15 s audio, CPU quota 8 threads"
  }
}
```

### 7.3. Пример job response

```json
{
  "job_id": "job_example",
  "status": "queued",
  "type": "music.generate",
  "model": "music.instrumental.small",
  "created_at": "2026-11-08T00:00:00Z",
  "request_id": "req_example"
}
```

### 7.4. Пример push payload

```json
{
  "type": "job.ready",
  "job_id": "job_example",
  "result_kind": "audio",
  "deep_link": "briix://jobs/job_example",
  "request_id": "req_example"
}
```

В push нельзя класть prompt, lyrics, приватный текст, ссылку с секретом или сам медиафайл.

### 7.5. Idempotency и retry

- `POST /jobs` должен принимать `Idempotency-Key` или документированный client request ID.
- Повтор после сетевого сбоя не должен создавать вторую платную/тяжёлую генерацию.
- Retry после начала генерации запрещён без явного правила.
- Клиент должен хранить pending job id локально в metadata, но не blob.

### 7.6. File TTL

- Файл имеет `expires_at`.
- После TTL API возвращает понятную ошибку `file_expired`.
- Клиент показывает “результат истёк”, предлагаетсоздать новый результат, если это допустимо.
- Нативное сохранение в Files/Photos — отдельное действие пользователя, не автоматическое вечное хранение.

---

<a id="security"></a>
## 8. Безопасность, приватность и данные

### 8.1. Секреты и токены

Запрещено:

- upstream/model API keys в JS;
- долговременные bearer tokens в localStorage;
- секреты в URL/query;
- секреты в push payload;
- приватные tunnel endpoints в production bundle;
- live-reload config в release;
- секреты в Git, логах, crash reports.

Разрешено/предпочтительно:

- короткоживущая session credential;
- HttpOnly cookie для web, если same-origin;
- Keychain/Keystore для mobile session secret;
- refresh/revoke flow;
- server-side provider credentials;
- audit-safe request IDs.

### 8.2. Данные пользователя

Нужно решить до production:

| Класс данных | Default policy | Решение владельца нужно |
|---|---|---|
| Prompts/chat messages | не хранить server-side без opt-in | да |
| Generated images/audio | TTL, пользователь может сохранить | да |
| Lyrics | чувствительный пользовательский текст | да |
| Usage metadata | хранить для квот/биллинга | да |
| Crash logs | без prompts/secrets | да |
| Analytics | только безопасные события | да |
| Push tokens | хранить до logout/revoke | да |
| Account data | deletion по запросу | да |

### 8.3. Service worker cache

Рекомендуемая политика:

- static shell: cache-first/versioned;
- icons/fonts/css/js: versioned cache;
- API: network-only или no-store;
- private media: no persistent cache без явного opt-in;
- job metadata: можно хранить минимально для recovery;
- logout/account deletion: очищать приватные caches.

### 8.4. UGC/AI content safety

Для сторов и продукта нужны:

- terms of use;
- запрет objectionable content;
- filtering/moderation reasonable для типа контента;
- report content mechanism;
- block abusive users, если есть user-to-user interaction;
- timely response process;
- AI-generated content disclosure, где уместно;
- права на модели/веса/музыку;
- запрет выдачи чужого голоса/персоналии без разрешения.

### 8.5. Account deletion

Если есть создание аккаунта:

- удаление должно быть доступно в приложении;
- для Google Play также нужен внешний web resource;
- заморозка аккаунта не считается удалением;
- связанные данные удаляются, кроме законно необходимого хранения с раскрытием в privacy policy;
- flow должен быть тестируемым для ревьюера.

### 8.6. Children/age rating

До submission:

- определить целевую возрастную аудиторию;
- заполнить age rating/content rating;
- если приложение не для детей, не позиционировать его как детское;
- проверить требования Families/child safety, если аудитория может включать детей.

---

<a id="qa"></a>
## 9. Тестирование и приёмка

### 9.1. Уровни тестов

| Уровень | Что проверяем | Инструменты/подход |
|---|---|---|
| Static | JS syntax, links, markdown, JSON examples | node --check, custom validators |
| Contract | OpenAPI/examples/fixtures | contract tests, schema validation |
| Unit | UI helpers, state machines, cache policy | test runner in packaging contour |
| Integration | chat/jobs/files/auth | staging API + fixtures |
| E2E web | mobile browser flows | Playwright/real devices |
| E2E mobile | iOS/Android shell flows | Xcode/Android Studio, device farm/manual |
| Security | storage, cache, logs, tenant isolation | manual + automated checks |
| Performance | startup, memory, battery, network | profiling, metrics |
| Accessibility | screen reader, contrast, touch | axe/manual |
| Store dry-run | forms, screenshots, review notes | checklist |

### 9.2. Матрица устройств

Минимум для beta:

- iPhone: актуальная iOS и предыдущая major;
- iPhone с малым экраном;
- iPad optional, если заявляем поддержку;
- Android: актуальный flagship/mid-range;
- Android: бюджетное устройство с слабой сетью/RAM;
- Android: устройство без Google services, если целируем RuStore/альтернативы;
- мобильный браузер: Safari iOS, Chrome Android.

### 9.3. Матрица сети

- Wi-Fi stable;
- LTE/5G stable;
- weak signal/high latency;
- offline до запуска;
- offline во время SSE;
- offline во время job polling;
- переключение Wi-Fi → cellular;
- background → foreground;
- приложение убито и открыто по push.

### 9.4. Ключевые E2E сценарии

1. Первый запуск → выбор режима → честная маркировка.
2. Вход → чат → stream → stop.
3. Чат → обрыв сети → interrupted → reconnect.
4. Изображения → prompt → job → ready → download/share.
5. Музыка instrumental → job → ready → play/share.
6. Музыка vocal unavailable → не подменяется инструменталом.
7. Job running → reload/app restart → recovery.
8. Job ready → push → deep link → result.
9. File expired → понятный экран.
10. Logout → session cleared → private cache cleared.
11. Account deletion → request → confirmation → data removed.
12. Report content → submitted → moderation queue.
13. Quota exceeded → понятная ошибка.
14. Model unavailable → capability disabled.
15. Update app → active job not lost.

### 9.5. Performance budgets

Предварительные ориентиры, уточнить после PoC:

- cold start до interactive shell: ≤ 3 с на среднем устройстве;
- открытие раздела: ≤ 500 мс после shell;
- первый chat token: зависит от шины, но UI должен показывать состояние сразу;
- job creation response: ≤ 2 с при нормальной сети;
- polling backoff: не чаще 1–2 с в active running, дальше реже;
- память: не хранить большие blobs в JS heap/localStorage;
- батарея: не держать постоянный foreground polling для длительной задачи.

### 9.6. Regression gates

Перед каждым mobile release:

- contract tests зелёные;
- ключевые E2E зелёные;
- нет blocker crash;
- privacy/cache checks зелёные;
- store forms не устарели;
- target SDK/API requirements проверены;
- signing/push certs валидны;
- release config без debug endpoints.

---

<a id="release"></a>
## 10. Сборка, CI/CD, подписи и релизы

### 10.1. Почему отдельный packaging-контур

Текущая демка — статик без npm. Capacitor требует современный web project/build output. Поэтому:

- публичная демка остаётся статической;
- mobile packaging живёт отдельно;
- web assets экспортируются/копируются в `webDir`;
- npm/native dependencies не попадают в текущую статику;
- mobile repo не содержит серверных секретов.

### 10.2. Пример структуры mobile-packaging

```text
briix-mobile/
  package.json
  capacitor.config.ts
  web-assets/ или www/
  ios/
  android/
  scripts/
    export-web-assets.sh
    verify-release-config.sh
  docs/
    RUNBOOK.md
    SIGNING.md
    PUSH.md
    STORE_SUBMISSION.md
```

Это пример, не созданная структура.

### 10.3. Пример Capacitor config

```json
{
  "appId": "ru.briix.app",
  "appName": "BRIIX",
  "webDir": "www",
  "bundledWebRuntime": false
}
```

`appId` примерочный. Финальный ID утверждает владелец. `bundledWebRuntime` может зависеть от версии Capacitor; перед реализацией сверить актуальный config schema.

### 10.4. Versioning

- marketing version: `1.0.0`, `1.1.0`;
- iOS build number: монотонный integer;
- Android versionCode: монотонный integer;
- каждый store upload имеет уникальный build marker;
- нельзя молча перезаписывать чужой build;
- release notes связаны с commit hash.

### 10.5. Signing

iOS:

- Apple Developer account;
- certificates/provisioning profiles;
- App Store Connect access;
- push key/APNs configuration;
- secrets в CI vault, не в repo.

Android:

- Play Console account;
- upload key/keystore;
- Play App Signing;
- FCM configuration;
- keystore backup в защищённом хранилище;
- пароли не в repo/logs.

RuStore/альтернативы:

- отдельные требования к подписи/APK/AAB;
- проверить уникальность package name;
- проверить модерацию и data safety forms.

### 10.6. CI pipeline

Минимум:

1. lint/static checks web assets;
2. contract tests/fixtures;
3. export web assets;
4. Capacitor sync;
5. iOS build on macOS runner;
6. Android build AAB;
7. verify release config/no debug URL;
8. sign artifacts;
9. upload to TestFlight/Play internal;
10. attach commit hash/build marker;
11. notify coordinator.

### 10.7. Release trains

- `internal`: команда, быстрые проверки;
- `beta`: TestFlight external / Play closed;
- `staged`: ограниченный rollout;
- `production`: полный rollout;
- `hotfix`: только blocker fixes, полный regression gate.

---

<a id="stores"></a>
## 11. Сторы: Apple, Google Play, RuStore/альтернативы

### 11.1. Apple App Store

Ключевые требования:

- приложение должно быть больше, чем repackaged website;
- UGC/AI content apps должны иметь filtering/reporting/blocking где применимо;
- если есть account creation, нужен account deletion внутри приложения;
- privacy labels должны соответствовать реальному коду/SDK;
- privacy manifests/required reason APIs для third-party SDK;
- SDK minimum requirements на дату submission;
- TestFlight builds живут до 90 дней;
- external testing может требовать beta review;
- screenshots должны показывать приложение, а не просто сайт;
- demo account для ревьюера, если есть login;
- payments для цифрового контента должны соответствовать правилам Apple.

Чеклист Apple:

- [ ] app-like navigation/value;
- [ ] no placeholder/mock as live;
- [ ] privacy policy link;
- [ ] privacy labels;
- [ ] privacy manifest/required reasons audit;
- [ ] account deletion;
- [ ] UGC moderation/reporting;
- [ ] age rating;
- [ ] export compliance/encryption;
- [ ] demo account/review notes;
- [ ] screenshots;
- [ ] support URL;
- [ ] signing/provisioning;
- [ ] Xcode/SDK requirement check.

### 11.2. Google Play

Ключевые требования:

- adequate functionality и engaging UX;
- запрет webview spam;
- target API level requirement на дату submission;
- AAB для новых приложений;
- Data safety section;
- privacy policy в listing и внутри приложения;
- account deletion in-app + external web resource;
- UGC policy: terms, moderation, report/block;
- closed testing для новых personal accounts, если применимо;
- payments policy для цифровых товаров.

Чеклист Google Play:

- [ ] app-like value;
- [ ] target API проверен;
- [ ] AAB signed;
- [ ] Data safety заполнен;
- [ ] privacy policy;
- [ ] account deletion in-app + web;
- [ ] content rating;
- [ ] UGC moderation;
- [ ] closed testing requirement checked;
- [ ] screenshots/store listing;
- [ ] FCM/push config;
- [ ] no crash/blocker functionality.

### 11.3. RuStore и альтернативная Android-дистрибуция

Зачем может понадобиться:

- российская аудитория;
- устройства без Google services;
- снижение зависимости от одного стора;
- отдельные требования к публикации/модерации.

Что проверить:

- регистрация разработчика;
- APK/AAB requirements;
- подпись;
- уникальность package name;
- модерация;
- data safety/privacy forms;
- beta testing limitations;
- staged publication;
- payments, если применимо.

Не делать отдельные “клоны” приложения ради сторов без необходимости. Один Android-артефакт может публиковаться в нескольких каналах, если это разрешено и технически корректно.

### 11.4. TWA как Android-альтернатива

TWA подходит, если:

- PWA уже сильная;
- нужен fullscreen без browser UI;
- есть Digital Asset Links;
- не нужны глубокие нативные функции.

Риски:

- меньше контроля над native UX;
- зависимость от Chrome;
- store review может посчитать thin wrapper;
- push/files/native storage ограничены по сравнению с Capacitor.

Решение: TWA рассматривать только после PWA acceptance и отдельного сравнения с Capacitor.

---

<a id="payments"></a>
## 12. Монетизация и платежи

### 12.1. Варианты

| Вариант | Плюсы | Минусы/риски |
|---|---|---|
| Только web-подписка, приложение бесплатно | проще платежи, меньше store billing complexity | нужно проверить правила сторов о внешних ссылках/оплате |
| In-app purchase/subscription | нативный путь, может быть обязателен для цифрового контента | комиссия, интеграция, refund/receipt validation |
| Гибрид: web + IAP | гибкость | сложная синхронизация entitlements |
| Beta/free без платежей | быстрее проверить продукт | нельзя масштабировать выручку |

### 12.2. Что решить до submission

- продаём ли цифровой доступ внутри приложения;
- какие тарифы/квоты;
- нужен ли trial;
- как восстанавливать покупки;
- как обрабатывать refunds;
- как синхронизировать web и mobile entitlements;
- какие страны/валюты;
- какие налоги/юридические требования;
- можно ли использовать внешний checkout в конкретных сторах/регионах.

### 12.3. Минимальная архитектура billing

- server-side entitlement service;
- receipt/transaction validation;
- webhook/notification handling;
- idempotent grant/revoke;
- audit trail;
- user-visible subscription status;
- restore purchases flow;
- support runbook для платежей.

Не реализовывать billing “на клиенте”. Клиент только показывает статус и инициирует покупку.

---

<a id="ops"></a>
## 13. Наблюдаемость, аналитика и поддержка

### 13.1. Метрики

Технические:

- crash-free sessions;
- ANR;
- cold start time;
- API error rate;
- SSE disconnect rate;
- job success/failure/cancel/expired;
- push delivery/open rate;
- file download/share success;
- app version adoption.

Продуктовые:

- первый успешный chat/image/music;
- время до первого результата;
- повторное использование;
- retention;
- conversion в платный тариф, если есть;
- какие режимы музыки выбирают;
- доля vocal unavailable.

### 13.2. Что нельзя логировать

- prompts/lyrics по умолчанию;
- session tokens;
- push tokens в открытом виде;
- приватные file URLs с секретами;
- персональные данные без необходимости;
- полный response модели в crash logs.

### 13.3. Поддержка

Нужны:

- support email/форма;
- privacy contact;
- account deletion contact/web resource;
- статус-страница или понятный экран unavailable;
- feedback triage;
- bug report с app version/device/request ID, но без prompts.

### 13.4. Runbooks

Минимум:

- модель недоступна;
- очередь перегружена;
- push не доставляется;
- file storage/TTL сбой;
- утечка session/token;
- crash после релиза;
- store rejection;
- истёк сертификат/ключ;
- требуется срочный rollback;
- аккаунт удалён, но данные остались.

---

<a id="risks"></a>
## 14. Риски и mitigations

| ID | Риск | Impact | Mitigation | Owner | Trigger |
|---|---|---|---|---|---|
| R-01 | Шина задерживается | мобильный план стоит | M0 gate, fixtures, не угадывать API | INFRA | нет контракта |
| R-02 | Пустая WebView-обёртка | отказ стора | native value M4, app-like UX | Mobile+Product | нет push/files/navigation |
| R-03 | Мок выдан за live | потеря доверия/rejection | mode labels, no silent fallback | Frontend+QA | live error → mock |
| R-04 | MusicGen выдан за вокал | обман пользователя | capability split, disabled vocal | Product | vocal route absent |
| R-05 | Секреты в клиенте | компрометация | secure storage, server-side keys | Security | token in JS/localStorage |
| R-06 | Приватные данные в cache | утечка | no-store API, cache audit | Security+Frontend | SW caches responses |
| R-07 | Долгая генерация убивает UX | churn | jobs+push+recovery | Backend+Mobile | screen must stay open |
| R-08 | Store privacy forms не совпадают | rejection | privacy mapping, SDK audit | Security | Data safety mismatch |
| R-09 | Account deletion отсутствует | rejection | M5-06, in-app+web | Backend | account creation exists |
| R-10 | UGC moderation отсутствует | rejection | report/filter/block | Product+Backend | AI content sharing |
| R-11 | Payments нарушают правила | rejection/потеря выручки | billing decision M7 | Owner+Legal | digital subscription |
| R-12 | Target SDK/API устарел | upload blocked | compliance calendar | DevOps | store deadline |
| R-13 | Signing/push keys потеряны | релиз невозможен | vault/backup runbook | DevOps | key rotation |
| R-14 | Разные web/mobile контракты | баги/регресс | один OpenAPI, contract tests | Backend+Frontend | fields diverge |
| R-15 | On-device modelsпреждевременно включены | размер/батарея/лицензии | M9 gate, PoC | Product+Mobile | native inference request |
| R-16 | РФ-дистрибуция/платежи не проверены | недоступность/юридика | отдельный legal/store track | Owner+Legal | RU launch decision |
| R-17 | Тестировщики Play не engaged | production access denied | closed testing plan, instructions | Coordinator | personal account requirement |
| R-18 | TestFlight build истёк | beta прервана | calendar, rebuild | Mobile | 90 days approaching |
| R-19 | Push payload раскрывает данные | privacy incident | safe payload spec | Security | prompt in push |
| R-20 | File TTL ломает доверие | “результат пропал” | expired UX, save action | Product+Frontend | file deleted |

---

<a id="timeline"></a>
## 15. Оценка последовательности и критический путь

Это относительная оценка после готовности M0. Не календарное обещание.

| Этап | Ориентир | Критический путь | Можно параллелить |
|---|---|---|---|
| M0 | зависит от #23 | да | docs/fixtures |
| M1 | 1–2 недели | да | a11y/security checks |
| M2 | 3–7 дней | нет | icons/design |
| M3 | 1–2 недели | да | CI/signing |
| M4 | 2–3 недели | да | push/files/navigation |
| M5 | 1–3 недели | да | backend extensions |
| M6 | 2–4 недели | да | beta feedback |
| M7 | 1–3 недели + review | да | legal/payments |
| M8 | ongoing | нет | ops |
| M9 | отдельный R&D | нет | PoC |

Критический путь:

```text
#23 contract → M1 mobile web → M3 packaging → M4 native value
→ M5 backend mobile extensions → M6 beta → M7 store submission → M8 launch
```

PWA можно сделать раньше или параллельно, но она не заменяет store compliance.

---

<a id="raci"></a>
## 16. Роли и ответственность

| Роль | Ответственность |
|---|---|
| Владелец | продуктовые решения, бюджет, сторы, платежи, финальный GO |
| Координатор BRIIX | приоритеты, gates, ревью не-автором, интеграция, релизные решения |
| INFRA / исполнитель #23 | шина, модели, jobs/files, приватный контур, contract pack |
| Frontend | web UI, mobile web, PWA, mode labels, client contracts |
| Mobile | Capacitor shells, native plugins, signing, store builds |
| Backend | auth/session, devices/push, account deletion, moderation, billing |
| Security/Privacy | storage/cache/logs, privacy forms, SDK audit, threat model |
| QA | device/network matrix, E2E, regression, beta triage |
| DevOps | CI/CD, secrets, monitoring, rollout/rollback |
| Design/Product | UX, названия разделов, screenshots, store listing, feedback |
| Legal | лицензии моделей/музыки, terms/privacy, payments, RU-дистрибуция |

Правило: автор поставки не делает финальное независимое ревью. Для mobile/store releases нужен отдельный reviewer/checklist owner.

---

<a id="next"></a>
## 17. Ближайшие 10 действий

1. Дождаться от #23 contract pack и capability matrix.
2. Проверить, что vocal route не подменён MusicGen.
3. Зафиксировать auth/session модель для mobile.
4. Провести mobile web audit текущей демки/live-клиента.
5. Утвердить названия разделов: Чат / Изображения / Музыка / Работы.
6. Решить, нужен ли PWA до сторов или только как промежуточный этап.
7. Утвердить appId/bundleId и название приложения.
8. Создать отдельный mobile-packaging контур, не трогая текущую статику.
9. Составить privacy/data mapping для prompts/media/push/account deletion.
10. Назначить независимого reviewer для мобильного плана и будущих сборок.

---

<a id="unverified"></a>
## 18. Что осталось непроверенным

- Фактическая готовность шины #23, `sd-server`, текстового маршрута, jobs/files и приватного туннеля.
- Реальные задержки ACE-Step/vocal route на стенде A и RAM-гейт.
- Мобильный live E2E: SSE reconnect, job recovery, push, file TTL.
- Поведение текущей демки на реальных iOS/Android устройствах после live-подключения.
- App Store/Google Play/RuStore approval: план не гарантирует прохождение ревью.
- Актуальные требования сторов на дату будущей submission; их нужно перепроверить перед upload.
- Платёжная модель, налоги, страны, юрлицо/аккаунты разработчиков.
- Лицензии конкретных весов/музыкальных моделей для коммерческого мобильного сценария.
- Независимое ревью этого плана не-автором.
- Браузерные/мобильные тесты в этой поставке не запускались: поставка документная.

---

<a id="sources"></a>
## 19. Источники

### Внутренние

- `AGENTS.md` — правила работы, статик без сборки, отчёты в `audits/`.
- `docs/BRIIX.md` — канон продукта, мобильное приложение вне раннего MVP.
- `ai-platform-docs/README.md`, `PRODUCT.md`, `API.md`, `ARCHITECTURE.md`, `AUTH_SECURITY.md`, `DELIVERY_OPS.md`.
- `audits/task-23-model-bus-request.md` — запрос к шине и контрактные требования.
- GitHub issue #23 и PR #22/PR #24.

### Внешние официальные/первичные

Проверено при подготовке плана 2026-11-08. Перед submission требования перепроверить.

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
  - 4.2 Minimum Functionality: приложение должно быть больше, чем repackaged website.
  - 1.2 User-Generated Content: filtering/reporting/blocking для UGC/AI content apps.
  - 5.1.1(v): account deletion при account creation.
- Apple Upcoming Requirements: https://developer.apple.com/news/upcoming-requirements/
  - SDK minimum requirements, в частности Xcode/iOS SDK требования на дату загрузки.
- Apple privacy manifests/required reason APIs: https://developer.apple.com/news/?id=pvszzano
- Apple TestFlight overview: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
  - external testers до 10,000, build testing до 90 дней, external beta review.
- Apple Home Screen web apps / WWDC23: https://developer.apple.com/videos/play/wwdc2023/10120/
- Google Play Developer Program Policy: https://support.google.com/googleplay/android-developer/answer/18265346
  - functionality, webview spam, UGC, Data safety, privacy policy, account deletion.
- Google Play User Data: https://support.google.com/googleplay/android-developer/answer/10144311
- Google Play target API levels: https://support.google.com/googleplay/android-developer/answer/11926878
- Google Play testing requirements for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Capacitor: https://capacitorjs.com/docs/getting-started
- Capacitor iOS: https://capacitorjs.com/docs/ios
- Capacitor plugins: https://capacitorjs.com/docs/apis
- Chrome Trusted Web Activity quick start: https://developer.chrome.com/docs/android/trusted-web-activity/quick-start/
- MDN PWA overview: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app
- RuStore publishing instructions: https://www.rustore.ru/help/en/developers/publishing-and-verifying-apps/app-publication

---

<a id="delivery"></a>
## 20. Письмо о поставке

- **Что сделано и зачем:** сформирован подробный план мобильного пути BRIIX: mobile web → PWA → Capacitor/store shells → beta/submission/ops; зафиксированы gates, backlog, риски, контракты, безопасность, сторы и ближайшие действия.
- **Ветка:** `arena/969dcca5-briix-ru`.
- **Файлы поставки:** `audits/2026-11-08-mobile-app-roadmap.md`, обновление `audits/README.md`, [evidence JSON](evidence/2026-11-08-mobile-app-roadmap-check.json) с локальными проверками.
- **Push:** фиксируется после фактической проверки remote; до push эта строка не считается доказательством.
- **Как проверено:** локальные документные проверки, markdown/links/JSON examples, базовый regression gate репозитория; результаты в [evidence JSON](evidence/2026-11-08-mobile-app-roadmap-check.json).
- **Что красное и почему:** blocker-ошибок документа нет, если evidence PASS; live/mobile/store проверки не выполнялись.
- **Границы:** только `audits/`; приложение, `docs/`, `site/`, серверы, модели, сторы и чужие ветки не тронуты.
- **Следующий адресат:** координатор BRIIX → INFRA/#23 для контрактного гейта; затем frontend/mobile исполнители.
- **Независимое ревью:** требуется не-автором до использования плана как основания для реализации/публикации.

[Наверх](#top)
