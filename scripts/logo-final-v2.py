#!/usr/bin/env python3
"""Regenerate favicon.svg / logo.svg / apple-touch-icon.png with the faithful
v2 mark geometry: 4 arcs + THREE standing figures, flanker arms converging."""
from PIL import Image, ImageDraw
import os

# ---- shared geometry (viewBox 0 0 240 240, center 120,120) ----
ARCS = [  # (path-d, color-light, color-dark, radius for PIL, terminal angles)
    ("M 108.11 130.71 A 16 16 0 1 1 131.89 130.71", "#C9490A", "#DE6208", 16, 138, 42),
    ("M 90.56 152.69 A 44 44 0 1 1 149.44 152.69", "#E06E02", "#EE8503", 44, 132, 48),
    ("M 63.26 164.35 A 72 72 0 1 1 176.74 164.35", "#F08B00", "#F9A108", 72, 142, 38),
    ("M 31.71 166.95 A 100 100 0 1 1 208.29 166.95", "#F59E0B", "#FFB62E", 100, 152, 28),
]
FIG_L, FIG_D = "#A91518", "#D14A32"

CENTER_HEAD = ("circle", 120, 150, 10.5)
CENTER_BODY = "M 110 163 Q 120 157.5 130 163 L 138 209.5 Q 138.5 212 135 212 L 105 212 Q 101.5 212 102 209.5 Z"
L_HEAD = ("circle", 92, 126, 7.5)
L_BODY = "M 82.5 132 Q 89 127.5 95.5 132 L 98 209 Q 89 213.5 80 209 Z"
L_ARM = "M 95 151 C 97 137 103 127 113 121"
R_HEAD = ("circle", 148, 126, 7.5)
R_BODY = "M 144.5 132 Q 151 127.5 157.5 132 L 160 209 Q 151 213.5 142 209 Z"
R_ARM = "M 145 151 C 143 137 137 127 127 121"

def mark_svg(arc_colors, fig):
    parts = []
    for (d, cl, cd, _r, _a, _b) in ARCS:
        parts.append(f'  <path d="{d}" stroke="{arc_colors[ARCS.index((d, cl, cd, _r, _a, _b))]}" stroke-width="15" fill="none" stroke-linecap="round"/>')
    parts = []
    for (d, cl, cd, _r, _a, _b), col in zip(ARCS, arc_colors):
        parts.append(f'  <path d="{d}" stroke="{col}" stroke-width="15" fill="none" stroke-linecap="round"/>')
    parts.append(f'  <circle cx="{CENTER_HEAD[1]}" cy="{CENTER_HEAD[2]}" r="{CENTER_HEAD[3]}" fill="{fig}"/>')
    parts.append(f'  <path d="{CENTER_BODY}" fill="{fig}"/>')
    parts.append(f'  <circle cx="{L_HEAD[1]}" cy="{L_HEAD[2]}" r="{L_HEAD[3]}" fill="{fig}"/>')
    parts.append(f'  <path d="{L_BODY}" fill="{fig}"/>')
    parts.append(f'  <path d="{L_ARM}" stroke="{fig}" stroke-width="6" fill="none" stroke-linecap="round"/>')
    parts.append(f'  <circle cx="{R_HEAD[1]}" cy="{R_HEAD[2]}" r="{R_HEAD[3]}" fill="{fig}"/>')
    parts.append(f'  <path d="{R_BODY}" fill="{fig}"/>')
    parts.append(f'  <path d="{R_ARM}" stroke="{fig}" stroke-width="6" fill="none" stroke-linecap="round"/>')
    return ("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 240 240\">\n"
            + "\n".join(parts) + "\n</svg>\n")

light = mark_svg([a[1] for a in ARCS], FIG_L)
dark = mark_svg([a[2] for a in ARCS], FIG_D)

with open("/home/z/my-project/public/favicon.svg", "w") as f: f.write(light)
with open("/home/z/my-project/public/logo.svg", "w") as f: f.write(light)
with open("/home/z/my-project/download/brand-assets/logo-mark-dark.svg", "w") as f: f.write(dark)
with open("/home/z/my-project/download/brand-assets/logo-mark-light.svg", "w") as f: f.write(light)
print("svgs written")

# ---- apple-touch-icon.png via PIL ----
S = 180
scale = S / 240.0
canvas = Image.new("RGB", (S, S), (250, 250, 248))
draw = ImageDraw.Draw(canvas)

def rgb(hexs): return tuple(int(hexs[i:i+2], 16) for i in (1, 3, 5))

for (_d, cl, _cd, r, aL, aR) in ARCS:
    box = [(120 - r) * scale, (120 - r) * scale, (120 + r) * scale, (120 + r) * scale]
    draw.arc(box, start=aL, end=aR + 360, fill=rgb(cl), width=max(2, round(15 * scale)))

fig = rgb(FIG_L)
def circle(cx, cy, r):
    x, y, rs = cx * scale, cy * scale, r * scale
    draw.ellipse([x - rs, y - rs, x + rs, y + rs], fill=fig)
def stroke_line(x1, y1, x2, y2, w):
    draw.line([(x1 * scale, y1 * scale), (x2 * scale, y2 * scale)], fill=fig, width=round(w * scale))
    r_ = w * scale / 2
    for (px, py) in [(x1 * scale, y1 * scale), (x2 * scale, y2 * scale)]:
        draw.ellipse([px - r_, py - r_, px + r_, py + r_], fill=fig)

circle(*CENTER_HEAD[1:])
# center body polygon (approximate the Q curves)
draw.polygon([(110*scale,163*scale),(120*scale,158.5*scale),(130*scale,163*scale),
              (138*scale,210*scale),(120*scale,212.5*scale),(102*scale,210*scale)], fill=fig)
circle(*L_HEAD[1:])
draw.polygon([(83*scale,133*scale),(89*scale,129*scale),(95.5*scale,133*scale),
              (98*scale,209.5*scale),(89*scale,212*scale),(80.5*scale,209.5*scale)], fill=fig)
# left arm as segmented curve (bezier approx)
import math
def bezier(p0, p1, p2, p3, n=14):
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t**2*p2[0] + t**3*p3[0]
        y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t**2*p2[1] + t**3*p3[1]
        pts.append((x * scale, y * scale))
    return pts
for a, b in zip(bezier((95,151),(97,137),(103,127),(113,121)), bezier((95,151),(97,137),(103,127),(113,121))[1:]):
    draw.line([a, b], fill=fig, width=max(2, round(6*scale)))
for a, b in zip(bezier((145,151),(143,137),(137,127),(127,121)), bezier((145,151),(143,137),(137,127),(127,121))[1:]):
    draw.line([a, b], fill=fig, width=max(2, round(6*scale)))
circle(*R_HEAD[1:])
draw.polygon([(144.5*scale,133*scale),(151*scale,129*scale),(157.5*scale,133*scale),
              (159.5*scale,209.5*scale),(151*scale,212*scale),(142.5*scale,209.5*scale)], fill=fig)

canvas.save("/home/z/my-project/public/brand/apple-touch-icon.png", optimize=True)
print("apple icon written")

# also render a big PNG of the light + dark mark for VLM comparison
def render_mark(colors, figc, size=240, bg=None):
    c = Image.new("RGBA", (size, size), bg or (0,0,0,0))
    d = ImageDraw.Draw(c)
    sc = size/240
    for (_d, cl, _cd, r, aL, aR) in ARCS:
        box = [(120-r)*sc, (120-r)*sc, (120+r)*sc, (120+r)*sc]
        d.arc(box, start=aL, end=aR+360, fill=rgb(colors[ARCS.index((_d, cl, _cd, r, aL, aR))]), width=max(2, round(15*sc)))
    return c

# quick composite for visual check: v2 mark on white vs original emblem
from PIL import Image as I
mark = render_mark([a[1] for a in ARCS], FIG_L, 240)
orig = I.open("/tmp/emblem-raw.png").convert("RGBA")
ob = orig.getbbox(); orig = orig.crop(ob)
side = max(orig.size)
sq = I.new("RGBA", (side, side), (0,0,0,0))
sq.paste(orig, ((side-orig.size[0])//2, (side-orig.size[1])//2), orig)
sq = sq.resize((240,240), I.LANCZOS)
cmp_c = I.new("RGB", (560, 300), (250,250,248))
cmp_c.paste(sq, (20, 30), sq)
cmp_c.paste(mark, (300, 30), mark)
cmp_c.save("/tmp/mark-compare-v2.png")
# dark check
dk = render_mark([a[2] for a in ARCS], FIG_D, 240)
dark_bg = I.new("RGB", (300, 300), (37,37,37))
dark_bg.paste(dk, (30, 30), dk)
dark_bg.save("/tmp/mark-dark-check.png")
print("comparison images saved")
