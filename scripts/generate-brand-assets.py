#!/usr/bin/env python3
"""Generate all brand assets from the new DRONA LOGITECH logo.

Inputs : /tmp/gdrive/companylogo.png   (2510x1081 RGBA, transparent)
Outputs: public/brand/logo-main{,-dark}.{png,webp}   full artwork
         public/brand/logo-emblem{,-dark}.{png,webp} the O-swirl emblem crop
         public/brand/apple-touch-icon.png           180x180 icon
         public/favicon.svg + public/logo.svg        traced vector emblem
         /tmp/gdrive/emblem-path.svg                 path data for DronaMark
Palette: red #DF1E1E · gold #FFA41C · tagline #231F20
"""
from PIL import Image, ImageDraw
import io, os, re

SRC = '/tmp/gdrive/companylogo.png'
BRAND = '/home/z/my-project/public/brand'
PUB = '/home/z/my-project/public'
GOLD = (255, 164, 28)
TAGLINE_DARK_SURFACE = (181, 175, 165)   # warm grey for the tagline on charcoal

img = Image.open(SRC).convert('RGBA')
W, H = img.size
px = img.load()

# ---------------------------------------------------------------- helpers
def content_bbox(im, alpha_min=8):
    """Bounding box of pixels with alpha above threshold."""
    return im.getbbox() if False else _bbox(im, alpha_min)

def _bbox(im, alpha_min):
    p = im.load()
    w, h = im.size
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if p[x, y][3] > alpha_min:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0:
        return None
    return (minx, miny, maxx + 1, maxy + 1)

def save_png_webp(im, stem, widths_note=''):
    png_path = f'{stem}.png'
    im.save(png_path, optimize=True)
    webp_path = f'{stem}.webp'
    im.save(webp_path, lossless=True, method=6)
    print(f'  {os.path.basename(stem)}.png {im.size} {os.path.getsize(png_path)//1024}KB'
          f' | .webp {os.path.getsize(webp_path)//1024}KB {widths_note}')

def dark_surface_variant(im):
    """Charcoal-surface variant: keep red + gold, lift the near-black tagline.

    The tagline (#231F20, saturation < 50) is invisible on the charcoal
    sidebar — recolor it (and only it) to a warm grey. Hue/sat of every
    other pixel is untouched; alpha (antialiasing) is preserved as-is.
    """
    out = im.copy()
    op = out.load()
    w, h = out.size
    changed = kept = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = op[x, y]
            if a == 0:
                continue
            sat = max(r, g, b) - min(r, g, b)
            if sat < 55 and (r + g + b) / 3 < 160:
                # near-black desaturated → tagline (or its antialias fringe)
                # blend toward the warm grey in proportion to darkness
                t = 1.0 - ((r + g + b) / 3) / 160.0
                tr, tg, tb = TAGLINE_DARK_SURFACE
                op[x, y] = (
                    int(tr * t + r * (1 - t)),
                    int(tg * t + g * (1 - t)),
                    int(tb * t + b * (1 - t)),
                    a,
                )
                changed += 1
            else:
                kept += 1
    print(f'    dark variant: {changed} px lifted (tagline), {kept} kept')
    return out

# ---------------------------------------------------------------- 1. full logo
bbox = content_bbox(img)
print('full artwork content bbox:', bbox)
x0, y0, x1, y1 = bbox
full = img.crop((x0, y0, x1, y1))
fw, fh = full.size
print(f'trimmed full artwork: {fw}x{fh}  aspect={fh/fw:.4f}')

MAIN_W = 1280
main_h = round(MAIN_W * fh / fw)
main = full.resize((MAIN_W, main_h), Image.LANCZOS)
print(f'\n== logo-main (light) {main.size} ==')
save_png_webp(main, f'{BRAND}/logo-main')

main_dark_full = dark_surface_variant(full)
main_dark = main_dark_full.resize((MAIN_W, main_h), Image.LANCZOS)
print(f'== logo-main-dark {main_dark.size} ==')
save_png_webp(main_dark, f'{BRAND}/logo-main-dark')

# ---------------------------------------------------------------- 2. emblem crop
# gold bbox measured: (904, 0, 1522, 538); pad 14px horizontally, keep top at 0
ex0, ey0, ex1, ey1 = 904, 0, 1522, 538
PAD = 14
cx0 = max(0, ex0 - PAD); cy0 = max(0, ey0 - PAD)
cx1 = min(W, ex1 + PAD); cy1 = min(H, ey1 + PAD)
emblem = img.crop((cx0, cy0, cx1, cy1))
# trim any alpha stray
eb = content_bbox(emblem)
emblem = emblem.crop(eb)
ew, eh = emblem.size
print(f'\nemblem crop: ({cx0},{cy0})-({cx1},{cy1}) → {ew}x{eh}  aspect={eh/ew:.4f}')

EMBLEM_W = 340
emblem_h = round(EMBLEM_W * eh / ew)
emblem_r = emblem.resize((EMBLEM_W, emblem_h), Image.LANCZOS)
print(f'== logo-emblem (light) {emblem_r.size} ==')
save_png_webp(emblem_r, f'{BRAND}/logo-emblem')

emblem_dark = dark_surface_variant(emblem)
emblem_dark_r = emblem_dark.resize((EMBLEM_W, emblem_h), Image.LANCZOS)
print(f'== logo-emblem-dark {emblem_dark_r.size} ==')
save_png_webp(emblem_dark_r, f'{BRAND}/logo-emblem-dark')

# ---------------------------------------------------------------- 3. apple-touch-icon
icon = Image.new('RGB', (180, 180), (255, 255, 255))
em_big = emblem.resize((150, round(150 * eh / ew)), Image.LANCZOS)
icon.paste(em_big, ((180 - em_big.width) // 2, (180 - em_big.height) // 2), em_big)
icon.save(f'{BRAND}/apple-touch-icon.png', optimize=True)
print(f'\n== apple-touch-icon.png 180x180 {os.path.getsize(f"{BRAND}/apple-touch-icon.png")//1024}KB')

# ---------------------------------------------------------------- 4. traced vector emblem
import numpy as np
from potrace import Bitmap

# trace from a downscaled binary mask of the emblem
trace_w = 460
trace_im = emblem.resize((trace_w, round(trace_w * eh / ew)), Image.LANCZOS)
arr = np.array(trace_im)
mask = (arr[:, :, 3] > 60)
# potracer treats True as BACKGROUND — trace the inverse
bmp = Bitmap(~mask)
path = bmp.trace()
print(f'\npotrace: {len(path)} curves on {trace_w}-wide mask')

def fmt(v):
    s = f'{v:.1f}'.rstrip('0').rstrip('.')
    return s if s != '-0' else '0'

d_parts = []
for curve in path:
    start = curve.start_point
    d_parts.append(f'M{fmt(start.x)} {fmt(start.y)}')
    for seg in curve.segments:
        if seg.is_corner:
            d_parts.append(f'L{fmt(seg.c.x)} {fmt(seg.c.y)}L{fmt(seg.end_point.x)} {fmt(seg.end_point.y)}')
        else:
            c1, c2 = seg.c1, seg.c2
            d_parts.append(
                f'C{fmt(c1.x)} {fmt(c1.y)} {fmt(c2.x)} {fmt(c2.y)} {fmt(seg.end_point.x)} {fmt(seg.end_point.y)}'
            )
    d_parts.append('Z')
d = ''.join(d_parts)
print(f'path length: {len(d)} chars')

th = round(trace_w * eh / ew)
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {trace_w} {th}">'
    f'<path d="{d}" fill="#FFA41C"/></svg>\n'
)
open('/tmp/gdrive/emblem-path.svg', 'w').write(svg)
for dest in [f'{PUB}/favicon.svg', f'{PUB}/logo.svg']:
    open(dest, 'w').write(svg)
    print(f'{dest}: {len(svg)//1024}KB')

# quick render check of the traced svg vs source mask
render = Image.new('RGBA', (trace_w, th), (0, 0, 0, 0))
# rasterize with cairosvg if present, else skip
try:
    import cairosvg
    png_bytes = cairosvg.svg2png(bytestring=svg.encode(), output_width=460)
    check = Image.open(io.BytesIO(png_bytes)).convert('RGBA')
    # compare coverage
    a_src = (np.array(trace_im)[:, :, 3] > 60)
    a_tr = (np.array(check)[:, :, 3] > 60)
    inter = (a_src & a_tr).sum()
    union = (a_src | a_tr).sum()
    print(f'trace fidelity (IoU vs source mask): {inter/union:.3f}')
except ImportError:
    print('cairosvg not available — skipping render check')

print('\nALL ASSETS GENERATED')
print(f'ASPECTS: main {main_h}/{MAIN_W} = {main_h/MAIN_W:.4f} | emblem {emblem_h}/{EMBLEM_W} = {emblem_h/EMBLEM_W:.4f}')
