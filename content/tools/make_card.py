#!/usr/bin/env python3
"""Vello X post card generator.
Usage:
  python3 make_card.py --hook "Clipping pays $1-3 per 1,000 verified views" \
      --stat "$3/1K" --sub "verified views, paid from the bounty pool" \
      --out card.png [--kicker "BUILD IN PUBLIC · DAY 12"]
Dark 1600x900 card, big hook, optional green stat, vello.gg footer.
"""
import argparse, textwrap
from PIL import Image, ImageDraw, ImageFont

BG = (10, 10, 12)
FG = (245, 245, 245)
MUT = (140, 140, 148)
ACC = (52, 211, 153)   # green — money color
LINE = (38, 38, 44)

def font(size, bold=True):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hook", required=True)
    ap.add_argument("--stat", default="")
    ap.add_argument("--sub", default="")
    ap.add_argument("--kicker", default="VELLO · BUILD IN PUBLIC")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    W, H = 1600, 900
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    M = 100

    d.text((M, 80), a.kicker.upper(), font=font(30), fill=ACC)
    d.line([(M, 140), (M + 120, 140)], fill=ACC, width=4)

    hook_size = 76 if len(a.hook) < 90 else 62
    wrapped = textwrap.fill(a.hook, width=32 if hook_size == 76 else 38)
    d.multiline_text((M, 200), wrapped, font=font(hook_size), fill=FG, spacing=18)

    y = 200 + (wrapped.count("\n") + 1) * (hook_size + 18) + 50
    if a.stat:
        d.text((M, y), a.stat, font=font(110), fill=ACC)
        if a.sub:
            d.text((M, y + 130), a.sub, font=font(34, bold=False), fill=MUT)

    d.line([(M, H - 130), (W - M, H - 130)], fill=LINE, width=2)
    d.text((M, H - 100), "vello.gg", font=font(40), fill=FG)
    d.text((W - M - 520, H - 96), "free 30 days · no card", font=font(32, bold=False), fill=MUT)

    img.save(a.out)
    print(f"saved {a.out}")

if __name__ == "__main__":
    main()
