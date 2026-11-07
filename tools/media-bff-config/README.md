# Media-bff config snapshot — снапшот конфигурации живого контура (для аудита Арены)

**Дата:** 08.11.2026. **Основание:** просьба владельца — «собери весь конфиг с моделями в репо, пусть Арена глянет, что у нас не так». **Контекст:** issue #23, PR #29, follow-up #28. **Секреты убраны** (токен — `MEDIA_BFF_TOKEN=<REDACTED>`).

## Что в каталоге

| Файл | Что это (живой стенд A, `~/briix-media/media-bff/`) |
|---|---|
| `bff.py` | adapter/очередь: aiohttp :8390, bearer, POST /jobs, GET /jobs/{id}, cancel, GET /files/{id}, GET /health, GET /v1/models, POST /v1/chat/completions (JSON+SSE), ThreadBudget(8), retention 24ч |
| `cron-cleanup` | hourly-обёртка очистки results/ и jobs.json (артефакт: cron-строка удалена 08.11 — гонка с in-process retention bff) |
| `units-and-env.txt` | systemd --user юниты (media-bff, ollama-briix), имена env-переменных (значение токена вырезано), бинды, crontab-строки контура |
| `musicgen-cli.py` | CLI-обёртка MusicGen small (torch-cpu, `--threads` передаётся bff'ом из тяжёлого бюджета; 750 токенов ≈ 15 c) |
| `host-cpu.txt` | CPU/RAM стенда A + пиковые треды контура |
| `versions.txt` | версии ollama/python-venv/systemd/Linger/acestep.cpp |
| `health-sample.json` | живой ответ GET /health (08.11) |
| `jobs-schema-sample.json` | одна запись jobs.json (checksum sha256 отредактирован) |
| `bff-errors-tail.txt` | хвост журнала с типовыми ошибками (без токенов) |
| `manifest.txt` | копия `tools/media-pilot/manifest.txt` (sha256 весов фото) |
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

### Результат ретрая 08.11 (волна 2, follow-up #28)

**R0-диагностика старого прогона:** request0.json технически валиден — audio_codes непустые, vocal_language=ru не перезаписан. Значит, пайплайн работал, но LM **0.6B** генерировал слабые коды. Главная гипотеза ресёрча: **LM 0.6B слишком мал для осмысленного кодирования вокала на русском; confidence гипотезы 0.6**.

**R1-ретрай:** скачан `acestep-5Hz-lm-1.7B-Q8_0.gguf` (1.9 GB, HF Serveurperso/ACE-Step-1.5-GGUF); та же 30с русская лирика, тот же turbo-Q4_K_M синтезатор, steps 8 / guidance 1.0 / shift 3.0, wav16. LM 1.7B сгенерировал audio_codes, синтез 30с прошёл за ~2 мин (LM ~30с, DiT ~23с, VAE ~34с на CPU).

**R2-спектрограмма-гейт:** в новом WAV (`samples/ru30-lm17.wav`, спектрограмма `ru30-lm17-spectrogram.png`) есть формантная гармоническая структура в полосе 300–3400 Гц с вертикальной слоговой нарезкой и синхронной сменой секций [verse]→[chorus] на ~12.5с — то, чего не было в прогоне LM 0.6B (там — ровная инструментальная дорожка с затуханием в тишину). **По спектрограмме вокал-подобная структура подтверждается; финальный вердикт — по прослушиванию координатором (WAV передан, /tmp/acestep-v2.wav на маке).** К bff ничего не подключено, route по-прежнему закрыт (`ace-step-1.5: unavailable`), полный запрос — `ru30-lm17-request.json`.

Вопрос-приговор остаётся: если прослушивание не подтвердит голос — vocal на CPU закрывается окончательно (hosted API или отдельный GPU).

## Как поднять контур для повторения

Туннель: `tools/briix-media-live-up.sh` (autossh, ветка feat/media-live, PR #29); юниты стартуют при Linger (включён), оба юнита под systemd hardening (см. `units-and-env.txt`).

### Фиксы 08.11 (волна аудита/ревью), применены на стенде

- F1: POST /v1/chat/completions теперь идёт через ThreadBudget (503 при недоступном текст-бэкенде; бюджет держится на всё время SSE-стрима).
- F2: ThreadBudget.acquire атомарен при отмене посреди ожидания (частично взятые токены возвращаются).
- F3: cron-строка cron-cleanup удалена (гонка с in-process retention; prune проверен живьём: 4/5 тест-записей вычищено, running не тронут).
- F4: systemd hardening обоих юнитов (drop-ins, см. units-and-env.txt); смок после рестарта зелёный.
- F5: warmup ждёт освобождения бюджета, токены 64→128; честно: греет page-cache, не RAM.
- F6: musicgen-cli получил `--threads`; bff передаёт фактический тяжёлый бюджет.
- F7: save_jobs() после stage-апдейтов music-стадий.
Смок 08.11: health green; image 245с; music 87с; text JSON + SSE — через бюджет (лог held=4/8, превышений нет). Полная команда генерации фото — `tools/media-pilot/README.md`; музыка — `musicgen-cli.py`. Замеры: фото 261 c / 512px @ 8 тредов; music 60–80 c тёплая / 356 c холодная (bff греет модель при старте).

## Границы снапшота

Это конфигурационный снимок 08.11, не эталонный деплой; пароли/токены вне репо; серверные пути — домашние каталоги badai. Публикация только в приватном `briix.ru`.
