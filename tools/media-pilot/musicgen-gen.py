import sys, time
import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration
from scipy.io.wavfile import write as wav_write

torch.set_num_threads(8)

MODEL = "facebook/musicgen-small"
processor = AutoProcessor.from_pretrained(MODEL)
model = MusicgenForConditionalGeneration.from_pretrained(MODEL)
model.eval()

# Musicgen frame rate = 50 Hz -> 750 tokens ~= 15 s of audio
MAX_NEW_TOKENS = 750
SR = model.config.audio_encoder.sampling_rate

prompts = {
    "lofi.wav":    "lo-fi hip hop beat with warm piano and soft vinyl crackle, relaxed, 90 bpm",
    "ambient.wav": "calm ambient pad, slow evolving textures, meditation background",
    "jingle.wav":  "short upbeat corporate jingle, bright synths, happy, 15 seconds",
}

for name, prompt in prompts.items():
    t0 = time.time()
    inputs = processor(text=[prompt], padding=True, return_tensors="pt")
    with torch.no_grad():
        audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0,
                               max_new_tokens=MAX_NEW_TOKENS)
    arr = audio[0, 0].numpy()
    out = f"/home/badai/briix-media/music/{name}"
    wav_write(out, SR, arr)
    dt = time.time() - t0
    print(f"DONE {name}: {len(arr)/SR:.1f}s audio, {dt:.1f}s wall, saved {out}", flush=True)
