#!/usr/bin/env python3
"""Final brand asset generation for the Drona MIS portal:
1. logo-main (tagline-less crop of the ORIGINAL logo) png+webp
2. favicon.svg / logo.svg — simplified authentic emblem (4 arcs + figures)
3. apple-touch-icon.png — simplified mark drawn at 180px
4. cleanup of intermediates
"""
from PIL import Image
import math, os, shutil

SRC = "/home/z/my-project/upload/pasted_image_1789198732211.png"
BRAND = "/home/z/my-project/public/brand"
DL = "/home/z/my-project/download/brand-assets"
os.makedirs(BRAND, exist_ok=True)
os.makedirs(DL, exist_ok=True)

# ---------- geometry constants (shared with DronaLogo.tsx) ----------
CX, CY = 120.0, 120.0
ARCS = [  # (radius, terminalAngleLeft, terminalAngleRight, stroke)
    (16.0, 122.0, 58.0, 15.0),
    (44.0, 132.0, 48.0, 15.0),
    (72.0, 142.0, 38.0, 15.0),
    (100.0, 152.0, 28.0, 15.0),
]
LIGHT_ARC = ["#C9490A", "#E06E02", "#F08B00", "#F59E0B"]
DARK_ARC = ["#DE6208", "#EE8503", "#F9A108", "#FFB62E"]
FIG_LIGHT, FIG_DARK = "#A91518", "#D6552E"

def pt(r, deg):
    rad = math.radians(deg)
    return CX + r * math.cos(rad), CY + r * math.sin(rad)

def arc_path(r, aL, aR):
    x1, y1 = pt(r, aL)
    x2, y2 = pt(r, aR)
    return f"M {x1:.2f} {y1:.2f} A {r:.2f} {r:.2f} 0 1 1 {x2:.2f} {y2:.2f}"

# ---------- 1. logo-main: original logo without the tagline row ----------
img = Image.open(SRC).convert("RGBA")
main_crop = img.crop((64, 84, 1762, 672))   # cut everything below GROUPS+gold lines
main_crop = main_crop.crop(main_crop.getbbox())
w640 = 640
main640 = main_crop.resize((w640, round(main_crop.size[1] * w640 / main_crop.size[0])), Image.LANCZOS)
print(f"logo-main: {main_crop.size} -> {main640.size}")
main640.save(f"{BRAND}/logo-main.png", optimize=True)
main640.save(f"{BRAND}/logo-main.webp", quality=90, method=6)

# full logo (with tagline) for the user's asset pack
full = img.crop(img.getbbox())
full640 = full.resize((w640, round(full.size[1] * w640 / full.size[0])), Image.LANCZOS)
full640.save(f"{DL}/logo-full.png", optimize=True)
full640.save(f"{DL}/logo-full.webp", quality=90, method=6)
# high-res emblem for the asset pack
shutil.copy("/tmp/emblem-raw.png", f"{DL}/logo-emblem-original.png")

# ---------- 2. simplified emblem SVG (favicon + logo) ----------
def emblem_svg(arc_colors, fig_color):
    paths = []
    for (r, aL, aR, sw), col in zip(ARCS, arc_colors):
        paths.append(f'<path d="{arc_path(r, aL, aR)}" stroke="{col}" stroke-width="{sw}" fill="none" stroke-linecap="round"/>')
    paths.append(f'<circle cx="120" cy="148" r="10.5" fill="{fig_color}"/>')
    paths.append(f'<path d="M 111 170 Q 120 163.5 129 170 L 132.5 199 Q 120 204.5 107.5 199 Z" fill="{fig_color}"/>')
    paths.append(f'<path d="M 113 175 L 96 158" stroke="{fig_color}" stroke-width="7" stroke-linecap="round"/>')
    paths.append(f'<path d="M 127 175 L 144 158" stroke="{fig_color}" stroke-width="7" stroke-linecap="round"/>')
    paths.append(f'<circle cx="40" cy="146" r="7.5" fill="{fig_color}"/>')
    paths.append(f'<path d="M 47 152 L 63 136" stroke="{fig_color}" stroke-width="5.5" stroke-linecap="round"/>')
    paths.append(f'<circle cx="200" cy="146" r="7.5" fill="{fig_color}"/>')
    paths.append(f'<path d="M 193 152 L 177 136" stroke="{fig_color}" stroke-width="5.5" stroke-linecap="round"/>')
    body = "\n    ".join(paths)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
    {body}
</svg>
'''

svg_light = emblem_svg(LIGHT_ARC, FIG_LIGHT)
with open("/home/z/my-project/public/favicon.svg", "w") as f:
    f.write(svg_light)
with open("/home/z/my-project/public/logo.svg", "w") as f:
    f.write(svg_light)
# dark variant for the asset pack
with open(f"{DL}/logo-mark-dark.svg", "w") as f:
    f.write(emblem_svg(DARK_ARC, FIG_DARK))
print("favicon.svg / logo.svg written")

# ---------- 3. apple-touch-icon.png (180px, simplified mark on warm white) ----------
S = 180
scale = S / 240.0
canvas = Image.new("RGB", (S, S), (250, 250, 248))
from PIL import ImageDraw
draw = ImageDraw.Draw(canvas)

def aabb(r):
    return [ (CX - r) * scale, (CY - r) * scale, (CX + r) * scale, (CY + r) * scale ]

for (r, aL, aR, sw), col in zip(ARCS, LIGHT_ARC):
    rgb = tuple(int(col[i:i+2], 16) for i in (1, 3, 5))
    draw.arc(aabb(r), start=aL, end=aR + 360, fill=rgb, width=round(sw * scale))

fig = tuple(int(FIG_LIGHT[i:i+2], 16) for i in (1, 3, 5))
def E(cx_, cy_, r_):
    rs = r_ * scale
    draw.ellipse([(cx_ - rs) * scale * 240 / 240 - rs + cx_ * scale - cx_ * scale, 0, 0, 0])  # placeholder
# simpler: direct scaled drawing
def circle(cx_, cy_, r_):
    x, y, rs = cx_ * scale, cy_ * scale, r_ * scale
    draw.ellipse([x - rs, y - rs, x + rs, y + rs], fill=fig)
def line(x1, y1, x2, y2, w_):
    draw.line([(x1 * scale, y1 * scale), (x2 * scale, y2 * scale)], fill=fig, width=round(w_ * scale))
    # round caps
    r_ = w_ * scale / 2
    for (px, py) in [(x1 * scale, y1 * scale), (x2 * scale, y2 * scale)]:
        draw.ellipse([px - r_, py - r_, px + r_, py + r_], fill=fig)

circle(120, 148, 10.5)
# body trapezoid
body_pts = [(111 * scale, 170 * scale), (120 * scale, 163.5 * scale), (129 * scale, 170 * scale),
            (132.5 * scale, 199 * scale), (120 * scale, 204.5 * scale), (107.5 * scale, 199 * scale)]
draw.polygon(body_pts, fill=fig)
line(113, 175, 96, 158, 7)
line(127, 175, 144, 158, 7)
circle(40, 146, 7.5)
line(47, 152, 63, 136, 5.5)
circle(200, 146, 7.5)
line(193, 152, 177, 136, 5.5)

canvas.save("/home/z/my-project/public/brand/apple-touch-icon.png", optimize=True)
print(f"apple-touch-icon.png {canvas.size}")

# ---------- 4. cleanup ----------
for f in ["logo-full.png", "logo-emblem.png", "logo-emblem-dark.png", "favicon-32.png"]:
    p = os.path.join(BRAND, f)
    if os.path.exists(p):
        os.remove(p)
for f in ["icon.png", "apple-icon.png"]:
    p = os.path.join("/home/z/my-project/src/app", f)
    if os.path.exists(p):
        os.remove(p)
print("\npublic/brand:", sorted(os.listdir(BRAND)))
print("download/brand-assets:", sorted(os.listdir(DL)))
for f in sorted(os.listdir(BRAND)):
    print(f"  {f}: {os.path.getsize(os.path.join(BRAND, f))//1024} KB")
