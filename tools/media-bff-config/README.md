# Media-bff config snapshot — снапшот конфигурации живого контура (для аудита Арены)

**Дата:** 08.11.2026. **Основание:** просьба владельца — «собери весь конфиг с моделями в репо, пусть Арена глянет, что у нас не так». **Контекст:** issue #23, PR #29, follow-up #28. **Секреты убраны** (токен — `MEDIA_BFF_TOKEN=<REDACTED>`).

## Что в каталоге

| Файл | Что это (живой стенд A, `~/briix-media/media-bff/`) |
|---|---|
| `bff.py` | adapter/очередь: aiohttp :8390, bearer, POST /jobs, GET /jobs/{id}, cancel, GET /files/{id}, GET /health, GET /v1/models, POST /v1/chat/completions (JSON+SSE), ThreadBudget(8), retention 24ч |
| `cron-cleanup` | hourly-обёртка очистки results/ и jobs.json |
| `units-and-env.txt` | systemd --user юниты (media-bff, ollama-briix), имена env-переменных (значение токена вырезано), бинды, crontab-строки контура |
| `musicgen-cli.py` | CLI-обёртка MusicGen small (torch-cpu, threads=8, 750 токенов ≈ 15 c) |
| `v1-models-snapshot.json` | живой ответ GET /v1/models (4 модели, ace-step-1.5 = unavailable) |
| `ru30.json` | параметры сбойного ACE-Step-прогона (см. «Что не так») |

## Сопутствующие версии (стенд A)

- runtime: stable-diffusion.cpp `master-1056-9234ad8` (AVX2-сборка), sd-cli; aiohttp 3.14.5 в `adapter-venv`; torch 2.15.0+cpu / transformers 5.22.2 в `musicgen-venv`
- ollama-briix: `~/ollama/bin/ollama serve`, `OLLAMA_HOST=127.0.0.1:11436`, `OLLAMA_MODELS=~/briix-media/ollama-models`, `NUM_PARALLEL=1`, `KEEP_ALIVE=5m`, модель `qwen3:4b-instruct`
- веса фото: FLUX.2-klein-4B Q8_0 + Qwen3-4B-Q6_K (text encoder) + VAE small-decoder (sha256 в `tools/media-pilot/manifest.txt`)
- веса ACE-Step: `acestep-v15-turbo-Q4_K_M` + `vae-BF16` + `acestep-5Hz-lm-0.6B-Q8_0` + `Qwen3-Embedding-0.6B-Q8_0` (~3.2 GB, acestep.cpp 07abf07)

## ⚠️ Что не так (главный вопрос к Арене)

**ACE-Step 1.5 не выдаёт вокал на русской лирике.** Замер технически ок (88 c @ 8 тредов, peak RSS 5.4 GB), но в WAV только инструментал: спектрограммы обоих прогонов (`ru30`, `ru300`) показывают гармоническую музыкальную дорожку БЕЗ голосовых формант, после ~20 c — затухание в тишину (аудио принимал владелец и координатор). Параметры прогона — в `ru30.json`: **turbo-квант Q4_K_M, inference_steps=8, guidance_scale=1.0, shift=3.0, LM 0.6B-Q8_0**.

Гипотезы для проверки (в порядке дешевизны):
1. **Минимальные параметры генерации**: 8 шагов / guidance 1.0 — вне рекомендованных настроек; у официальных примеров ACE-Step шаги 27+ и guidance выше. Ретрай: sft-веса вместо turbo, steps 27, guidance 4–5.
2. **turbo-квант и русский**: заявленная поддержка русского относится к полным весам v1.5; квант Q4_K_M turbo + LM 0.6B могут не тянуть русский вокал (тест en vs ru на одних параметрах).
3. **Формат лирики**: структура `[verse]/[chorus]` и разметка — сверить с ожиданиями acestep.cpp (возможен другой тег-формат/языковой токен).
4. **VAE BF16 vs квант синтезатора**: известны ли проблемы turbo-Q4 + BF16 VAE комбинации в acestep.cpp?

Вопрос-приговор: если после (1)–(3) вокал не появится — vocal на CPU закрывается окончательно (hosted API или отдельный GPU), `/v1/models` остаётся `ace-step-1.5: unavailable`.

## Как поднять контур для повторения

Туннель: `ssh -f -N -L 8300:127.0.0.1:8390 fonotext-stand`; юниты стартуют при Linger (включён). Полная команда генерации фото — `tools/media-pilot/README.md`; музыка — `musicgen-cli.py`. Замеры: фото 261 c / 512px @ 8 тредов; music 60–80 c тёплая / 356 c холодная (bff греет модель при старте).

## Границы снапшота

Это конфигурационный снимок 08.11, не эталонный деплой; пароли/токены вне репо; серверные пути — домашние каталоги badai. Публикация только в приватном `briix.ru`.
