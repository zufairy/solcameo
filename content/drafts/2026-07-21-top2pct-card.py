#!/usr/bin/env python3
"""
Vello daily post card — 2026-07-21
Lane: clipper economics (payout distribution / power law)
Recipe: theme-file v2 STAT CARD, gold #FFD700 accent (money topic)
Flow-equivalent [SUBJECT]:
  one huge number "2%" in bold white grotesque type with the unit in gold mono
  type below reading "of clips carry the payout", and beside it a flat bar
  distribution chart of many tiny dim bars with the last two spiking tall in gold
"""
import random
from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 900
BG = (10, 10, 15)
WHITE = (255, 255, 255)
GOLD = (255, 215, 0)
LIME = (195, 240, 0)
LIME_DARK = (140, 178, 0)
GREY = (108, 112, 124)
GREY_DIM = (58, 61, 70)

BLACK_F = "/usr/share/fonts/truetype/lato/Lato-Black.ttf"
BOLD_F = "/usr/share/fonts/truetype/lato/Lato-Bold.ttf"
MONO_F = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# ---------- brand mark: 8-bit pixel bolt + wordmark (top-left) ----------
BOLT = [
    "....####",
    "...####.",
    "..####..",
    ".#######",
    "..#####.",
    "...####.",
    "..####..",
    ".####...",
    "####....",
]
px = 5
bx, by = 72, 56
for r, row in enumerate(BOLT):
    for c, ch in enumerate(row):
        if ch == "#":
            x0, y0 = bx + c * px, by + r * px
            # darker green inner shading on the lower-left half of each pixel run
            col = LIME if (r + c) % 5 != 0 else LIME_DARK
            d.rectangle([x0, y0, x0 + px - 1, y0 + px - 1], fill=col)
# three pixel speed-dashes trailing left
for i, (dy, dw) in enumerate([(2, 3), (4, 4), (6, 2)]):
    y = by + dy * px
    d.rectangle([bx - (dw + 2) * px, y, bx - 2 * px, y + px - 1], fill=LIME_DARK)

# chunky lowercase pixel wordmark "vello"
def pixel_text(draw, text, x, y, scale, color):
    # chunky lowercase pixel glyphs, per-glyph width so spacing stays tight
    GLYPHS = {
        "v": ["##..##", "##..##", "##..##", ".####.", "..##.."],
        "e": [".####.", "##..##", "######", "##....", ".####."],
        "l": ["##", "##", "##", "##", "##"],
        "o": [".####.", "##..##", "##..##", "##..##", ".####."],
    }
    cx = x
    for ch in text:
        g = GLYPHS[ch]
        for r, row in enumerate(g):
            for c, s in enumerate(row):
                if s == "#":
                    draw.rectangle(
                        [cx + c * scale, y + r * scale,
                         cx + (c + 1) * scale - 1, y + (r + 1) * scale - 1],
                        fill=color)
        cx += (len(g[0]) + 1) * scale
    return cx

pixel_text(d, "vello", bx + 62, by + 10, 6, WHITE)

# ---------- headline stat (left) ----------
f_huge = ImageFont.truetype(BLACK_F, 300)
f_unit = ImageFont.truetype(MONO_B, 34)
f_sub = ImageFont.truetype(MONO_F, 26)

d.text((70, 250), "2%", font=f_huge, fill=WHITE)
d.text((78, 566), "of clips carry the payout", font=f_unit, fill=GOLD)
d.text((78, 618), "the other 98% barely clear", font=f_sub, fill=GREY)
d.text((78, 654), "a few hundred verified views", font=f_sub, fill=GREY)

# ---------- distribution chart (right) ----------
chart_x0, chart_x1 = 640, 1460
baseline = 640
n = 44
gap = 5
bw = (chart_x1 - chart_x0 - gap * (n - 1)) / n
random.seed(21)
for i in range(n):
    t = i / (n - 1)
    if i >= n - 1:
        h = 330
        col = GOLD
    elif i >= n - 2:
        h = 205
        col = GOLD
    else:
        # long flat tail with tiny jitter
        h = 8 + (t ** 6) * 70 + random.uniform(0, 6)
        col = GREY_DIM if t < 0.75 else GREY
    x0 = chart_x0 + i * (bw + gap)
    d.rectangle([x0, baseline - h, x0 + bw, baseline], fill=col)

# baseline rule
d.rectangle([chart_x0, baseline + 2, chart_x1, baseline + 3], fill=(38, 40, 48))
d.text((chart_x0, baseline + 26), "one month of clips, sorted by payout",
       font=ImageFont.truetype(MONO_F, 24), fill=GREY)

# ---------- footer ----------
f_foot = ImageFont.truetype(MONO_B, 27)
d.text((70, 780), "42,000 clips / month", font=f_foot, fill=WHITE)
f_gg = ImageFont.truetype(MONO_F, 25)
gg = "vello.gg"
gw = d.textlength(gg, font=f_gg)
d.text((W - 70 - gw, 782), gg, font=f_gg, fill=GREY)

# ---------- film grain ----------
random.seed(7)
pxs = img.load()
for _ in range(120000):
    x = random.randrange(W); y = random.randrange(H)
    r, g, b = pxs[x, y]
    n_ = random.randint(-7, 7)
    pxs[x, y] = (max(0, min(255, r + n_)), max(0, min(255, g + n_)), max(0, min(255, b + n_)))

img.save("/sessions/wonderful-inspiring-pascal/mnt/outputs/vello-top2pct-card.png", "PNG", optimize=True)
print("saved")
