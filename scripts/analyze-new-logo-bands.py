#!/usr/bin/env python3
"""Locate the element bands in the new logo: wordmark row, LOGITECH row, tagline row, emblem."""
from PIL import Image

img = Image.open('/tmp/gdrive/companylogo.png').convert('RGBA')
w, h = img.size
px = img.load()

def row_profile(step=2):
    prof = []
    for y in range(0, h, step):
        cnt = 0
        for x in range(0, w, step * 2):
            if px[x, y][3] > 10:
                cnt += 1
        prof.append((y, cnt))
    return prof

# find bands of consecutive rows with content
prof = row_profile()
bands = []
in_band = False
start = 0
THRESH = 3
for y, c in prof:
    if c > THRESH and not in_band:
        in_band, start = True, y
    elif c <= THRESH and in_band:
        in_band = False
        bands.append((start, y))
if in_band:
    bands.append((start, h))
print('horizontal bands (y ranges with content):')
for b in bands:
    print('  ', b, 'height', b[1]-b[0])

# for the top band (wordmark), find columns with content → DR / emblem / NA split
def col_profile_band(y0, y1, step=2):
    cols = {}
    for x in range(0, w, step):
        cnt = 0
        for y in range(y0, y1, max(2, (y1-y0)//40)):
            if px[x, y][3] > 10:
                cnt += 1
        if cnt > 0:
            cols[x] = cnt
    return cols

if bands:
    top = bands[0]
    cols = col_profile_band(top[0], top[1])
    xs = sorted(cols)
    # group into runs
    runs = []
    run_start = xs[0]; prev = xs[0]
    for x in xs[1:]:
        if x - prev > 12:
            runs.append((run_start, prev))
            run_start = x
        prev = x
    runs.append((run_start, prev))
    print(f'\ntop band x-runs (y {top[0]}..{top[1]}):')
    for r in runs:
        print('  ', r, 'width', r[1]-r[0])

# color composition of each band: red vs dark vs gold pixel shares
def band_colors(y0, y1):
    from collections import Counter
    c = Counter()
    for y in range(y0, y1, 2):
        for x in range(0, w, 4):
            r, g, b, a = px[x, y]
            if a > 200:
                l = 0.2126*r + 0.7152*g + 0.0722*b
                if l < 90: c['dark'] += 1
                elif r > 150 and g < 110 and b < 110: c['red'] += 1
                elif r > 180 and 100 < g < 200 and b < 120: c['gold'] += 1
                else: c['other'] += 1
    return c

print('\nband colors:')
for b in bands:
    print('  ', b, dict(band_colors(b[0], b[1])))
