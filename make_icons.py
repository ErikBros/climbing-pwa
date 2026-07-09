#!/usr/bin/env python3
"""Generate PWA icons: chalk mountain peak on terracotta, matching the Android launcher."""
from PIL import Image, ImageDraw

TERRACOTTA = (194, 92, 66)      # #C25C42
CHALK = (242, 234, 228)         # #F2EAE4

def make_icon(size: int, path: str):
    img = Image.new("RGB", (size, size), TERRACOTTA)
    d = ImageDraw.Draw(img)
    s = size / 100.0
    # main peak
    d.polygon([(18 * s, 74 * s), (50 * s, 26 * s), (82 * s, 74 * s)], fill=CHALK)
    # secondary peak (terracotta notch cut back in)
    d.polygon([(50 * s, 26 * s), (58 * s, 38 * s), (44 * s, 58 * s), (36 * s, 47 * s)], fill=TERRACOTTA)
    # sun / chalk dot
    d.ellipse([(70 * s, 18 * s), (82 * s, 30 * s)], fill=CHALK)
    img.save(path)
    print(f"wrote {path} ({size}x{size})")

if __name__ == "__main__":
    for size, name in [(180, "icons/icon-180.png"), (192, "icons/icon-192.png"), (512, "icons/icon-512.png")]:
        make_icon(size, name)
