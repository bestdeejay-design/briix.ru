# BRIIX: живой пилот CPU-генерации медиа — FLUX.2-klein на fonotext-стенде A

- **Дата:** ночь 08.11.2026 (работа начата 07.11 вечером), Europe/Moscow.
- **Исполнение:** координатор INFRA + саб-исполнитель (роль executor, скилл clean-execution); квота CPU — не больше 8 тредов из 20.
- **Статус:** развёртывание ВЫПОЛНЕНО и проверено живьём; это не справка, а отчёт о пилоте. Развитие (музыка) — в работе.
- **Контекст:** продолжение рекомендаций Арены [2026-11-07-cpu-self-hosting-stands.md](2026-11-07-cpu-self-hosting-stands.md) — её «медленный CPU-эксперимент изображений на A» выполнен, замеры сняты.

## Что установлено на стенде A (t-ai, `~/briix-media/`)

- **Runtime:** [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) `master-1056-9234ad8`, сборка нативная (GCC 14, AVX2 — Xeon E5-2699 v4, без AVX512), `sd-cli`.
- **Комплект FLUX.2-klein-4B** (по канону `docs/flux2.md` из репо runtime):
  - `flux-2-klein-4b-Q8_0.gguf` — 4.0 GiB (diffusion, репо `leejet/FLUX.2-klein-4B-GGUF`)
  - `Qwen3-4B-Q6_K.gguf` — 3.3 GiB (text encoder, `unsloth/Qwen3-4B-GGUF`)
  - `full_encoder_small_decoder.safetensors` — 249 MB (VAE, `black-forest-labs/FLUX.2-small-decoder` — **не gated**, в отличие от `FLUX.2-dev`)
  - sha256 всех трёх: `~/briix-media/models/manifest.txt` на стенде.
- Диск: занято ~7.6 GB весов + сборка; на A свободно было 212G → 205G.

## Замеры (чистый CPU, 512×512, 4 steps, Euler, `--threads 8 --offload-to-cpu`)

| Метрика | Значение |
|---|---|
| Wall-clock на картинку | **~4 мин 00 с** |
| Sampling | 213.5 с (52.5 с/step) |
| Text encoder | 8.3 с |
| VAE decode | ~15.5 с |
| RAM | ~7.4 GB веса + ~1.6 GB буферы (из 94G) |
| Русский промпт | работает (Qwen3-энкодер) |
| Влияние на fonotext | load до 3.3 → после 8.5 (наши 8 тредов); сервисы не тронуты |

Команда (канонический шаблон):

```bash
sd-cli \
  --diffusion-model models/flux-2-klein-4b-Q8_0.gguf \
  --vae models/full_encoder_small_decoder.safetensors \
  --llm models/Qwen3-4B-Q6_K.gguf \
  -p "промпт" --cfg-scale 1.0 --steps 4 --threads 8 -v --offload-to-cpu \
  -o output/out.png
```

Тест-картинки (`test-cat.png`, `test-cup.png`) скоординированы в приватный репо INFRA `docs/briix-media-pilot/` (не публиковать без решения владельца). Качество: хорошее предметное фото для 4 шагов, дистиллированный klein оправдывает `--cfg-scale 1.0`.

## Музыка — следующий этап (в работе прямо сейчас)

Арена музыку не покрывала (её справка — текст/фото/видео). Карта координатора:

| Модель | Лицензия | CPU-реалистичность |
|---|---|---|
| **MusicGen small** (Meta, 300M) | код Apache-2.0, веса CC-BY-NC | ✅ сейчас ставится на A тем же конвейером (torch-cpu, квота 8 тредов), тест-лупы: lo-fi / ambient / jingle |
| Stable Audio Open Small (341M) | некоммерч. | самый быстрый CPU, сэмплы/лоупы |
| ACE-Step | Apache-2.0 (веса отдельно) | песни с вокалом, CPU — часы; только hosted/выделенный GPU |
| Suno/Udio/Riffusion | hosted only | ставить нечего |

**Ловушка лицензий:** всё быстрое на CPU — некоммерческое. Для витрины BRIIX (демо) ок; для прод-функции «музыка клиентам» — ACE-Step на GPU или hosted API.

## Выводы для BRIIX

1. **Фото на CPU уже реально** — 4 мин/512px годится для офлайн-наполнения витрины (этап 1 Арены: «сохранённые проверенные примеры»), не для live.
2. Live-режим по-прежнему требует backend + очереди (П-5/П-13 ai-platform) — ничего не меняется.
3. Отдельный GPU-сервер для видео остаётся правдой рекомендацией Арены; на A видео не трогаем.

## Границы отчёта

- Не публиковались: внутренние адреса, пароли, пути за пределами нужного.
- Стенд A — контур fonotext: работа шла ночью (load ~1), квота тредов 8, веса вне NFS, сервисы ollama/caddy/раннеры не тронуты.
- MusicGen-замеры будут дописаны отдельным отчётом после завершения этапа.
