#!/usr/bin/env python3
"""Analyze Drona logo structure and produce derived brand assets."""
from PIL import Image
import os

SRC = "/home/z/my-project/upload/pasted_image_1789198732211.png"
OUT = "/home/z/my-project/public/brand"
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert("RGBA")
W, H = img.size
print(f"size: {W}x{H}")

# Overall alpha bounding box
bbox = img.getbbox()
print(f"alpha bbox: {bbox}")

# Column-wise alpha density (downsampled) to find text vs illustration regions
alpha = img.split()[3]
col_density = []
for x in range(0, W, 10):
    col = alpha.crop((x, 0, x + 10, H))
    hist = col.histogram()
    opaque = sum(hist[128:])
    total = col.size[0] * col.size[1]
    col_density.append((x, opaque / total))

# Print density map compactly
line = ""
for x, d in col_density:
    level = int(d * 9)
    line += str(level) if level > 0 else "."
print("col density (0-9 per 10px):")
print(line)

# Row-wise density for full image
row_density = []
for y in range(0, H, 10):
    row = alpha.crop((0, y, W, y + 10))
    hist = row.histogram()
    opaque = sum(hist[128:])
    total = row.size[0] * row.size[1]
    row_density.append((y, opaque / total))
line = ""
for y, d in row_density:
    level = int(d * 9)
    line += str(level) if level > 0 else "."
print("row density (0-9 per 10px):")
print(line)
