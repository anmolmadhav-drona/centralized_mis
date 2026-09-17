#!/usr/bin/env python3
"""Radial/angular analysis of the emblem's gold pixels to derive exact arc geometry."""
from PIL import Image
import math

img = Image.open('/tmp/gdrive/companylogo.png').convert('RGBA')
px = img.load()

x0, y0, x1, y1 = 904, 0, 1522, 538
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
print('emblem center:', cx, cy, 'bbox size:', x1-x0, y1-y0)

# collect gold pixels in the emblem region
pts = []
for y in range(y0, y1):
    for x in range(x0, x1):
        r, g, b, a = px[x, y]
        if a > 40 and r > 150 and 0.45*r < g < 0.95*r and b < 0.6*r:
            pts.append((x, y))

print('gold px count in emblem region:', len(pts))

# radial histogram
radii = [math.hypot(x-cx, y-cy) for x, y in pts]
rmin, rmax = min(radii), max(radii)
print(f'radius range: {rmin:.0f} .. {rmax:.0f}')

import collections
hist = collections.Counter(int(r // 20) * 20 for r in radii)
print('\nradius histogram (20px buckets):')
for k in sorted(hist):
    bar = '#' * min(60, hist[k] // 60)
    print(f'  r={k:4d}-{k+20:4d}  n={hist[k]:6d} {bar}')

# angular coverage for a few radial bands: which angle ranges are present vs gaps
# angle measured in degrees, 0 = east (+x), increasing clockwise (screen coords, y down)
print('\nangular coverage per radial ring (40px-wide rings):')
for ring_r0 in range(20, int(rmax), 40):
    ring_r1 = ring_r0 + 40
    angles = []
    for (x, y), rr in zip(pts, radii):
        if ring_r0 <= rr < ring_r1:
            ang = math.degrees(math.atan2(y - cy, x - cx)) % 360
            angles.append(ang)
    if len(angles) < 50:
        continue
    angles.sort()
    # find gaps > 8 degrees
    gaps = []
    for i in range(len(angles)):
        nxt = angles[(i + 1) % len(angles)]
        d = (nxt - angles[i]) % 360
        if d > 8:
            gaps.append((angles[i], nxt))
    covered = 360 - sum((b - a) % 360 for a, b in gaps)
    gstr = '; '.join(f'{a:.0f}°→{b:.0f}°' for a, b in gaps[:6])
    print(f'  ring {ring_r0:3d}-{ring_r1:3d}: coverage {covered:.0f}° of 360°, gaps at: {gstr}')
