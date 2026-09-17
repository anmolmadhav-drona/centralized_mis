#!/usr/bin/env python3
"""Generate final Drona brand assets for the MIS portal."""
from PIL import Image
import os

SRC = "/home/z/my-project/upload/pasted_image_1789198732211.png"
OUT = "/home/z/my-project/public/brand"
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert("RGBA")

# ---- 1. Full logo: trim to alpha bbox, resize to web-friendly width ----
bbox = img.getbbox()  # (64, 84, 1762, 863)
full = img.crop(bbox)
# target width 1200 (crisp for ~500-600px display on retina)
target_w = 1200
ratio = target_w / full.size[0]
full = full.resize((target_w, int(full.size[1] * ratio)), Image.LANCZOS)
full.save(f"{OUT}/logo-full.png", optimize=True)
print(f"logo-full.png: {full.size}")

# ---- 2. Emblem: square canvas with padding ----
emblem = Image.open("/tmp/emblem-raw.png").convert("RGBA")
eb = emblem.getbbox()
emblem = emblem.crop(eb)
side = max(emblem.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(emblem, ((side - emblem.size[0]) // 2, (side - emblem.size[1]) // 2), emblem)
canvas = canvas.resize((256, 256), Image.LANCZOS)
canvas.save(f"{OUT}/logo-emblem.png", optimize=True)
print(f"logo-emblem.png: {canvas.size}")

# ---- 3. Favicon set for Next.js App Router (src/app/icon.png) ----
icon512 = canvas.resize((512, 512), Image.LANCZOS)
icon512.save("/home/z/my-project/src/app/icon.png", optimize=True)
print("src/app/icon.png: 512x512")

# 32x32 favicon
icon32 = canvas.resize((32, 32), Image.LANCZOS)
icon32.save(f"{OUT}/favicon-32.png", optimize=True)

# apple touch icon (180x180) on subtle warm-white bg so it isn't invisible on dark iOS tiles
apple = Image.new("RGBA", (180, 180), (250, 250, 248, 255))
em = canvas.resize((140, 140), Image.LANCZOS)
apple.paste(em, (20, 20), em)
apple.convert("RGB").save("/home/z/my-project/src/app/apple-icon.png", optimize=True)
print("src/app/apple-icon.png: 180x180")

# ---- 4. Emblem on charcoal (for dark sidebar header, optional dark variant) ----
dark = Image.new("RGBA", (256, 256), (37, 37, 37, 255))
em2 = canvas.resize((200, 200), Image.LANCZOS)
dark.paste(em2, (28, 28), em2)
dark.convert("RGB").save(f"{OUT}/logo-emblem-dark.png", optimize=True)
print("logo-emblem-dark.png: 256x256")

for f in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, f)
    print(f"  {f}: {os.path.getsize(p)//1024} KB")
