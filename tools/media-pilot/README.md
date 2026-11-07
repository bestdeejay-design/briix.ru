# Media pilot — исходники живого пилота CPU-генерации (стенд A)

Исходники пилота из отчёта [audits/2026-11-08-cpu-media-pilot.md](../../audits/2026-11-08-cpu-media-pilot.md).
Живой стенд: fonotext-стенд A, каталог `~/briix-media/` (веса и сборка НЕ коммитятся — только код и манифесты).

## Что здесь

| Файл | Что делает | Где жил на стенде |
|---|---|---|
| `musicgen-gen.py` | MusicGen small → 3 WAV-лупа (torch-cpu, 8 тредов, 750 токенов ≈ 15 c аудио) | `~/briix-media/music/gen.py` |
| `manifest.txt` | sha256 + размеры весов FLUX.2-klein-4B (diffusion Q8_0 + Qwen3-4B Q6_K + VAE) | `~/briix-media/models/manifest.txt` |
| `host-cpu.txt` | lscpu стенда (Xeon E5-2699 v4, AVX2, 20 ядер) — основа замеров | `~/briix-media/host-cpu.txt` |

## Воспроизведение фото (sd-cli, ~4 мин/512×512)

```bash
sd-cli \
  --diffusion-model ~/briix-media/models/flux-2-klein-4b-Q8_0.gguf \
  --vae ~/briix-media/models/full_encoder_small_decoder.safetensors \
  --llm ~/briix-media/models/Qwen3-4B-Q6_K.gguf \
  -p "промпт" --cfg-scale 1.0 --steps 4 --threads 8 -v --offload-to-cpu \
  -o out.png
```

Сборка runtime (stable-diffusion.cpp `master-1056-9234ad8`, ОБЯЗАТЕЛЬНО `--recursive` из-за сабмодуля ggml):

```bash
git clone --recursive https://github.com/leejet/stable-diffusion.cpp.git
cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON -DSD_BUILD_CLI=ON -DSD_BUILD_SERVER=OFF
cmake --build build --config Release -j 8
```

## Воспроизведение музыки

```bash
python3 -m venv venv && ./venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
./venv/bin/pip install transformers scipy   # НЕ с pytorch-индекса — там transformers нет
./venv/bin/python tools/media-pilot/musicgen-gen.py
```

## Правила стенда (не отменять)

- квота CPU: ≤8 тредов на генерации из 20 ядер; fonotext-production приоритетен;
- веса — вне NFS, вне git (в репо только sha256-манифест);
- docker и public ingress на стенде не использовать (решения владельца).

Связанное: issue #23 (live-контур: фото+музыка+тексты→демо), PR #22.
