#!/usr/bin/env python3
"""ASCII-map the red figure pixels above/around the central figure to see arm shape."""
from PIL import Image
import numpy as np

em = Image.open("/tmp/emblem-raw.png").convert("RGBA")
eb = em.getbbox()
em = em.crop(eb)
side = max(em.size)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.paste(em, ((side - em.size[0]) // 2, (side - em.size[1]) // 2), em)
sq = sq.resize((256, 256), Image.LANCZOS)

arr = np.array(sq, dtype=np.int16)
r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
opaque = a >= 100

# Figure reds: dark red family — R in 90-200, G low, B low-ish (covers #600000-#A81800 + darker AA)
fig = opaque & (r > 80) & (g < 80) & (b < 60) & (r - g > 50)
# exclude the dark inner-arc zone (above y~135)? no — just map region y125-240, x60-196
print("Figure-red pixel map (y125-245 x56-200), 2px cells, # = present:")
for y in range(125, 246, 3):
    row = ""
    for x in range(56, 201, 2):
        cell = fig[y:y+3, x:x+2]
        row += "#" if cell.sum() >= 2 else "."
    print(f"{y:3d} {row}")
