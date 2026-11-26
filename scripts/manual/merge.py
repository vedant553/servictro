#!/usr/bin/env python3
"""Merge cover.pdf + body.pdf into the final Servictro User Manual."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

def normalize(page):
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page

writer = PdfWriter()
writer.add_page(normalize(PdfReader("cover.pdf").pages[0]))
for p in PdfReader("body.pdf").pages:
    writer.add_page(normalize(p))
writer.add_metadata({
    "/Title": "Servictro User Manual",
    "/Author": "Z.ai",
    "/Creator": "Z.ai",
    "/Subject": "Complete user manual for the Servictro after-sales service and asset operations platform",
})
out = "/home/z/my-project/download/Servictro_User_Manual.pdf"
with open(out, "wb") as f:
    writer.write(f)
print("pages:", len(writer.pages), "->", out)
