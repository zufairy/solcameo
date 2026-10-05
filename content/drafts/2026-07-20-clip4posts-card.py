"""Vello daily-post image — 2026-07-20 — AGENT-INFRA / DISTRIBUTION lane (auto-posting).
Flat editorial card per vello-image-theme.md v2. Teal accent (product/infra).
Concept: one clip is not one post; it fans out to 4 platforms, daily = 120/mo.
Headline "1 clip." / "4 posts." + a row of 4 platform tiles + math caption.
"""
from PIL import Image, ImageDraw, ImageFont
import random

W, H = 1600, 900
BG = (10, 10, 15)
WHITE = (243, 243, 245)
LIME = (195, 240, 0)
LIME_DARK = (140, 175, 0)
TEAL = (0, 255, 209)
GREY = (120, 122, 132)
DGREY = (60, 62, 72)
TILEBG = (12, 24, 22)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# subtle film grain
random.seed(20)
px = img.load()
for _ in range(46000):
    x = random.randint(0, W - 1); y = random.randint(0, H - 1)
    r, g, b = px[x, y]
    n = random.randint(-8, 8)
    px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))

def font(path, size):
    return ImageFont.truetype(path, size)

POP = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
MONOR = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

# ---------- logo: 8-bit pixel bolt + wordmark (top-left) ----------
bolt = [
    "...XX",
    "..XX.",
    ".XX..",
    "XXXXX",
    "..XX.",
    ".XX..",
    ".X...",
]
p = 7
ox, oy = 60, 58
for r, row in enumerate(bolt):
    for c, ch in enumerate(row):
        if ch == "X":
            x0 = ox + c * p; y0 = oy + r * p
            col = LIME_DARK if (r in (3,) and c in (1, 3)) else LIME
            d.rectangle([x0, y0, x0 + p - 1, y0 + p - 1], fill=col)
for i, yy in enumerate((oy + 6, oy + 18, oy + 30)):
    d.rectangle([ox - 14 - i * 2, yy, ox - 6 - i * 2, yy + 4], fill=LIME_DARK)
d.text((ox + 5 * p + 16, oy + 6), "vello", font=font(MONO, 34), fill=WHITE)

# ---------- headline ----------
hx = 62
d.text((hx, 236), "1 clip.", font=font(POP, 150), fill=WHITE)
d.text((hx, 396), "4 posts.", font=font(POP, 150), fill=TEAL)

# ---------- row of 4 platform tiles ----------
def plat_tile(x, y, s, label):
    d.rounded_rectangle([x, y, x + s, y + s], radius=16, outline=TEAL, width=4, fill=TILEBG)
    lf = font(MONO, 40)
    bb = d.textbbox((0, 0), label, font=lf)
    tw = bb[2] - bb[0]; th = bb[3] - bb[1]
    d.text((x + (s - tw) / 2 - bb[0], y + (s - th) / 2 - bb[1]), label, font=lf, fill=TEAL)

ts = 108
gap = 40
labels = ["tt", "ig", "yt", "x"]
startx = hx + 6
ty = 632
# thin connector line from headline down into the tiles row
for i, lab in enumerate(labels):
    x = startx + i * (ts + gap)
    plat_tile(x, ty, ts, lab)

# caption under tiles (the math)
d.text((hx + 6, ty + ts + 40), "x 30 days  =  120 posts / month, per account",
       font=font(MONOR, 32), fill=GREY)

# corner tag
tag = "vello.gg"
tf = font(MONO, 26)
bb = d.textbbox((0, 0), tag, font=tf)
d.text((W - 60 - (bb[2] - bb[0]), H - 60), tag, font=tf, fill=DGREY)

out = "/sessions/eager-nifty-galileo/mnt/outputs/vello-clip4posts-card.png"
img.save(out, "PNG")
print("saved", out, img.size)
