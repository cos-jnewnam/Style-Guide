"""Draws the extension icons. Run from the repo root: python3 tools/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

NAVY = (23, 50, 77, 255)
WHITE = (255, 255, 255, 255)
AMBER = (245, 158, 11, 255)

out = Path(__file__).resolve().parent.parent / "extension" / "icons"
out.mkdir(parents=True, exist_ok=True)

for size in (16, 32, 48, 128):
    scale = 8
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.2), fill=NAVY)
    # check mark
    w = max(2, int(s * 0.12))
    pts = [(s * 0.24, s * 0.52), (s * 0.43, s * 0.70), (s * 0.77, s * 0.30)]
    d.line(pts, fill=WHITE, width=w, joint="curve")
    for x, y in (pts[0], pts[2]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=WHITE)
    # amber underline, like a highlight
    d.rounded_rectangle([s * 0.2, s * 0.80, s * 0.8, s * 0.80 + max(2, int(s * 0.07))], radius=int(s * 0.03), fill=AMBER)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(out / f"icon-{size}.png")
print("icons written to", out)
