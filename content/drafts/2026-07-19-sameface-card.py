"""Vello daily-post image — 2026-07-19 — AI-influencer-meta lane.
Flat editorial card per vello-image-theme.md v2. Violet accent (agents/AI).
Concept: one consistent AI persona repeated across hundreds of posts.
Headline "same face. / 300 posts." + a row of identical pixel-face tiles.
"""
from PIL import Image, ImageDraw, ImageFont
import random

W, H = 1600, 900
BG = (10, 10, 15)
WHITE = (243, 243, 245)
LIME = (195, 240, 0)
LIME_DARK = (140, 175, 0)
VIOLET = (124, 77, 255)
GREY = (120, 122, 132)
DGREY = (60, 62, 72)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# subtle film grain
random.seed(19)
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
# speed dashes left of bolt
for i, yy in enumerate((oy + 6, oy + 18, oy + 30)):
    d.rectangle([ox - 14 - i * 2, yy, ox - 6 - i * 2, yy + 4], fill=LIME_DARK)
# wordmark "vello"
d.text((ox + 5 * p + 16, oy + 6), "vello", font=font(MONO, 34), fill=WHITE)

# ---------- headline ----------
hx = 62
d.text((hx, 250), "same face.", font=font(POP, 150), fill=WHITE)
d.text((hx, 410), "300 posts.", font=font(POP, 150), fill=VIOLET)

# ---------- row of identical persona face tiles ----------
def face_tile(x, y, s, accent, filled_accent=False):
    # rounded square frame
    d.rounded_rectangle([x, y, x + s, y + s], radius=14, outline=accent, width=4,
                        fill=(18, 16, 28) if filled_accent else BG)
    # two eyes (pixel squares)
    ex = s * 0.28; ey = s * 0.36; sz = max(6, s * 0.11)
    for dx in (ex, s - ex - sz):
        d.rectangle([x + dx, y + ey, x + dx + sz, y + ey + sz], fill=accent)
    # mouth line
    mw = s * 0.44
    d.rectangle([x + (s - mw) / 2, y + s * 0.66, x + (s + mw) / 2, y + s * 0.66 + max(5, s * 0.07)], fill=accent)

ts = 96
gap = 34
n = 7
total = n * ts + (n - 1) * gap
startx = hx + 4
ty = 640
for i in range(n):
    x = startx + i * (ts + gap)
    if i == n - 1:
        face_tile(x, ty, ts, LIME, filled_accent=True)  # the minted agent
    else:
        face_tile(x, ty, ts, VIOLET)

# caption under tiles
d.text((hx + 4, ty + ts + 34), "one persona. every platform. every day.",
       font=font(MONOR, 30), fill=GREY)

# corner tag
tag = "vello.gg"
tf = font(MONO, 26)
bb = d.textbbox((0, 0), tag, font=tf)
d.text((W - 60 - (bb[2] - bb[0]), H - 60), tag, font=tf, fill=DGREY)

out = "/sessions/ecstatic-optimistic-ptolemy/mnt/outputs/vello-sameface-card.png"
img.save(out, "PNG")
print("saved", out, img.size)
