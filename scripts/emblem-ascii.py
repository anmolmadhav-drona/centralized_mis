#!/usr/bin/env python3
"""Render the emblem gold mask as ASCII art to understand the swirl geometry."""
from PIL import Image

img = Image.open('/tmp/gdrive/companylogo.png').convert('RGBA')
px = img.load()

x0, y0, x1, y1 = 880, 0, 1550, 560  # emblem region with padding
W, H = 76, 46  # ascii grid

def cell(cxp, cyp, cw, ch):
    cnt = tot = 0
    for y in range(max(0, cyp), min(img.size[1], cyp + ch), 3):
        for x in range(max(0, cxp), min(img.size[0], cxp + cw), 3):
            r, g, b, a = px[x, y]
            tot += 1
            if a > 40 and r > 150 and 0.45*r < g < 0.95*r and b < 0.6*r:
                cnt += 1
    if tot == 0:
        return ' '
    frac = cnt / tot
    if frac > 0.55: return '#'
    if frac > 0.30: return '+'
    if frac > 0.10: return '.'
    return ' '

cw = (x1 - x0) / W
ch = (y1 - y0) / H
print('ASCII of emblem (x 880-1550, y 0-560), 1 char ≈ %.0f×%.0f px' % (cw, ch))
for gy in range(H):
    line = ''.join(cell(int(x0 + gx * cw), int(y0 + gy * ch), int(cw) + 1, int(ch) + 1) for gx in range(W))
    print(f'{int(y0 + gy * ch):4d} {line}')
