#!/usr/bin/env python3
"""Optimize brand assets for web delivery + small-size quality check."""
from PIL import Image
import os

BRAND = "/home/z/my-project/public/brand"

# ---- 1. Full logo: 640px-wide PNG + WebP, pick the smaller ----
full = Image.open(f"{BRAND}/logo-full.png")  # 1200x550
full640 = full.resize((640, 293), Image.LANCZOS)
full640.save("/tmp/logo-full-640.png", optimize=True)
full640.save("/tmp/logo-full-640.webp", lossless=False, quality=90, method=6)
print(f"full 640 png: {os.path.getsize('/tmp/logo-full-640.png')//1024} KB, webp: {os.path.getsize('/tmp/logo-full-640.webp')//1024} KB")

# ---- 2. Emblem: 128px small variant + webp ----
emblem = Image.open(f"{BRAND}/logo-emblem.png")  # 256x256
emblem.save("/tmp/emblem-256.webp", lossless=True, method=6)
em128 = emblem.resize((128, 128), Image.LANCZOS)
em128.save("/tmp/emblem-128.png", optimize=True)
em128.save("/tmp/emblem-128.webp", lossless=True, method=6)
print(f"emblem 256 png: {os.path.getsize(f'{BRAND}/logo-emblem.png')//1024} KB, webp(lossless): {os.path.getsize('/tmp/emblem-256.webp')//1024} KB")
print(f"emblem 128 png: {os.path.getsize('/tmp/emblem-128.png')//1024} KB, webp: {os.path.getsize('/tmp/emblem-128.webp')//1024} KB")

# ---- 3. Quality check: composite emblem at 32/40/56px on charcoal + warm-white ----
check = Image.new("RGB", (600, 140), (250, 250, 248))  # warm white top row
# charcoal bottom band
ch = Image.new("RGB", (600, 60), (37, 37, 37))
check.paste(ch, (0, 80))
x = 10
for s in (32, 40, 56):
    em = emblem.resize((s, s), Image.LANCZOS)
    check.paste(em, (x, 10), em)          # on white
    check.paste(em, (x, 90), em)          # on charcoal
    x += s + 30
check.save("/tmp/emblem-scale-check.png")
print("saved /tmp/emblem-scale-check.png")

# ---- 4. Also: does the FULL logo work on warm white? composite preview ----
bg = Image.new("RGB", (760, 420), (250, 250, 248))
fl = full640.resize((560, 257), Image.LANCZOS)
bg.paste(fl, (100, 80), fl)
bg.save("/tmp/full-on-warm-bg.png")
print("saved /tmp/full-on-warm-bg.png")
