# Аудит и доработка BRIIX Студии: единая multimodal-лента и очередь

**Дата:** 2026-11-09  
**Ветка:** `arena/94cc0c68-briix-ru`  
**Экран:** `/studio.html`

## Что было не так в версии предыдущего агента

| Приоритет | Находка | Последствие |
|---|---|---|
| Блокер | Один глобальный `busy` и один перезаписываемый `AbortController` | Новый запрос мешал предыдущему; composer блокировался; два ожидания теряли независимость |
| Блокер | Музыка отправляла `params.duration_seconds` | Реальный BFF читает только `params.duration`, поэтому выбранная длительность не применялась |
| Блокер | UI предлагал 240/300 с при серверных лимитах 30/150 с | Тест fake-BFF был зелёным, реальный сервер мог отклонить запрос |
| Высокий | Pending-карточка появлялась только после `POST /jobs` и автоматической лирики | До первого ответа интерфейс выглядел зависшим |
| Высокий | Модель выбиралась только для музыки; chat/photo были зашиты | Нельзя было сменить модель прямо в общем чате |
| Высокий | Лента не сохранялась, running job не восстанавливался | Reload терял работу и контекст |
| Высокий | Ключ из `?key=` оставался в URL | Ключ мог остаться в истории браузера и referrer |
| Средний | Не было per-card Stop/retry/download/provenance | Пользователь не управлял конкретной генерацией |
| Средний | Контраст служебного текста был ниже WCAG AA | Мобильный axe нашёл `color-contrast` |
| Безопасность | В старом config snapshot был plaintext bearer token | Значение удалено из рабочего дерева; поскольку оно было в истории Git, токен следует ротировать |

## Research → решения

Использованы первичные рекомендации:

- [Microsoft Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf): ясные возможности, видимый статус, эффективные dismissal/correction, память последних взаимодействий.
- [Google PAIR — Feedback + Control](https://pair.withgoogle.com/guidebook-v2/chapter/feedback-controls): баланс автоматизации и контроля, понятный эффект действий пользователя.
- [NN/g — Prompt Controls in GenAI Chatbots](https://www.nngroup.com/articles/prompt-controls-genai/): стандартные подписи, группировка controls, подсказки рядом с composer.
- [NN/g — AI Chatbot Design Guidelines](https://www.nngroup.com/articles/ai-chatbots-design-guidelines/): визуальный контент прямо в ответе, progressive disclosure, не дёргать пользователя autoscroll во время потока.
- [NN/g — Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/): конкретная причина и следующий путь исправления вместо исчезающего generic toast.

Реализация:

1. **Сразу видно, что всё работает.** Пользователь и assistant pending-card добавляются синхронно до первого `fetch`. Спиннер, модель, этап, elapsed time и текст «Можно писать дальше» видны сразу.
2. **Composer не блокируется.** Нет глобального busy. Следующий текст, фото или трек можно отправить во время предыдущей генерации.
3. **Независимые задачи.** У каждого результата свой ID, config snapshot, AbortController и serverJobId. Смена модели влияет только на следующий запрос.
4. **Очередь.** Media preflight и polling не затирают siblings; локальная очередь явно подписана. Chat идёт независимо. Временный network failure получает повторные попытки подключения к тому же job.
5. **Одна лента.** Текстовый SSE, PNG и audio появляются в своих карточках. Есть Stop, retry, edit, copy, download, lyrics и provenance details.
6. **Живой выбор модели.** `/v1/models` — источник ready status и latency. Qwen, FLUX, MusicGen, ACE-Step Flash/Pro выбираются из одного menu; выбор модели сам переключает нужный режим.
7. **Полноценная песня.** При пустой лирике Qwen сначала пишет её; ACE-Step получает `model`, `lyrics`, `language`, `duration`. Доступны 30/60/120/180/240/300 с. Длительность не блокирует composer.
8. **Восстановление.** Лента и drafts сохраняются без bearer token/blob/base64. После reload media polling продолжается по serverJobId без повторного POST.
9. **Мобильная доступность.** Тач-таргеты ≥44 px, нет horizontal overflow, keyboard menu, persistent H1, announcer, reduced-motion, WCAG contrast.
10. **Безопасная ссылка.** `?key=` сохраняется в localStorage и немедленно вычищается из адресной строки через `history.replaceState`.

## Backend contract

`tools/media-bff-config/bff.py` синхронизирован с живым стендом и UI:

- SHA guard остановил первый deploy: живой BFF уже содержал более новые исправления, отсутствовавшие в снимке репозитория. Ничего не было перезаписано.
- Получен и проверен полный live diff. В снимок перенесены FIFO-бюджет потоков, отдельный chat budget, восстановление queued jobs после рестарта, отмена основного и cover/GPU-процессов, M4A с lyrics, а также CPU/GPU vocal routes.
- Фактические `max_duration` Flash/Pro на живом стенде уже равны 600 с, timeout обеих моделей — 2400 с. В `/v1/models` исправлены устаревшие advertised limits 30/150 на фактические 600 с. В Studio по-прежнему доступен спокойный выбор 30–300 с без блокировки composer.
- `tools/check-live-stand.cjs` получил фазы `song-flash-60` и `duration-300`.

Обновление живого BFF выполняется только явным `workflow_dispatch` с `update_bff=true`. Deploy имеет SHA-256 guard: неизвестная live-версия не перезаписывается. Перед установкой создаётся backup, затем проверяются service, `/health`, каталог и реальный приём job на 300 с. Обычный PR аудит deploy не выполняет. При раннем сбое workflow не публикует старый audit log как результат нового запуска.

## Проверено в браузере (fake BFF, боевой frontend transport)

`tools/check-studio.cjs`: **10/10**

- пять моделей из живого каталога;
- inline key и scrub `?key=`;
- два независимых chat stream с мгновенным spinner и свободным composer;
- смена модели во время ожидания: фото + MusicGen + Qwen в одной ленте;
- две песни: Qwen lyrics, `params.duration=60/300`, независимые Flash/Pro;
- отмена одной задачи не отменяет sibling;
- reload продолжает polling без дубликата;
- owner few-shot improve + undo;
- inline moderation errors с edit path;
- 390×844: spinner, следующий prompt, touch targets ≥44, **0 axe violations**.

Дополнительно:

- `check-chat-live.cjs`: **11/11**;
- `check-music-live.cjs`: **17/17**;
- `check-media-live.cjs`: **12/12**;
- `check-mobile-live.cjs`: **8/8**;
- `check-live-stand.cjs --self-test`: все фазы, включая 60/300;
- JS syntax, Python compile, `git diff --check` — пройдены.

Скриншот/evidence: `BRIIX_TEST_OUT/studio-mobile-pending.png`, `studio-regression.json`. Studio suite добавлена в `demo-ci.yml`. В `tools/browser-env.cjs` удалён `--disable-web-security`, чтобы headless browser не скрывал CORS-проблемы SSE.

## Что проверяется на реальном стенде

После push запускается `Live stand audit` с `update_bff=true` и фазами `catalog,duration-300,song-flash,chat`. Результат и run URL должны быть добавлены сюда перед итоговой сдачей.

**Полное пятиминутное аудио 300 с отдельно не прослушивалось.** Фаза `duration-300` подтверждает принятие job контрактом и сразу отменяет его, чтобы не занимать стенд пятиминутным inference; `song-flash` отдельно проверяет реальный аудиофайл. Fake-BFF проверки не выдаются за реальный inference.
