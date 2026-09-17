#!/usr/bin/env python3
"""Crop candidate regions from the logo and save for visual inspection."""
from PIL import Image

SRC = "/home/z/my-project/upload/pasted_image_1789198732211.png"
img = Image.open(SRC).convert("RGBA")
W, H = img.size

crops = {
    "/tmp/crop-left.png": (0, 0, 745, H),        # left portion (text?)
    "/tmp/crop-right.png": (735, 0, W, H),        # right portion (illustration?)
    "/tmp/crop-bottom-left.png": (0, 650, 745, H),  # bottom-left (GROUPS/tagline?)
    "/tmp/crop-top-left.png": (0, 0, 745, 680),    # top-left (DRONA word?)
}
for path, box in crops.items():
    img.crop(box).save(path)
    print(f"saved {path} box={box}")
