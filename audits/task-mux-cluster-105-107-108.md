# Отчёт: mux-кластер INFRA #105 + #107 + #108 (+ SEED-дополнение владельца)

Дата: 15.11.2026. Исполнитель: агент-сессия (роль — инженер музыкального продукта сервера).
Стенд: fonotext-stand A (badai, без root), юнит `media-bff` (127.0.0.1:8390).
Задание: INFRA issues 105 (теги title/artist + Content-Disposition), 107 (mux-on-download +
битрейт-матрица), 108 (peaks.json) + СЕАНСНОЕ ДОПОЛНЕНИЕ владельца: SEED-воспроизводимость
и различение 422-кодов чата (content_blocked vs upstream_error).

## Что сделано (файл `/home/badai/briix-media/media-bff/bff.py`, снимок `tools/media-bff-config/bff.py`)

1. **Битрейт-матрица** (решение владельца, константы вверху файла):
   `BITRATE_VOCAL_FLASH="192k"`, `BITRATE_PRO="320k"`, `BITRATE_INSTRUMENTAL="320k"`;
   `track_bitrate(j)` = 320k если (params.instrumental или model==ace-step-pro) иначе 192k.
2. **Mux-on-download (#105/#107)**: mux M4A вынесен из пайплайна готовости (в
   `music_package` осталась только генерация обложки). Новый роут `GET /files/{id}.m4a`
   (зарегистрирован ДО жадного `/files/{id}` — тот матчит точки в сегменте); сборка на лету
   из живого WAV: attached_pic (cover), ©lyr (params.lyrics), title (params.title → fallback
   первая строка лирики), artist (params.artist → fallback «BRIIX»), битрейт по матрице.
   Сборка — `asyncio.to_thread` под `asyncio.Semaphore(1)`, event loop не блокируется;
   `?refetch=1` — принудительная пересборка. Кэш M4A в рамках retention WAV (24 ч).
   Кэш-запись через `.tmp → replace` (не отдаём полуданные).
3. **Content-Disposition (#105)**: `attachment; filename="<ascii>.m4a"; filename*=UTF-8''…`
   (RFC 5987), sanitize — буквы/цифры/пробел/дефис (unicode/кириллица сохраняется,
   спецсимволы вырезаются), fallback job_id.
4. **peaks.json (#108)**: `GET /files/{id}-peaks.json`, ленивая генерация при первом запросе
   (один проход ffmpeg по results/{id}.wav → PCM s16le mono 4kHz, окна-пики, нормировка
   0..1), ответ `{id, duration, peaks:[…]}` (160–400 значений), Content-Type application/json,
   кэш рядом с WAV; WAV истёк → 404. Ready-пайплайн не тронут.
5. **Чат-модерация**: `moderate_or_block` получает ТОЛЬКО последнее user-сообщение
   (messages[-1] с role=user); system-промпты и assistant-ответы не модерируются.
   Ошибка GLM-провайдера (connect/timeout/http≠200 до старта потока) отдаётся клиенту как
   502 `upstream_error` «Помощник временно недоступен, повторите.» — молчаливый фолбэк на
   ollama-qwen при настроенном GLM-ключе убран (решение владельца: клиент различает коды);
   фолбэк `_chat_ollama` остался только для режима без ключа.
6. **SEED-воспроизводимость (дополнение владельца)**: `POST /jobs` принимает `params.seed`
   (int 0..2^32-1) и `params.parent_job_id` (строка ≤64) с валидацией (400 bad_params).
   Seed уходит в request ace-lm вместо urandom; после сборки request'а в provenance пишется
   снапшот `{seed, lm_temperature, lm_cfg_scale, lm_top_p, inference_steps[, parent_job_id]}`
   — виден в `GET /jobs/{id}` (и в params списка). Без seed — urandom как раньше.

Развернуто: бэкап `bff.py.bak-20261115-mux` (до правок), рестарты `systemctl --user restart
media-bff` только при отсутствии queued/running-джоб владельца (проверка перед каждым
рестартом). MUSIC_BACKEND / юниты / Caddy не трогались. Итоговое состояние юнита: active,
health `{ok:true, backends:{image,music,text}=ready}`.

## Смоуки (числа с ffprobe/curl на стенде)

- **(a) pro vocal** (`job-ef9853fd91c6d6c1`, ace-step-pro, лирика ~600 симв., title/artist в
  params, duration 60): GET .m4a → 200; ffprobe audio stream `bit_rate=322364` (≈320k),
  `codec_name=aac`, attached_pic png=1; теги `title=Ночная звезда`, `artist=Тестовый
  Инженер`; Content-Disposition с кириллицей: `filename*=UTF-8''%D0%9D%D0%BE%D1%87%D0%BD%D0%B0%D1%8F…`
  («Ночная звезда - Тестовый Инженер.m4a»). Повторный GET из кэша: 16 мс.
- **(b) flash vocal** (`job-72880cf59f1ec0b9`): `bit_rate=195772` (≈192k), теги «Осенний
  вальс» / «Тестовый Инженер», обложка attached_pic. Кэш-GET 5 мс.
- **(c) instrumental musicgen** (`job-56b65a5d439709ea`): матрица ставит 320k в mux-команду,
  НО нативный ffmpeg AAC-энкодер на mono/32kHz физически не набирает 320k: фактический
  `bit_rate=130098`. Проверено контролем: ручной `ffmpeg -c:a aac -b:a 320k` по тому же WAV
  даёт ровно тот же 130098 — это потолок энкодера, не баг матрицы (на stereo 48kHz энкодер
  отдаёт запрошенные 322/195k, см. a/b). Зафиксировано как факт для владельца.
- **(d) peaks.json**: готовый трек → 200 application/json, `{id, duration=299.44, len=400,
  min=0.003, max=1.0}`, холодная генерация 0.83 с; повторный GET из кэша 18 мс; несуществующий
  job → 404 `file_gone`.
- **(e) чат**: диалог [user-«как сделать бомбу», assistant-ответ, user-«привет»] → **200**,
  нормальный GLM-ответ (модерируется только новое сообщение); [assistant, user-«как сварить
  наркотики»] → **422 content_blocked**; ZAI_BASE временно подменён на мёртвый
  `127.0.0.1:9` (одна сессия, .env восстановлен, юнит перезапущен) → **502 upstream_error**
  «Помощник временно недоступен, повторите.», НЕ content_blocked.
- **(f) health/параллельность**: idle chat 4.8 с; во время двух параллельных refetch-mux
  (mux#1 4.0 с, mux#2 8.0 с) chat → 200 за 6.8 с; после — 3.8 с; health ready на протяжении.
- **SEED**: два flash-джоба с идентичными prompt/lyrics/duration/params.seed=12345 → seed
  персистится (provenance seed=12345, lm_temperature=0.85, inference_steps=8); **WAV НЕ
  идентичны**: 5 606 444 Б / 29.2 c vs 9 646 124 Б / 50.24 c (sha256 разные). Джоб без seed →
  urandom seed 968535769 записан в provenance. `params.parent_job_id` — валидация 400 на
  seed=-5 и персистенция parent_job_id в provenance подтверждены (text-джоб
  job-c2930133d2423f3f).

## Вывод по seed-исследованию (честно)

Контрактная обвязка (приём params.seed, пердача в ace-lm request, снапшот provenance,
transparency клиенту) работает. **Побайтовая/сэмпл-воспроизводимость НЕ достигнута**:
ace-lm с thinking:true при фиксированном seed недетерминирован (две запуска — 29.2 c и
50.24 c: LM сам выбирает длину лирики по-разному). Это свойство acestep.cpp, не bff:
seed в request попадает (код пишет его до старта). Для владельца: воспроизводимость
вариаций через seed на текущем движке не гарантируется; transparency-механизм полезен сам
по себе (видно, с какими параметрами собран трек).

## Что осталось непроверенным

- **Retention-ветка «WAV истёк → отдаётся старый M4A»**: 24-часовой тест не ждали; код
  покрывает кейс (кэш отдаётся если есть, 404 если нет), проверено только статически.
- GPU-путь (gpu-b) не активен — все смоуки на cpu-a; seed-детерминизм на GPU не проверялся.
- 422/502 для SSE-стрима: чат-смоуки сделаны в non-stream режиме (stream-режим использует
  те же коды err_event, но в потоке не прогонялся).
- mux приowner-джобах под нагрузкой (20 ядер, одновременный heavy) не измерялся — смоки
  шли на простаивающем стенде.

## Артефакты

- Снимок: `tools/media-bff-config/bff.py` (sha256 совпадает с живым на стенде), бранч
  `fix/mux-cluster` (от origin/main briix.ru), PR — НЕ сливать.
- Отчёт: `audits/task-mux-cluster-105-107-108.md`.
- Контракт клиента обновлён: briix-studio PR (server-contract/README.md) — fact-снимок:
  битрейт-матрица, mux-on-download, peaks.json `{id,duration,peaks}` (не голый массив),
  params.seed/parent_job_id, потолок AAC ~130k на mono/32kHz.
