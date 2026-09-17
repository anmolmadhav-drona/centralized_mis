#!/usr/bin/env python3
"""Locate the circular emblem inside the 'O' of DRONA via color segmentation."""
from PIL import Image
import numpy as np

SRC = "/home/z/my-project/upload/pasted_image_1789198732211.png"
img = Image.open(SRC).convert("RGBA")
W, H = img.size
arr = np.array(img, dtype=np.int16)
r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

opaque = a >= 128

# Gold/amber pixels: high R, mid G, low B  (e.g. #E89A16, #D4AF37)
gold = opaque & (r > 150) & (g > 90) & (g < 200) & (b < 110) & (r - b > 90)
# Red pixels: high R, low G, low B (e.g. #A91518)
red = opaque & (r > 120) & (g < 90) & (b < 90) & (r - g > 80)
# Charcoal: all low
dark = opaque & (r < 80) & (g < 80) & (b < 80)

print(f"gold px: {gold.sum()}, red px: {red.sum()}, dark px: {dark.sum()}")

# Gold distribution across x (in bands of 100px)
print("\ngold by x-band:")
for x0 in range(0, W, 100):
    cnt = gold[:, x0:x0+100].sum()
    if cnt > 0:
        print(f"  x{x0}-{x0+100}: {cnt}")

# Focus on left portion x<745 (contains DRO): find gold cluster bounds
left_gold = gold.copy()
left_gold[:, 745:] = False
ys, xs = np.where(left_gold)
if len(xs):
    print(f"\nleft-portion gold cluster bbox: x={xs.min()}-{xs.max()}, y={ys.min()}-{ys.max()}")

# Where are red letters? bands
print("\nred by x-band:")
for x0 in range(0, W, 100):
    cnt = red[:, x0:x0+100].sum()
    if cnt > 0:
        print(f"  x{x0}-{x0+100}: {cnt}")

# Charcoal distribution (GROUPS text + tagline)
print("\ndark by y-band:")
for y0 in range(0, H, 50):
    cnt = dark[y0:y0+50, :].sum()
    if cnt > 0:
        print(f"  y{y0}-{y0+50}: {cnt}")
