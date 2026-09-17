#!/usr/bin/env python3
"""Map color regions of logo-main.png by x-band to understand the layout."""
from PIL import Image
import colorsys

img = Image.open('/home/z/my-project/public/brand/logo-main.png').convert('RGBA')
w, h = img.size
px = img.load()

# column bands of 40px
bands_x = 16
bands_y = 6
grid = {}
for y in range(h):
    by = min(y * bands_y // h, bands_y - 1)
    for x in range(w):
        bx = min(x * bands_x // w, bands_x - 1)
        r, g, b, a = px[x, y]
        if a < 128: continue
        hh, ll, ss = colorsys.rgb_to_hls(r/255, g/255, b/255)
        if ll > 0.82 and ss < 0.18: k = 'WHITE'
        elif ll < 0.30: k = 'DARK'
        elif ss < 0.20: k = 'gray'
        elif hh < 0.05 or hh > 0.94: k = 'red'
        elif hh < 0.11: k = 'orange'
        elif hh < 0.14: k = 'gold'
        else: k = 'other'
        grid.setdefault((bx, by), {}).setdefault(k, 0)
        grid[(bx, by)][k] += 1

hdr = 'x\\y  ' + ''.join(f"{i:>7d}" for i in range(bands_y))
print(hdr); print(f"band width = {w//bands_x}px, band height = {h//bands_y}px")
for bx in range(bands_x):
    row = f"{bx*bands_x//bands_x:>3d}  "
    for by in range(bands_y):
        cell = grid.get((bx, by), {})
        if not cell: row += '      .'
        else:
            top = max(cell, key=cell.get)
            row += f"{top[:6]:>7s}" if top != 'WHITE' else f"  WHIT"
    print(row)

# where exactly are WHITE pixels?
whites = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] >= 128 and colorsys.rgb_to_hls(px[x,y][0]/255, px[x,y][1]/255, px[x,y][2]/255)[1] > 0.82 and colorsys.rgb_to_hls(px[x,y][0]/255, px[x,y][1]/255, px[x,y][2]/255)[2] < 0.18]
if whites:
    xs = [p[0] for p in whites]; ys = [p[1] for p in whites]
    print(f"\nWHITE px: n={len(whites)}  x range {min(xs)}-{max(xs)}  y range {min(ys)}-{max(ys)}")
# where are DARK pixels?
darks = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] >= 128 and colorsys.rgb_to_hls(px[x,y][0]/255, px[x,y][1]/255, px[x,y][2]/255)[1] < 0.30]
if darks:
    xs = [p[0] for p in darks]; ys = [p[1] for p in darks]
    print(f"DARK  px: n={len(darks)}  x range {min(xs)}-{max(xs)}  y range {min(ys)}-{max(ys)}")
