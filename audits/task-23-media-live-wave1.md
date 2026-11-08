# Волна 1, issue briix.ru#23 — «Приватный live» (media-bff + клиент v2)

Дата: 08.11.2026 · Ветка: `feat/media-live` (от `origin/main`, не пушится в main) · Исполнитель: clean-room executor

## Что сделано

### Клиент (этот репо)
- `media.js`: storage **v1→v2** — v2 = v1 + опциональные `mode/serverJobId/resultUrl/provenance`. Валидатор принимает v1 (апгрейд на лету, без потерь, миграция персистится сразу) и v2; мусор → прежний protected-баннер, хранилище не перезаписывается. Live-статусы: `queued/running/ready/error/cancelled/interrupted/expired`. Все маркировки «Локальный мок» переключаются по режиму (`originLabel()`); mock-пайплайн (MAX_JOBS/MAX_ACTIVE/MAX_PROMPT, persist, trimCapacity) не изменён.
- `media-live.js` (новый): явный переключатель «Приватный live (эксперимент)», POST `/jobs` на `http://127.0.0.1:8300` (туннель), поллинг, результат — **blob-URL в памяти** (никакого base64 в localStorage), provenance (модель/параметры/wall_clock/queued) в деталях, reload во время running → восстановление поллингом по `serverJobId`, сервер недоступен → `interrupted` + баннер «Мок-режим (live недоступен)», 404 после cleanup → «Результат истёк». Bearer-токен — отдельный ключ localStorage `briix-media-live-token`, вводится пользователем, в git и в экспорт не попадает.
- `index.html`: точечно подключён `media-live.js` (после `media.js`).
- `tools/briix-media-live-up.sh` / `-down.sh`: статика 8388 + ssh-туннель 8300→stand:8390 (ControlMaster), idempotent, lsof-чистый down, вердикт по `/health`.
- `tools/check-media-live.cjs` (новый): 8 проверок Т3/Т4/Т5/Т7 c self-contained fake-bff (порт 8300) и статикой на 8388.

### Сервер (fonotext-stand A, user badai; всё вне git, копия исходников только на A)
Каталог `~/briix-media/media-bff/`: `bff.py` (aiohttp, bind 127.0.0.1:8390), `.env` (600, bearer `openssl rand -hex 32`), `cron-cleanup`, `results/`, `logs/` (ротация 10MB×3). Рядом: `~/briix-media/musicgen-cli.py`, `~/briix-media/adapter-venv` (отдельный venv), `~/briix-media/ollama-models`.
Юниты `~/.config/systemd/user/`: `media-bff.service`, `ollama-briix.service` (ollama :11436, OLLAMA_MODELS=~/briix-media/ollama-models, NUM_PARALLEL=1, KEEP_ALIVE=5m). Cron: `30 * * * * ~/briix-media/media-bff/cron-cleanup` (retention 24ч, idempotent).

API: POST `/jobs` {type: image|music|text, prompt, params} → 202 {job_id}; 400 схема / 401 без bearer / 429 очередь полна (+Retry-After) / 503 бэкенд недоступен или выключен. GET `/jobs/{id}` (статусы + provenance), POST `/jobs/{id}/cancel` (200 идемпотентно, 409 interrupted), GET `/files/{id}` (bearer; 404 после cleanup), GET `/health` — публичный, различает живость bff и доступность бэкендов (`backends: ready|unavailable` — контракт шины PR #24). Idempotency-Key: повтор в 10 мин → тот же job_id. MusicGen — только instrumental: в provenance music-джобов пишется `"capability": "instrumental"`. CORS: ACAO-эхо только для `http://127.0.0.1:8388`/`localhost:8388`, `Vary: Origin`, preflight allow-headers `authorization,idempotency-key,content-type`; чужой Origin → без ACAO; без `*`. Ошибки — единый envelope без стектрейсов и путей.

## Карта доказательств Т1–Т8

| Ловушка | Доказательство |
|---|---|
| Т1 Linger | `loginctl show-user badai -p Linger` → `Linger=yes`; разрыв SSH-сессии → свежая сессия: `systemctl --user is-active media-bff ollama-briix` = active/active, MainPID те же (media-bff 2083546, ollama-briix 2073123), `/health` отвечает |
| Т2 :11436 | До кода: `curl :11436` — exit 7, connection refused (только :11434 жив). Создан `ollama-briix.service`, pull `qwen3:4b-instruct` в свой OLLAMA_MODELS; RAM-гейт: `free -g` до 13 used/80 avail → после загрузки+генерации 16 used/77 avail (дельта ~3G); `/health` различает bff и backends |
| Т3 Миграция | `tools/check-media-live.cjs`: v1→v2 без потерь (до: version 1/1 job → после: version 2, id/status/favorite/prompt сохранены); v2 с live-полями принят без throw; мусор `{"version":9,...}` → protected-баннер, сырой JSON не перезаписан |
| Т4 Reload | live: reload во время running → поллинг по serverJobId → ready + blob-превью; сервер недоступен → `interrupted` + явный баннер, никаких вечных queued; мок: детерминированный таймер (покрыт `check-media.cjs` «running job recovered after reload») |
| Т5 Файлы | `/files/{id}` 404 после cleanup → статус `expired` («результат истёк»); base64 в localStorage отсутствует — запись live-джоба 490 байт; blob только в памяти |
| Т6 CORS+auth | OPTIONS от 8388 → 204 + `Access-Control-Allow-Origin: http://127.0.0.1:8388` + `Vary: Origin` + allow-headers; Origin `http://evil.example` → ACAO отсутствует; POST `/jobs` без bearer → 401 (проверено и локально, и через туннель) |
| Т7 Маркировки | grep: 5 вхождений «Локальный мок» + родственные («Готовый мок», «Фото/Видео-мок», очередные подписи) — все через `originLabel()`/условный рендер; DOM-проверка: в mock-режиме баннер «Локальный мок», при недоступности live — «Мок-режим» (скриншот `briix-live-mock-banner.png` в тестовом out) |
| Т8 Очередь/cancel | queued-cancel: 200, задача ни разу не стартовала, повторный cancel 200; running-cancel: 200, процесс убит (ps: sd-cli отсутствует), семафор освобождён — следующий джоб стартует; timeout (изолированный инстанс, 15с): worker убит группой (killpg), зомби нет, следующий джоб ready; 9-й POST → 429 + `Retry-After: 30` |

## Замеры (CPU, 8 потоков sd / 8 musicgen / 4 ollama)

- Фото (FLUX.2-klein 4B, 4 шага): **261 с** (≤5.5 мин — ок)
- Музыка (MusicGen-small, 750 токенов ≈15 с аудио): **80 с** после прогрева весов (первый прогон на холодной модели — 356 с по старой сборке с ожиданием семафора; ≤2.5 мин — ок на прогретой)
- Текст (qwen3:4b-instruct, короткий ответ): **~1–10 с** (wall 0.99–10.6 с)
- Стресс 6 queued: все 202, load average стенда не вышел за фон (10.7–11.7 при фоне ~11), RAM 13→20 ГиБ (модель sd в памяти), отмена всех шести — чисто, зомби нет. Fonotext-панель и sentinel не пострадали (отдельные юниты).

## Проверки (Proof-of-Work)

- `node tools/check-media.cjs` — 24 PASS (после правок; characterize-first база до правок — та же, зафиксирована)
- `node tools/check-media-visual.cjs` — exit 0
- `node tools/check-media-live.cjs` — 8 PASS (Т3×3, Т4×2, Т5×2, Т7×2 сценария)
- `tools/briix-media-live-up.sh/-down.sh` — цикл up→up(idempotent)→down→down→up зелёный, lsof-чисто

## Тонкие места (честная карта хрупкости)

1. **Токен в localStorage** — xmin-риск: ванильный XSS на сайте мог бы прочитать `briix-media-live-token`. Сайт статический и без сторонних скриптов; для продакшена нужен httpOnly-cookie шлюз.
2. **jobs.json не блокируется** — два одновременных инстанса bff писали бы поверх друг друга; systemd-юнит один, но ручной запуск `bff.py` без остановки сервиса опасен.
3. **Health text-бэкенда ходит в ollama на каждый запрос** — 3с таймаут; при недоступном ollama `/health` отвечает честным `unavailable`, но медленнее.
4. **Мок-режим при упавшем live помечает задачи interrupted навсегда** — повторная отправка требует ручного retry (by design: «мок-режим (live недоступен)»).
5. **Туннель без автоперезапуска** — упал ssh → клиент честно показывает баннер; переподнять `tools/briix-media-live-up.sh`.
