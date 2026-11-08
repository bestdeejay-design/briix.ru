# Мобильный экран: подключение к media-bff

**Дата:** 2026-11-08  
**Код:** `0afbe11516e7f78dd586321dab32868f7dec633d`  
**Реальный аудит:** [GitHub Actions run 42529244601](https://github.com/bestdeejay-design/briix.ru/actions/runs/42529244601)  
**Отчёт раннера:** [issue #46, comment 6728020522](https://github.com/bestdeejay-design/briix.ru/issues/46#issuecomment-6728020522)

## Что подключено

На одном мобильном экране режимы «Фото», «Аудио» и «Текст» используют существующий браузерный transport и bearer-ключ из настроек. Ключ включает чат, изображения и музыку автоматически и остаётся только в localStorage браузера. Серверный адрес и секреты не добавлены в исходники.

- **Фото:** `POST /jobs`, `type: image`, polling, авторизованное скачивание результата в blob URL.
- **Аудио:** MusicGen для инструментала; ACE-Step Flash/Pro для песни, включая лирику из DJ1.
- **Текст:** Qwen через `/v1/chat/completions`, включая SSE и non-stream fallback.
- **Видео:** live не выдаётся за доступный и не отправляет подменную image-задачу. На текущем BFF video-возможности нет.

## Реальная генерация на стенде A

Workflow запущен на ветке `arena/8e89945b-briix-ru` с фазами `catalog,image,instrumental,song-flash,chat`. Итог: **0 провалов за 834 секунды**.

| Проверка | Фактический результат |
|---|---|
| Health | image/music/text — `ready` |
| Каталог | 5/5 ready: Qwen, FLUX, MusicGen, ACE-Step Flash, ACE-Step Pro |
| FLUX | PNG, 698 KiB; скачано 715 184 байта; magic bytes валидны; 237 с |
| MusicGen | M4A, capability `instrumental`; 300 с |
| ACE-Step Flash | M4A, capability `song.vocal`, лирика `Last Train`; 258 с |
| Qwen JSON | HTTP 200, 4 completion tokens |
| Qwen SSE | HTTP 200, 7 chunks, `done: true` |

Аудит реального стенда не подменяет прослушивание: в runner-контуре не было `ffprobe`, поэтому длительность/декодирование реальных M4A отдельно не измерены. Полные image/audio artefacts сохранены в GitHub Actions run.

## Браузерная интеграция и регрессии

Эти проверки используют локальный fake BFF и подтверждают **проводку браузера**, а не реальный inference:

- `check-mobile-live.cjs`: **8/8** — один ключ, FLUX blob, MusicGen audio, ACE-Step с DJ1-лирикой, Qwen provenance, ноль video submissions.
- `check-media-live.cjs`: **12/12**, включая recovery после reload, interrupted/expired/cancel и отказ без mock fallback.
- `check-music-live.cjs`: **17/17**.
- `check-chat-live.cjs`: **11/11**.
- `check-live-default.cjs`: **10/10**.
- `check-published-mode.cjs`: **15/15**, включая same-origin `/api` и mobile axe.
- `check-demo.cjs`: **20/20**, `check-media.cjs`: **25/25**, `check-music.cjs`: **29/29**.
- Ранее после изменения главной: mobile creator **13/13**, simple chat **10/10**, mobile UI **16/16 destinations**.

Во время проверки исправлена гонка двух одновременных `autoStart`: повторная инициализация больше не помечает живую running-задачу как interrupted. Текст live/mock баннера сохраняется при переходе от мобильной главной к полной студии.
