#!/usr/bin/env python3
"""
Drona logo — dark-surface variants.

The original artwork is transparent with bright-red wordmark, golds, whites —
but ~40% of its pixels are very dark browns/reds (illustration + banner) that
vanish on the charcoal sidebar (#252525 / #1C1A17).

This transform keeps hue + saturation + alpha (the red/gold/brown artwork is
preserved) and only lifts pixels darker than T to a visible band:
    L' = L + W * (T - L)   for L < T        (T=0.36, W=0.75)
so the darkest tone lands at ~0.27 HLS and everything above T is untouched.

Outputs:
  public/brand/logo-main-dark.{png,webp}
  public/brand/logo-emblem-dark.{png,webp}
  scripts/preview/logo-dark-preview.png  (contact sheet on charcoal for review)
"""
from PIL import Image
import colorsys
import os

T = 0.36   # luminance threshold (HLS)
W = 0.75   # lift strength toward T
SRC = '/home/z/my-project/public/brand'
OUT = SRC
PREVIEW_DIR = '/home/z/my-project/scripts/preview'


def lift(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
    if l < T:
        l = l + W * (T - l)
    r2, g2, b2 = colorsys.hls_to_rgb(h, l, s)
    return int(round(r2 * 255)), int(round(g2 * 255)), int(round(b2 * 255))


def transform(src_path, base):
    img = Image.open(src_path).convert('RGBA')
    w, h = img.size
    px = img.load()
    changed = kept = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hls = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
            nr, ng, nb = lift(r, g, b)
            if (nr, ng, nb) != (r, g, b):
                changed += 1
            else:
                kept += 1
            px[x, y] = (nr, ng, nb, a)
    png_path = f'{OUT}/{base}.png'
    webp_path = f'{OUT}/{base}.webp'
    img.save(png_path, optimize=True)
    img.save(webp_path, 'WEBP', quality=92, method=6)
    print(f'{base}: {w}x{h}  lifted={changed}  kept={kept}  '
          f'png={os.path.getsize(png_path)//1024}KB  webp={os.path.getsize(webp_path)//1024}KB')
    return Image.open(png_path).convert('RGBA')


main_dark = transform(f'{SRC}/logo-main.png', 'logo-main-dark')
emblem_dark = transform(f'{SRC}/logo-emblem.png', 'logo-emblem-dark')
main_orig = Image.open(f'{SRC}/logo-main.png').convert('RGBA')
emblem_orig = Image.open(f'{SRC}/logo-emblem.png').convert('RGBA')

# ---- contact sheet: original vs dark-variant, both on charcoal #252525 ----
os.makedirs(PREVIEW_DIR, exist_ok=True)
CW, PAD = 660, 40
rows = [
    ('logo-main ORIGINAL (on charcoal)', main_orig, 480),
    ('logo-main DARK VARIANT (on charcoal)', main_dark, 480),
    ('emblem ORIGINAL | DARK VARIANT (on charcoal)', None, 0),  # composite row
]
row_h_main = 130
row_h_emblem = 120
sheet = Image.new('RGB', (CW * 2, PAD + row_h_main * 2 + row_h_emblem + PAD * 3), (37, 37, 37))
from PIL import ImageDraw
draw = ImageDraw.Draw(sheet)
y = PAD
for title, img, disp_w in rows[:2]:
    draw.text((10, y - 14), title, fill=(232, 154, 22))
    ratio = disp_w / img.width
    im = img.resize((disp_w, int(img.height * ratio)), Image.LANCZOS)
    # center on charcoal swatch spanning both columns
    swatch = Image.new('RGB', (CW * 2 - 20, row_h_main), (37, 37, 37))
    swatch.paste(im, ((swatch.width - im.width) // 2, (swatch.height - im.height) // 2), im)
    sheet.paste(swatch, (10, y))
    y += row_h_main + PAD
draw.text((10, y - 14), 'emblem ORIGINAL | DARK VARIANT (on charcoal)', fill=(232, 154, 22))
for i, img in enumerate([emblem_orig, emblem_dark]):
    im = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
    swatch = Image.new('RGB', (CW - 20, row_h_emblem), (37, 37, 37))
    swatch.paste(im, ((swatch.width - im.width) // 2, (swatch.height - im.height) // 2), im)
    sheet.paste(swatch, (10 + i * CW, y))
sheet.save(f'{PREVIEW_DIR}/logo-dark-preview.png')
print(f'preview -> {PREVIEW_DIR}/logo-dark-preview.png')
