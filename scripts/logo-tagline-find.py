#!/usr/bin/env python3
"""Find the tagline ('Growing Together') y-range to crop it out for compact display."""
from PIL import Image
import numpy as np

SRC = "/home/z/my-project/upload/pasted_image_1789198732211.png"
img = Image.open(SRC).convert("RGBA")
W, H = img.size
arr = np.array(img, dtype=np.int16)
r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
opaque = a >= 128

# Brown/bronze tagline: mid R (~120-180), low-mid G, low B, R>G>B
brown = opaque & (r > 100) & (r < 210) & (g > 60) & (g < 160) & (b < 90) & (r - b > 60) & (g - b > 20)
ys, xs = np.where(brown)
if len(ys):
    print(f"brown pixels: {len(ys)}, y range {ys.min()}-{ys.max()}")
    # histogram by y band
    for y0 in range(600, H, 20):
        cnt = ((ys >= y0) & (ys < y0 + 20)).sum()
        if cnt:
            print(f"  y{y0}-{y0+20}: {cnt}")

# Charcoal GROUPS text rows (dark pixels, x < 1400 to exclude illustration shadows)
dark = opaque & (r < 80) & (g < 80) & (b < 80)
dark[:, 1400:] = False
dys, dxs = np.where(dark)
print(f"\ndark(<x1400) pixels: {len(dys)}, y range {dys.min()}-{dys.max()}")
for y0 in range(500, 780, 20):
    cnt = ((dys >= y0) & (dys < y0 + 20)).sum()
    if cnt:
        print(f"  y{y0}-{y0+20}: {cnt}")

# Red DRONA letters y-range
red = opaque & (r > 120) & (g < 90) & (b < 90)
rys, rxs = np.where(red)
print(f"\nred pixels: {len(rys)}, y range {rys.min()}-{rys.max()}")
