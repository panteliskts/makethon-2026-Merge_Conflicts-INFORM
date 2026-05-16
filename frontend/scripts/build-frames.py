#!/usr/bin/env python3
"""One-off: downscale extracted 4K PNG frames to ~1920px WebP for the web.

Expects frames already extracted to /tmp/newframes/frames and /tmp/newframes/frames2
(unzip Frames.zip there first). Run from the frontend/ directory:
    python3 scripts/build-frames.py
"""
import os
from PIL import Image

SRC = {
    "seq1": "/tmp/newframes/frames",
    "seq2": "/tmp/newframes/frames2",
}
TARGET_WIDTH = 1920
QUALITY = 82
OUT_ROOT = os.path.join(os.path.dirname(__file__), "..", "public", "frames")


def convert(seq_name, src_dir):
    out_dir = os.path.join(OUT_ROOT, seq_name)
    os.makedirs(out_dir, exist_ok=True)
    names = sorted(f for f in os.listdir(src_dir) if f.endswith(".png"))
    for i, name in enumerate(names, start=1):
        img = Image.open(os.path.join(src_dir, name)).convert("RGB")
        scale = TARGET_WIDTH / img.width
        size = (TARGET_WIDTH, round(img.height * scale))
        img = img.resize(size, Image.LANCZOS)
        out = os.path.join(out_dir, f"{i:03d}.webp")
        img.save(out, "WEBP", quality=QUALITY, method=6)
    print(f"{seq_name}: wrote {len(names)} frames to {out_dir}")


if __name__ == "__main__":
    for seq_name, src_dir in SRC.items():
        convert(seq_name, src_dir)
