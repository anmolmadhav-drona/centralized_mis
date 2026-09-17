#!/usr/bin/env python3
"""Analyze the Drona logo assets: alpha transparency, color composition, wordmark colors."""
from PIL import Image
import colorsys
from collections import Counter

def analyze(path):
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    px = img.load()
    print(f"\n=== {path}  {w}x{h} ===")
    # corner alpha
    corners = [(0,0),(w-1,0),(0,h-1),(w-1,h-1),(w//2,0),(w//2,h-1)]
    print("corners:", [(c, px[c]) for c in corners])
    # alpha stats over all pixels
    total = w*h
    opaque = sum(1 for y in range(h) for x in range(w) if px[x,y][3] > 200)
    semi = sum(1 for y in range(h) for x in range(w) if 0 < px[x,y][3] <= 200)
    print(f"opaque(>200): {opaque} ({100*opaque/total:.1f}%)  semi: {semi} ({100*semi/total:.1f}%)  transparent: {total-opaque-semi}")
    # color buckets of opaque pixels
    buckets = Counter()
    samples = {}
    for y in range(h):
        for x in range(w):
            r,g,b,a = px[x,y]
            if a < 128: continue
            hh, ll, ss = colorsys.rgb_to_hls(r/255, g/255, b/255)
            if ll < 0.16 and ss < 0.25: k='near-black (L<0.16,S<0.25)'
            elif ll < 0.35 and ss < 0.25: k='dark-neutral (L<0.35,S<0.25)'
            elif ss < 0.25: k='neutral/light-gray'
            elif hh < 0.045 or hh > 0.94: k='red'
            elif hh < 0.09: k='orange/red-orange'
            elif hh < 0.13: k='gold/amber'
            elif hh < 0.20: k='yellow/brown-gold'
            elif hh < 0.35: k='olive/brown-green?'
            elif hh < 0.55: k='green?'
            elif hh < 0.75: k='cyan?'
            elif hh < 0.85: k='blue?'
            else: k='purple/magenta?'
            buckets[k] += 1
            if k not in samples: samples[k] = (x, y, (r,g,b))
    for k, v in buckets.most_common():
        print(f"  {k:34s} {v:7d}  {100*v/opaque:5.1f}%  e.g.{samples[k]}")
    return img, px, w, h

img, px, w, h = analyze('/home/z/my-project/public/brand/logo-main.png')

# sample the wordmark regions — the emblem (the O) sits ~x 200-472 per Task 14 crop; wordmark left "DR" and right "NA GROUPS"
print("\n--- row scan y=110 (middle), runs of opaque colors (first 60) ---")
runs = []
cur = None
for x in range(w):
    r,g,b,a = px[x,110]
    key = 'T' if a < 128 else f"#{r:02X}{g:02X}{b:02X}"
    if key != cur:
        runs.append((x, key)); cur = key
print(runs[:60])

print("\n--- dominant opaque colors overall ---")
cc = Counter()
for y in range(h):
    for x in range(w):
        r,g,b,a = px[x,y]
        if a >= 128: cc[(r//16*16, g//16*16, b//16*16)] += 1
for (r,g,b), n in cc.most_common(14):
    print(f"  #{r:02X}{g:02X}{b:02X}  {n}")

analyze('/home/z/my-project/public/brand/logo-emblem.png')
