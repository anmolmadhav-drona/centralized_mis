#!/usr/bin/env python3
"""Map arc colors at multiple angles around the emblem center."""
from PIL import Image
import numpy as np
import math

em = Image.open("/home/z/my-project/public/brand/logo-emblem.png").convert("RGBA")
arr = np.array(em, dtype=np.int16)
H, W = arr.shape[:2]
cx, cy = 128, 128

def sample_at(angle_deg, radius):
    x = int(round(cx + radius * math.cos(math.radians(angle_deg))))
    y = int(round(cy - radius * math.sin(math.radians(angle_deg))))
    if 0 <= x < W and 0 <= y < H:
        r, g, b, a = arr[y, x]
        return (r, g, b, a)
    return (0, 0, 0, 0)

# For angles from 15 to 165 (upper half where arcs are), find bands along radius
for angle in [90, 60, 120, 30, 150, 10, 170]:
    print(f"\n--- angle {angle}° ({'up' if angle==90 else 'side' if angle in (30,150) else 'diag'}) ---")
    prev_opaque = False
    band_start = None
    for rad in range(0, 128):
        r, g, b, a = sample_at(angle, rad)
        op = a >= 100
        if op and not prev_opaque:
            band_start = rad
        if not op and prev_opaque:
            # sample color at band middle
            mid = (band_start + rad) // 2
            rr, gg, bb, aa = sample_at(angle, mid)
            print(f"  band r={band_start}-{rad-1} (thick {rad-band_start}): mid RGB #{rr:02X}{gg:02X}{bb:02X}")
        prev_opaque = op
    if prev_opaque:
        mid = (band_start + 127) // 2
        rr, gg, bb, aa = sample_at(angle, mid)
        print(f"  band r={band_start}-127: mid RGB #{rr:02X}{gg:02X}{bb:02X}")

# Also: brightest pixels overall in emblem (the gold parts?)
alpha = arr[..., 3] >= 100
rgbs = arr[alpha][:, :3]
bright = rgbs[rgbs.sum(axis=1).argsort()[::-1][:400]]
print(f"\n300 brightest pixels avg: #{int(bright[:,0].mean()):02X}{int(bright[:,1].mean()):02X}{int(bright[:,2].mean()):02X}")
# percentiles of red channel
reds = rgbs[:, 0]
print(f"red percentiles: p50={np.percentile(reds,50):.0f} p90={np.percentile(reds,90):.0f} p99={np.percentile(reds,99):.0f}")
