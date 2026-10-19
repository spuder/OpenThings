#!/usr/bin/env python3
"""Draw the desktop tray / menu-bar icons (original artwork for OpenThings).

One 44x44 PNG per sync state: a rounded-square check mark, plus a small status dot.
Run from the repo root:  python3 scripts/make-tray-icons.py
Needs Pillow. Output: src-tauri/icons/tray/*.png
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 44
SCALE = 4  # draw large, then downsample for smooth edges
OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "tray"

BLUE = (47, 111, 237, 255)  # --accent
STATES = {
    "local": None,
    "synced": (63, 166, 107, 255),  # --logbook
    "pending": (242, 183, 46, 255),  # --star
    "offline": (140, 140, 148, 255),
    "error": (224, 69, 60, 255),  # --deadline
}


def draw(dot):
    s = SIZE * SCALE
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = 5 * SCALE
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=9 * SCALE, fill=BLUE)
    w = 4 * SCALE
    pts = [(13 * SCALE, 22.5 * SCALE), (19 * SCALE, 28.5 * SCALE), (31 * SCALE, 15 * SCALE)]
    d.line(pts, fill=(255, 255, 255, 255), width=w, joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=(255, 255, 255, 255))
    if dot:
        r = 8 * SCALE
        cx, cy = s - r - 1 * SCALE, s - r - 1 * SCALE
        d.ellipse([cx - r - 2 * SCALE, cy - r - 2 * SCALE, cx + r + 2 * SCALE, cy + r + 2 * SCALE], fill=(255, 255, 255, 255))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=dot)
    return im.resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, dot in STATES.items():
        draw(dot).save(OUT / f"{name}.png")
        print(OUT / f"{name}.png")
