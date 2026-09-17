#!/usr/bin/env python3
"""Refined per-color bounding boxes for the new logo."""
from PIL import Image

img = Image.open('/tmp/gdrive/companylogo.png').convert('RGBA')
w, h = img.size
px = img.load()

def classify(r, g, b):
    # red family (wordmark + LOGITECH + arrows)
    if r > 130 and g < 0.55 * r and b < 0.55 * r:
        return 'red'
    # gold/orange family (emblem arcs)
    if r > 150 and 0.45 * r < g < 0.95 * r and b < 0.6 * r:
        return 'gold'
    # near black (tagline)
    if r < 90 and g < 90 and b < 90:
        return 'black'
    return 'other'

boxes = {}
counts = {}
for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b, a = px[x, y]
        if a <= 40:
            continue
        c = classify(r, g, b)
        if c == 'other':
            continue
        counts[c] = counts.get(c, 0) + 1
        if c not in boxes:
            boxes[c] = [x, y, x, y]
        else:
            bx = boxes[c]
            bx[0] = min(bx[0], x); bx[1] = min(bx[1], y)
            bx[2] = max(bx[2], x); bx[3] = max(bx[3], y)

print('per-color bbox + count:')
for c, bx in boxes.items():
    print(f'  {c:6s} bbox={tuple(bx)}  size={bx[2]-bx[0]}x{bx[3]-bx[1]}  px={counts[c]}')

# vertical extent of red restricted to the wordmark band (y<560) → separates DRONA vs LOGITECH rows
# horizontal extent of gold → emblem
g = boxes.get('gold')
if g:
    print('\ngold (emblem) detail: x', g[0], '-', g[2], ' y', g[1], '-', g[3])

# sample exact colors: wordmark red, LOGITECH red, tagline black, emblem golds
samples = {'wordmark-red': [], 'logitech-red': [], 'tagline': [], 'emblem-gold': []}
for y in range(0, h, 3):
    for x in range(0, w, 3):
        r, gg, b, a = px[x, y]
        if a > 200:
            c = classify(r, gg, b)
            if c == 'red' and y < 560: samples['wordmark-red'].append((r, gg, b))
            elif c == 'red' and 560 <= y < 800: samples['logitech-red'].append((r, gg, b))
            elif c == 'black' and y >= 800: samples['tagline'].append((r, gg, b))
            elif c == 'gold': samples['emblem-gold'].append((r, gg, b))

import statistics
print('\nexact color samples (median):')
for k, v in samples.items():
    if v:
        mr = statistics.median([p[0] for p in v]); mg = statistics.median([p[1] for p in v]); mb = statistics.median([p[2] for p in v])
        print(f'  {k:14s} #{int(mr):02X}{int(mg):02X}{int(mb):02X}  (n={len(v)})')

# save a big zoom of the emblem region for visual check
emblem = img.crop((max(0, g[0]-40), max(0, g[1]-40), min(w, g[2]+40), min(560, g[3]+40)))
emblem.save('/tmp/gdrive/emblem-zoom.png')
# wordmark-only crop (no emblem) for light bg
print('\nemblem zoom saved')
