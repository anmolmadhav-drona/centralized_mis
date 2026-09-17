#!/usr/bin/env python3
"""Analyze the new companyLOGO PNG from Google Drive."""
from PIL import Image
import os

SRC = '/tmp/gdrive/companylogo_dl.bin'
img = Image.open(SRC)
print('format:', img.format, 'mode:', img.mode, 'size:', img.size)

rgba = img.convert('RGBA')
w, h = rgba.size
px = rgba.load()

# alpha stats
transparent = semi = opaque = 0
min_x, min_y, max_x, max_y = w, h, 0, 0
for y in range(0, h, 4):
    for x in range(0, w, 4):
        a = px[x, y][3]
        if a == 0:
            transparent += 1
        elif a < 250:
            semi += 1
        else:
            opaque += 1
        if a > 10:
            if x < min_x: min_x = x
            if x > max_x: max_x = x
            if y < min_y: min_y = y
            if y > max_y: max_y = y
total = (w // 4) * (h // 4)
print(f'alpha: transparent {transparent/total:.1%}, semi {semi/total:.1%}, opaque {opaque/total:.1%}')
print('content bbox (a>10):', (min_x, min_y, max_x, max_y), '→ content w×h:', max_x-min_x, 'x', max_y-min_y)

# dominant colors among opaque pixels
from collections import Counter
cnt = Counter()
for y in range(0, h, 6):
    for x in range(0, w, 6):
        r, g, b, a = px[x, y]
        if a > 200:
            cnt[(r//16*16, g//16*16, b//16*16)] += 1
print('\ntop colors (r,g,b bucketed):')
for c, n in cnt.most_common(14):
    print(f'  #{c[0]:02X}{c[1]:02X}{c[2]:02X}  {n}')

# luminance distribution of opaque pixels (how dark is the artwork overall)
lum = 0; n_lum = 0; dark_px = 0; mid = 0; light = 0
for y in range(0, h, 6):
    for x in range(0, w, 6):
        r, g, b, a = px[x, y]
        if a > 200:
            l = 0.2126*r + 0.7152*g + 0.0722*b
            lum += l; n_lum += 1
            if l < 80: dark_px += 1
            elif l < 180: mid += 1
            else: light += 1
print(f'\nluminance: mean {lum/max(n_lum,1):.0f} | dark(<80) {dark_px/n_lum:.1%}, mid {mid/n_lum:.1%}, light(>180) {light/n_lum:.1%}')

# render previews on light + dark backgrounds
os.makedirs('/tmp/gdrive/preview', exist_ok=True)
for name, bgcolor in [('light', (255, 255, 255)), ('dark', (34, 32, 29)), ('cream', (250, 250, 248))]:
    bg = Image.new('RGB', rgba.size, bgcolor)
    bg.paste(rgba, (0, 0), rgba)
    bg.thumbnail((1200, 1200))
    bg.save(f'/tmp/gdrive/preview/logo-on-{name}.png')
print('\npreviews saved: /tmp/gdrive/preview/logo-on-{light,dark,cream}.png')

# also save an upscaled-free exact copy as PNG for later processing
rgba.save('/tmp/gdrive/companylogo.png')
print('saved /tmp/gdrive/companylogo.png')
