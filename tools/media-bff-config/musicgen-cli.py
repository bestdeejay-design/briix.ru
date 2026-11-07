#!/usr/bin/env python3
"""CLI wrapper around musicgen-small for media-bff music jobs.

Usage: python musicgen-cli.py --prompt "..." --out /path/out.wav [--tokens 750]
Loads model once per invocation (process-per-job, spec v2). threads=8.
"""
import argparse
import sys
import time

import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration
from scipy.io.wavfile import write as wav_write

torch.set_num_threads(8)

MODEL = "facebook/musicgen-small"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tokens", type=int, default=750)  # 750 tokens ~= 15 s @ 50 Hz
    args = ap.parse_args()

    t0 = time.time()
    processor = AutoProcessor.from_pretrained(MODEL)
    model = MusicgenForConditionalGeneration.from_pretrained(MODEL)
    model.eval()
    inputs = processor(text=[args.prompt], padding=True, return_tensors="pt")
    with torch.no_grad():
        audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0,
                               max_new_tokens=args.tokens)
    arr = audio[0, 0].numpy()
    sr = model.config.audio_encoder.sampling_rate
    wav_write(args.out, sr, arr)
    print(f"DONE {len(arr)/sr:.1f}s audio, {time.time()-t0:.1f}s wall, saved {args.out}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
