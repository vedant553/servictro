#!/usr/bin/env python3
"""Servictro brand assets from the uploaded logo (upload/Modern SERVICTRO Gear Logo.png).

Produces:
  public/icon-192.png / icon-512.png / icon-512-maskable.png  (PWA manifest)
  public/apple-touch-icon.png / favicon-64.png                (browser/apple)
  public/logo-mark.png    — gear mark on a rounded white tile, transparent
                            corners (login panel + sidebar brand)
  public/logo-lockup.png  — full logo on transparent bg (README/future use)
The gear mark is auto-located: non-white pixels in the left 40% of the source
(icon region), then centered with the brand's white background.
"""
from PIL import Image, ImageDraw, ImageOps
import os

SRC = "/home/z/my-project/upload/Modern SERVICTRO Gear Logo.png"
OUT = "/home/z/my-project/public"
os.makedirs(OUT, exist_ok=True)

src = Image.open(SRC).convert("RGBA")
W, H = src.size

# --- locate the gear mark (scan for the white gap between mark & wordmark) --
region_full = src.crop((0, 0, int(W * 0.55), H))
gray = ImageOps.grayscale(region_full)
mask = gray.point(lambda p: 255 if p < 245 else 0)
w_, h_ = mask.size
cols = [sum(mask.getpixel((x, y)) > 0 for y in range(0, h_, 2)) for x in range(w_)]
# first fully-empty column band of >=15px after the gear starts = mark boundary
# (the mark/wordmark gap in the source logo is only ~20px wide)
boundary = w_
run = 0
for x in range(200, w_):
    run = run + 1 if cols[x] == 0 else 0
    if run >= 15:
        boundary = x - run + 1
        break
region = src.crop((0, 0, boundary, H))
gray = ImageOps.grayscale(region)
mask = gray.point(lambda p: 255 if p < 245 else 0)
bbox = mask.getbbox()
assert bbox, "gear mark not found"
left, top, right, bottom = bbox
pad = int((right - left) * 0.06)
left, top = max(0, left - pad), max(0, top - pad)
right, bottom = min(region.width, right + pad), min(region.height, bottom + pad)
mark = region.crop((left, top, right, bottom))

# square canvas, mark centered
side = max(mark.size)
square = Image.new("RGBA", (side, side), (255, 255, 255, 0))
square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2), mark)
mark_sq = square

def paste_center(canvas: Image.Image, art: Image.Image, frac: float) -> None:
    s = int(canvas.width * frac)
    a = art.resize((s, s), Image.LANCZOS)
    canvas.paste(a, ((canvas.width - s) // 2, (canvas.height - s) // 2), a)

# --- PWA / browser icons: white background (brand's natural background) ----
for size, name in [(192, "icon-192.png"), (512, "icon-512.png"),
                   (180, "apple-touch-icon.png"), (64, "favicon-64.png")]:
    img = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    paste_center(img, mark_sq, 0.78 if size != 64 else 0.94)
    img.convert("RGB").save(os.path.join(OUT, name))

# maskable: full-bleed white bg, artwork inside the 80% safe zone
m = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
paste_center(m, mark_sq, 0.62)
m.convert("RGB").save(os.path.join(OUT, "icon-512-maskable.png"))

# --- UI mark: rounded white tile + gear, transparent corners ---------------
tile = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(tile)
d.rounded_rectangle([0, 0, 511, 511], radius=96, fill=(255, 255, 255, 255))
paste_center(tile, mark_sq, 0.82)
tile.save(os.path.join(OUT, "logo-mark.png"))

# --- full lockup, white made transparent (for dark/printed contexts) -------
full = src.copy()
px = full.load()
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if r > 246 and g > 246 and b > 246:
            px[x, y] = (r, g, b, 0)
full.save(os.path.join(OUT, "logo-lockup.png"))

print("mark bbox:", bbox, "| side:", side)
for n in ["icon-192.png", "icon-512.png", "icon-512-maskable.png",
          "apple-touch-icon.png", "favicon-64.png", "logo-mark.png", "logo-lockup.png"]:
    p = os.path.join(OUT, n)
    print(n, os.path.getsize(p), "bytes")
