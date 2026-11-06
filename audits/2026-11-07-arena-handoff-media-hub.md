# HANDOFF для следующей сессии арены — медиа-хаб BRIIX (07.11.2026)

**Координатор:** дежурная сессия. **Кому:** следующая arena-сессия по репо `bestdeejay-design/briix.ru`.
**Прочти это первым.** Здесь: что уже сдано, что осталось, решения владельца, и сохранённый лог размышлений предыдущей сессии (владелец вытащил его из упавшей песочницы).

## 1. Правила поставки (нарушались дважды)

1. **Пуш ветки в `bestdeejay-design/briix.ru` — часть поставки.** Отчёт «работает на порту 3000» поставкой не считается (инцидент №16, дважды).
2. В архивный `rucorp/briix` не пушить (read-only).
3. Отчёт принимается только с проверяемыми артефактами на remote (коммит, evidence).

## 2. Что уже сдано и влито в main (не переделывать)

- **UI-демо помощников** — PR #17 (`2518c73`, `286eebb`): 6 помощников, чат, промпты, история, избранное, настройки, приёмы из `site/` (тень шапки, reveal, FAQ, scrollspy).
- **Тёмная тема «премиальный матовый чёрный»** — `ec16a5a`: 3 нейтральные ступени (bg `#0d0e10`, surface `#141619/#1a1d21/#23262b`), текст `#eceef2/#a6aab3/#767b84`, бордеры rgba(255,255,255,.08/.14), акцент sage `#b3c49c`. Палитра утверждена владельцем, не менять без его слова.
- **Медиа-студия (локальный мок)** — PR #18 (`929a8a5`, `b829b9c`): маршрут `#/media`, вкладки создание/медиатека/очередь/модели/рецепты, 5 рецептов, 9 моделей в справочном каталоге, очередь с восстановлением после reload, лимиты 6 активных/40 истории, референсы-метаданные, скачивание (canvas center-crop фото, MP4/WebM видео), ассеты `assets/media/` (3 JPEG + 6 MP4 + 6 WebM + manifest, ~1.94 MiB), тулзы `tools/build-media-assets.py` + `check-*.cjs`, отчёты `audits/2026-11-06-*.md` + evidence JSON.

## 3. Открытые пункты (из лога предыдущей сессии — продолжить отсюда)

1. **Запись Veo в каталоге устарела.** В логе сессии: Veo 3.1 Preview отключён 22.10.2026, актуальный маршрут — Gemini Omni Flash (`https://aistudio.google.com/docs/models/gemini-omni-flash`). В сданном `media.js` каталог всё ещё содержит `Veo 3.1` — заменить/дописать note.
2. **Добавить Kandinsky 5.0** (10-я модель): код MIT (`github.com/kandinskylab/kandinsky-5`), веса отдельной лицензией; РФ-контур — Шедеврум (тарифы `shedevrum.ai/subscriptions`, условия `yandex.ru/legal/shedevrum_termsofuse/ru/`), FusionBrain API (free 100/мес только Kandinsky 3.0 — первоисточник уточнить на developers.fusionbrain.ai).
3. **Видео-кадр в headless-скриншотах пустой** (.currentTime идёт, картинка бежевая): вопрос — Swiftshader-декодинг или кадр реально пуст; проверить извлечением кадра ffmpeg + canvas-пиксели, а не скриншотом.
4. **CSP**: в логе было подозрение «CSP media-src none» — grep по index.html CSP-заголовков ничего не нашёл (Pages не отдаёт CSP), но проверить `media-src`/`img-src` в мета-тегах и подтвердить в отчёте.
5. **Воспроизводимость сборки**: `tools/build-media-assets.py` детерминирован на committed masters, но `--source-dir` с оригиналами генераций не закоммичен; решить: коммитить masters или описать в отчёте ограничение.
6. **Модельный каталог 9 → 10** после добавления Kandinsky: обновить сетку, отчёты и счётчики в текстах.

## 4. Решение владельца по подключению моделей (07.11)

Владелец спросил: «какие модели можем подключить из уже подключённых и ключей в наличии». Ответ координатора (зафиксирован в issue-обсуждении этапа):
- **Платных media-API ключей не зарегистрировано** (INFRA-реестр пуст по OpenAI/Google/BFL/Stability/Ideogram/Replicate/fal/HF).
- **В наличии GPU-сервер с Ollama** (fonotext стенд B, LAN-only через A) — теоретически способен держать открытые веса (FLUX.2 Klein 4B Apache-2.0, Wan 2.2 Apache-2.0), но это чужой контур: использование под BRIIX требует отдельного решения владельца и координатора инфраструктуры, в демо не лезть.
- **Для статики briix.ru (GitHub Pages) реальные API из браузера не подключаются** (ключи в браузере запрещены каноном; CORS/секреты). Реальное подключение = прокси-backend, это задачи П-5/П-13 монорепо `bestdeejay-design/ai-platform`.
- Демо остаётся локальным моком с честной маркировкой; справочный каталог моделей — витрина без сети.

## 5. Сохранённый лог размышлений предыдущей сессии (verbatim, владелец)

> (сохранено владельцем из упавшей песочницы; даёт контекст планов и находок)

- Сверка main и правок тем: интерфейс только полировать, сохраняя композицию и сценарии. Отдельный разбор демо на противоречия; ресёрч контентного хаба: фото, видео, модели, лицензии, ограничения бесплатных вариантов. Медиа-раздел изолированно.
- main уже содержит матовую тёмную палитру — взята за основу, светлая сохранена. Под «csv» понимать CSS; отдельных CSV нет.
- Ссылка = **Gen AI Studio** (не GenMix). В ресерче разделить витринные названия моделей и реально доступные API. Медиа-хаб — самостоятельный демо-раздел BRIIX: бриф, рецепты, очередь, медиатека, без фиктивных списаний кредитов и без ключей в браузере. Рецепт бесплатного мок-контента — с честными условиями.
- Проверяемые находки: контраст подсказок клавиш в тёмной теме, задержка перекраски при смене темы, слабая валидация импорта. Исправления точечные; палитра сохранена.
- Загруженные первоисточники (52 URL): shedevrum.ai (+subscriptions, yandex legal terms), kandinskylab/kandinsky-5 (+LICENSE), docs.bfl.ai (generating_images, pricing, credits_billing, flux_2 overview, release notes), ai.google.dev/gemini-api (pricing, veo, image-generation), aistudio.google.com (pricing, gemini-omni-flash), developers.openai.com (gpt-image-2.5-flare, video-generation), docs.dev.runwayml.com/pricing, docs.ideogram.ai (pricing, plans, api-reference), docs.recraft.ai/pricing, docs.agents.lumalabs.ai (pricing), platform/docs.stability.ai (getting-started, pricing), docs.fal.ai (queue, pricing, media-expiration, concurrency, privacy), docs.replicate.com (billing), huggingface.co (pricing, inference-providers, hub billing), github Lightricks/LTX-2 (+LICENSE-2), Wan-Video/Wan2.2 (+LICENSE), docs.comfy.org (ltx-2-3).
- Отладка видео: 404 был из-за **неправильного маппинга имён файлов** (asset→video filename), а не harness'а; фикс — явное свойство `video:` в ASSETS. Все запросы источников должны быть 200, проверка playback dimensions/crop. Скриншот после play может быть пуст из-за софтверного декодинга — сверять кадр через canvas-пиксели/ffmpeg.
- Итоговые источники для цитат в ресерче: ai.google.dev/gemini-api/docs/pricing, docs.bfl.ai/quick_start/pricing, docs.dev.runwayml.com/guides/pricing/, huggingface.co/docs/inference-providers/pricing (+index).

## 6. С чего начать следующей сессии

1. Прочитать этот файл + `audits/2026-11-06-media-hub-research.md` + `audits/2026-11-06-demo-code-css-audit.md`.
2. Взять пункт 3 (открытые вопросы) по одному; работа — в новой ветке `arena/<id>-briix-ru` от **свежего main**, пуш до отчёта.
3. Ничего сверх списка не расширять без брифа владельца.
