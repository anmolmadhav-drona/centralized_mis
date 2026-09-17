#!/usr/bin/env python3
"""Extract the 'O' emblem (concentric arcs + human figure) as a standalone icon."""
from PIL import Image
import numpy as np

SRC = "/home/z/my-project/upload/pasted_image_1789198732211.png"
img = Image.open(SRC).convert("RGBA")
W, H = img.size
arr = np.array(img, dtype=np.int16)
r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
opaque = a >= 128
gold = opaque & (r > 150) & (g > 90) & (g < 200) & (b < 110) & (r - b > 90)

# Restrict to the O region (x490-745) and find tight bbox of gold+red there
region = np.zeros_like(opaque)
region[280:690, 490:750] = True
cluster = (gold | (opaque & (r > 120) & (g < 90) & (b < 90))) & region
ys, xs = np.where(cluster)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print(f"emblem bbox: x={x0}-{x1}, y={y0}-{y1}  ({x1-x0+1}x{y1-y0+1})")

# Crop with padding, trim to alpha bbox
pad = 6
crop = img.crop((x0 - pad, y0 - pad, x1 + pad + 1, y1 + pad + 1))
bbox = crop.getbbox()
crop = crop.crop(bbox)
print(f"emblem crop: {crop.size}")

# Save preview
crop.save("/tmp/emblem-raw.png")

# Also save the region around the O letter for context check
img.crop((440, 120, 780, 700)).save("/tmp/o-letter-context.png")
print("saved /tmp/emblem-raw.png and /tmp/o-letter-context.png")
