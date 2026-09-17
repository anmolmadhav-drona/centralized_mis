#!/usr/bin/env python3
"""Compare old logo-main vs logo-main-dark to learn the dark-surface color treatment."""
from PIL import Image
from collections import Counter

light = Image.open('/home/z/my-project/public/brand/logo-main.png').convert('RGBA')
dark = Image.open('/home/z/my-project/public/brand/logo-main-dark.png').convert('RGBA')
print('sizes:', light.size, dark.size)

lw, lh = light.size
lpx, dpx = light.load(), dark.load()

# map: quantized light color -> most common dark color
mapping = Counter()
for y in range(0, lh, 2):
    for x in range(0, lw, 2):
        lr, lg, lb, la = lpx[x, y]
        dr, dg, db, da = dpx[x, y]
        if la > 200 and da > 200:
            mapping[(lr//24*24, lg//24*24, lb//24*24, dr//24*24, dg//24*24, db//24*24)] += 1

print('\nlight-bucket -> dark-bucket (top 18 by frequency):')
for k, n in mapping.most_common(18):
    lb_, db_ = k[:3], k[3:]
    print(f'  #{lb_[0]:02X}{lb_[1]:02X}{lb_[2]:02X} -> #{db_[0]:02X}{db_[1]:02X}{db_[2]:02X}  n={n}')

# apple-touch-icon analysis
ati = Image.open('/home/z/my-project/public/brand/apple-touch-icon.png').convert('RGB')
apx = ati.load()
cnt = Counter()
for y in range(0, 180, 3):
    for x in range(0, 180, 3):
        r, g, b = apx[x, y]
        cnt[(r//32*32, g//32*32, b//32*32)] += 1
print('\napple-touch-icon top colors:', cnt.most_common(6))
