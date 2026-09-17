#!/usr/bin/env python3
"""Sample exact colors along the emblem's arcs and figures."""
from PIL import Image
import numpy as np

em = Image.open("/home/z/my-project/public/brand/logo-emblem.png").convert("RGBA")
arr = np.array(em, dtype=np.int16)
H, W = arr.shape[:2]
cx, cy = W // 2, H // 2
print(f"emblem: {W}x{H}, center=({cx},{cy})")

# The arcs open at the bottom -> sample straight UP from center (12 o'clock line)
# to hit all three arcs at their apex.
print("\n--- vertical scan upward from center (x=cx, y from cy down to 0) ---")
prev_opaque = False
for y in range(cy, -1, -1):
    r, g, b, a = arr[y, cx]
    op = a >= 128
    if op and not prev_opaque:
        dist = cy - y
        print(f"  arc start: y={y} dist_from_center={dist}px  RGB=({r},{g},{b})  #{r:02X}{g:02X}{b:02X}")
    if not op and prev_opaque:
        print(f"  arc end:   y={y}")
    prev_opaque = op

# Sample the figure region: bottom center
print("\n--- figure region colors (bottom 35%, center 40%) ---")
fy0 = int(H * 0.62)
region = arr[fy0:, int(W*0.3):int(W*0.7)]
opaque_px = region[region[..., 3] >= 128]
if len(opaque_px):
    # cluster by hue buckets
    from collections import Counter
    buckets = Counter()
    for r, g, b, a in opaque_px[::17]:
        buckets[(r//24*24, g//24*24, b//24*24)] += 1
    for (r, g, b), n in buckets.most_common(10):
        print(f"  ~#{r:02X}{g:02X}{b:02X} x{n}")

# Where exactly do figures start/end vertically?
alpha = arr[..., 3]
rows_opaque = (alpha[fy0:, :] >= 128).sum(axis=1)
nz = [i + fy0 for i, c in enumerate(rows_opaque) if c > 0]
if nz:
    print(f"\nfigure rows: y={nz[0]}-{nz[-1]} of {H}")
