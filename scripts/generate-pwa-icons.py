#!/usr/bin/env python3
"""Generate ServiceOS PWA icons (audit PWA-01): navy rounded square with a
white lightning-bolt mark — matching the console BootSplash/wordmark style."""
from PIL import Image, ImageDraw
import os

OUT = "/home/z/my-project/public"
NAVY = (11, 31, 51, 255)
WHITE = (255, 255, 255, 255)
STEEL = (125, 160, 190, 255)


def rounded(draw: ImageDraw.ImageDraw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def bolt_points(cx, cy, s):
    """Lightning bolt as a 7-point polygon scaled by s."""
    pts = [
        (0.05, 0.00), (0.55, 0.00), (0.30, 0.38), (0.62, 0.38),
        (0.10, 1.00), (0.28, 0.52), (-0.04, 0.52),
    ]
    return [(cx + px * s, cy + py * s) for px, py in pts]


def make_icon(size: int, maskable: bool = False, path: str = "icon.png"):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if maskable:
        # Maskable: full-bleed background, artwork inside the 80% safe zone.
        draw.rectangle([0, 0, size, size], fill=NAVY)
        margin = int(size * 0.10)
        inner = size - 2 * margin
        # Bolt within safe zone
        cx, cy = size / 2, size / 2
        s = inner * 0.78
        draw.polygon(bolt_points(cx - s * 0.28, cy, s), fill=WHITE)
        draw.polygon(bolt_points(cx + s * 0.30, cy, s * 0.36), fill=STEEL)
    else:
        radius = int(size * 0.22)
        rounded(draw, [0, 0, size, size], radius, NAVY)
        cx, cy = size / 2, size / 2
        s = size * 0.62
        draw.polygon(bolt_points(cx - s * 0.28, cy, s), fill=WHITE)
        draw.polygon(bolt_points(cx + s * 0.30, cy, s * 0.36), fill=STEEL)
    img.save(os.path.join(OUT, path), "PNG")
    print("wrote", path, size)


os.makedirs(OUT, exist_ok=True)
make_icon(192, False, "icon-192.png")
make_icon(512, False, "icon-512.png")
make_icon(512, True, "icon-512-maskable.png")
make_icon(180, False, "apple-touch-icon.png")
# Favicon (opaque navy square, no alpha complications)
img = Image.new("RGB", (64, 64), NAVY[:3])
draw = ImageDraw.Draw(img)
draw.polygon(bolt_points(32 - 10, 32, 40), fill=(255, 255, 255))
draw.polygon(bolt_points(32 + 11, 32, 14), fill=(125, 160, 190))
img.save(os.path.join(OUT, "favicon-64.png"), "PNG")
print("wrote favicon-64.png")
