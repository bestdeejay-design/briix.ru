#!/usr/bin/env python3
"""Воспроизводимая сборка локальных медиа-моков BRIIX.

Это НЕ генератор изображений и НЕ клиент нейросети. Скрипт берёт три
 JPEG-исходника из assets/media, нормализует их и собирает шесть коротких
видео-анимаций (MP4 + WebM) движением камеры. Никаких сетевых запросов.

Зависимости только для пересборки: Python 3.10+, Pillow, FFmpeg с libx264
и libvpx-vp9. Сам сайт остаётся статикой и не требует этих зависимостей.

Примеры:
  python3 tools/build-media-assets.py --check
  python3 tools/build-media-assets.py --ffmpeg /path/to/ffmpeg
  python3 tools/build-media-assets.py --source-dir /path/to/licensed-stills

Новые исходники должны называться ceramic-still.jpg, coffee-story.jpg,
skincare-light.jpg. Перед заменой сохраните оригиналы и права на них.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:  # понятная ошибка вместо traceback при --check
    Image = None
    ImageOps = None

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "assets" / "media"
SOURCES = ("ceramic-still.jpg", "coffee-story.jpg", "skincare-light.jpg")
FORMATS = {"landscape": (1280, 720), "portrait": (720, 1280)}
MAX_SIDE = 1400
JPEG_QUALITY = 88
FPS = 24
FRAMES = 120  # 5 секунд
MANIFEST = "manifest.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"Команда завершилась с ошибкой ({exc.returncode}): {' '.join(cmd)}\n{exc.stderr}") from exc


def normalize_jpeg(src: Path, dst: Path) -> None:
    if Image is None:
        raise SystemExit("Для сборки нужен Pillow: python3 -m pip install Pillow")
    with Image.open(src) as im:
        # Small, upright RGB JPEGs are kept byte-for-byte. This makes rebuilding
        # from the committed sources idempotent instead of losing quality again.
        if im.format == "JPEG" and im.mode == "RGB" and max(im.size) <= MAX_SIDE and im.getexif().get(274, 1) == 1:
            shutil.copyfile(src, dst)
            return
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
        im.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True)


def video_filter(width: int, height: int) -> str:
    # Сначала увеличиваем и кропим до формата, затем очень медленный zoom/pan.
    # Объект и фон неподвижны: это анимация кадра, а не генерация новой сцены.
    return (
        f"scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,"
        f"crop={width * 2}:{height * 2},"
        "zoompan=z='1.04+0.035*on/119':"
        "x='iw/2-iw/zoom/2+8*sin(on/119*PI/2)':"
        "y='ih/2-ih/zoom/2':"
        f"d={FRAMES}:s={width}x{height}:fps={FPS},format=yuv420p"
    )


def encode_video(ffmpeg: str, jpg: Path, out: Path, width: int, height: int, codec: str) -> None:
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(jpg),
        "-vf", video_filter(width, height), "-t", "5", "-an",
        "-c:v", codec,
    ]
    if codec == "libx264":
        cmd += ["-crf", "25", "-movflags", "+faststart"]
    else:
        cmd += ["-crf", "36", "-b:v", "0", "-row-mt", "1"]
    cmd.append(str(out))
    run(cmd)


def probe_video(ffmpeg: str, path: Path) -> dict:
    # FFmpeg достаточно: ffprobe не обязателен. Декодируем весь ролик.
    result = run([ffmpeg, "-hide_banner", "-i", str(path), "-map", "0:v:0", "-f", "null", "-"])
    text = result.stderr
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", text)
    dims = re.search(r"Video:.*? (\d{2,5})x(\d{2,5})", text, re.S)
    codec = re.search(r"Video: (\w+)", text)
    fps = re.search(r"(\d+(?:\.\d+)?) fps", text)
    frames = re.findall(r"frame=\s*(\d+)", text)
    if not duration or not dims or not codec or not fps or not frames:
        raise RuntimeError(f"Не удалось прочитать метаданные {path.name}")
    seconds = int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3])
    return {"width": int(dims[1]), "height": int(dims[2]), "duration": seconds,
            "codec_id": codec[1].lower(), "fps": float(fps[1]), "frames": int(frames[-1]),
            "has_audio": "Audio:" in text}


def build(source_dir: Path, out_dir: Path, ffmpeg: str) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    missing = [name for name in SOURCES if not (source_dir / name).is_file()]
    if missing:
        raise SystemExit("Нет исходников: " + ", ".join(missing))
    entries = []
    with tempfile.TemporaryDirectory(prefix="briix-media-") as tmp:
        tmp = Path(tmp)
        for name in SOURCES:
            jpg = tmp / name
            normalize_jpeg(source_dir / name, jpg)
            shutil.copy2(jpg, out_dir / name)
            with Image.open(jpg) as im:
                entries.append({"file": name, "kind": "image", "width": im.width, "height": im.height, "bytes": jpg.stat().st_size, "sha256": sha256(jpg)})
            stem = Path(name).stem
            for label, (w, h) in FORMATS.items():
                for ext, codec in (("mp4", "libx264"), ("webm", "libvpx-vp9")):
                    filename = f"{stem}-{label}.{ext}"
                    target = tmp / filename
                    encode_video(ffmpeg, jpg, target, w, h, codec)
                    meta = probe_video(ffmpeg, target)
                    expected_codec = "h264" if ext == "mp4" else "vp9"
                    if ((meta["width"], meta["height"]) != (w, h) or abs(meta["duration"] - 5) > 0.1
                            or meta["codec_id"] != expected_codec or meta["fps"] != FPS
                            or meta["frames"] != FRAMES or meta["has_audio"]):
                        raise RuntimeError(f"Неверные параметры видео: {filename}: {meta}")
                    shutil.copy2(target, out_dir / filename)
                    entries.append({"file": filename, "kind": "video", "codec": "H.264" if ext == "mp4" else "VP9", **meta, "bytes": target.stat().st_size, "sha256": sha256(target)})
    manifest = {
        "schema": 1,
        "notice": "Local UI mocks. Videos are camera-motion animations of still images, not model inference.",
        "recipe": {"max_side": MAX_SIDE, "jpeg_quality": JPEG_QUALITY, "fps": FPS, "frames": FRAMES, "seconds": 5, "audio": False},
        "tools": {"pillow": Image.__version__, "ffmpeg": run([ffmpeg, "-version"]).stdout.splitlines()[0]},
        "files": sorted(entries, key=lambda e: e["file"]),
    }
    (out_dir / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def expected_files() -> set[str]:
    return set(SOURCES) | {f"{Path(name).stem}-{label}.{ext}" for name in SOURCES for label in FORMATS for ext in ("mp4", "webm")}


def check(out_dir: Path, ffmpeg: str | None) -> dict:
    path = out_dir / MANIFEST
    if not path.is_file():
        raise SystemExit("Нет manifest.json. Сначала выполните сборку.")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    errors = []
    entries = manifest.get("files", [])
    names = [e.get("file") for e in entries]
    if manifest.get("schema") != 1 or len(names) != len(expected_files()) or set(names) != expected_files():
        errors.append("manifest не соответствует ожидаемым 15 файлам")
    for entry in entries:
        file = out_dir / entry["file"]
        if not file.is_file():
            errors.append(f"нет файла {entry['file']}")
            continue
        if sha256(file) != entry["sha256"]:
            errors.append(f"хеш не совпадает: {entry['file']}")
        if file.stat().st_size != entry["bytes"]:
            errors.append(f"размер не совпадает: {entry['file']}")
        if entry["kind"] == "image" and Image is not None:
            with Image.open(file) as im:
                if (im.width, im.height) != (entry["width"], entry["height"]):
                    errors.append(f"размеры изображения не совпадают: {entry['file']}")
        if entry["kind"] == "video":
            expected_codec = "h264" if file.suffix == ".mp4" else "vp9"
            if entry.get("codec_id") != expected_codec or entry.get("fps") != FPS or entry.get("frames") != FRAMES or entry.get("has_audio") is not False:
                errors.append(f"параметры видео в manifest неверны: {entry['file']}")
            if ffmpeg:
                meta = probe_video(ffmpeg, file)
                if ((meta["width"], meta["height"]) != (entry["width"], entry["height"])
                        or abs(meta["duration"] - entry["duration"]) > 0.1
                        or meta["codec_id"] != expected_codec or meta["fps"] != FPS
                        or meta["frames"] != FRAMES or meta["has_audio"]):
                    errors.append(f"параметры видео не совпадают: {entry['file']}: {meta}")
    if errors:
        raise SystemExit("\n".join(errors))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_OUT, help="каталог с тремя JPEG-исходниками")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT, help="каталог результата")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"), help="путь к FFmpeg")
    parser.add_argument("--check", action="store_true", help="только проверить хеши/размеры и декодировать видео")
    args = parser.parse_args()
    if args.check:
        manifest = check(args.out_dir, args.ffmpeg)
        decoded = ", видео декодированы" if args.ffmpeg else "; FFmpeg не указан, видео проверены только по хешам"
        print(f"OK: {len(manifest['files'])} файлов, хеши и размеры совпадают{decoded}")
        return
    if not args.ffmpeg:
        raise SystemExit("FFmpeg не найден. Укажите --ffmpeg /path/to/ffmpeg")
    manifest = build(args.source_dir.resolve(), args.out_dir.resolve(), args.ffmpeg)
    total = sum(e["bytes"] for e in manifest["files"])
    print(f"OK: {len(manifest['files'])} файлов, {total / 1024 / 1024:.2f} МиБ, manifest.json записан")


if __name__ == "__main__":
    main()
