#!/usr/bin/env python3
"""Find vertical gaps in the logo to separate text blocks from illustration."""
from PIL import Image

SRC = "/home/z/my-project/upload/pasted_image_1789198732211.png"
img = Image.open(SRC).convert("RGBA")
W, H = img.size
alpha = img.split()[3]

# Per-column opaque ratio (threshold alpha>=128)
import numpy as np
a = np.array(alpha, dtype=np.uint8)
col_opaque = (a >= 128).sum(axis=0)  # count per column
col_ratio = col_opaque / H

# Find runs of columns with ratio > 0.005 (content)
thresh = 0.005
runs = []
in_run = False
for x in range(W):
    if col_ratio[x] > thresh:
        if not in_run:
            start = x
            in_run = True
    else:
        if in_run:
            runs.append((start, x - 1))
            in_run = False
if in_run:
    runs.append((start, W - 1))

# Merge runs separated by < 8px (intra-letter gaps)
merged = []
for r in runs:
    if merged and r[0] - merged[-1][1] <= 8:
        merged[-1] = (merged[-1][0], r[1])
    else:
        merged.append(list(r))
print("Content blocks (x ranges):")
for i, (s, e) in enumerate(merged):
    print(f"  block {i}: x={s}-{e}  width={e-s+1}  density={col_ratio[s:e+1].mean():.3f}")

# Row analysis within full width
row_opaque = (a >= 128).sum(axis=1)
row_ratio = row_opaque / W
rthresh = 0.003
rruns = []
in_run = False
for y in range(H):
    if row_ratio[y] > rthresh:
        if not in_run:
            start = y
            in_run = True
    else:
        if in_run:
            rruns.append((start, y - 1))
            in_run = False
if in_run:
    rruns.append((start, H - 1))
rmerged = []
for r in rruns:
    if rmerged and r[0] - rmerged[-1][1] <= 6:
        rmerged[-1] = (rmerged[-1][0], r[1])
    else:
        rmerged.append(list(r))
print("Row blocks (y ranges):")
for i, (s, e) in enumerate(rmerged):
    print(f"  rowblock {i}: y={s}-{e}  height={e-s+1}")
