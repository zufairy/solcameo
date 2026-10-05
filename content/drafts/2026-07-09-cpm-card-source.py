from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random, math

W, H = 1600, 900
BG = (10, 10, 15)
TEAL = (0, 255, 209)
VIOLET = (124, 77, 255)
GOLD = (255, 215, 0)
LIME = (195, 240, 0)
MUTE = (120, 124, 140)

SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

def f(path, s): return ImageFont.truetype(path, s)

# base with subtle vertical gradient + radial vignette glow
img = Image.new("RGB", (W, H), BG)
px = img.load()
for y in range(H):
    for x in range(0, W, 2):
        # radial distance from an off-center light source top-left-ish
        dx = (x - W*0.34) / (W*0.9)
        dy = (y - H*0.42) / (H*0.9)
        d = math.sqrt(dx*dx + dy*dy)
        glow = max(0.0, 0.10 - d*0.11)
        r = int(BG[0] + glow*70)
        g = int(BG[1] + glow*90)
        b = int(BG[2] + glow*95)
        px[x, y] = (min(r,30), min(g,40), min(b,46))
        if x+1 < W: px[x+1, y] = px[x, y]

draw = ImageDraw.Draw(img)

# ---- glow helper: draw text onto a layer, blur, composite ----
def glow_text(xy, text, font, color, blur=18, passes=2, anchor="la"):
    layer = Image.new("RGBA", (W, H), (0,0,0,0))
    d = ImageDraw.Draw(layer)
    d.text(xy, text, font=font, fill=color+(255,), anchor=anchor)
    g = layer.filter(ImageFilter.GaussianBlur(blur))
    for _ in range(passes):
        img.paste(Image.alpha_composite(img.convert("RGBA"), g).convert("RGB"), (0,0))

# ---- lime pixel-art lightning bolt (blocky) ----
def draw_bolt(ox, oy, u):
    # bolt described on a grid of unit cells; classic lightning shape
    cells = [
        (4,0),(5,0),
        (3,1),(4,1),
        (2,2),(3,2),
        (0,3),(1,3),(2,3),(3,3),(4,3),(5,3),
        (2,4),(3,4),
        (1,5),(2,5),
        (0,6),(1,6),
    ]
    # glow underlay
    layer = Image.new("RGBA", (W,H), (0,0,0,0))
    dl = ImageDraw.Draw(layer)
    for (cx, cy) in cells:
        x0 = ox + cx*u; y0 = oy + cy*u
        dl.rectangle([x0, y0, x0+u-1, y0+u-1], fill=LIME+(255,))
    gl = layer.filter(ImageFilter.GaussianBlur(10))
    img.paste(Image.alpha_composite(img.convert("RGBA"), gl).convert("RGB"), (0,0))
    d2 = ImageDraw.Draw(img)
    for (cx, cy) in cells:
        x0 = ox + cx*u; y0 = oy + cy*u
        d2.rectangle([x0, y0, x0+u-1, y0+u-1], fill=LIME, outline=(8,10,6), width=2)
    # motion streak lines trailing left
    for i,(yy) in enumerate([oy+u*1.4, oy+u*3.0, oy+u*4.6]):
        d2.line([(ox-u*2.1, yy),(ox-u*0.4, yy)], fill=LIME, width=3)

U = 12
draw_bolt(120, 96, U)
draw = ImageDraw.Draw(img)
draw.text((120+5*U+22, 96+U*1.4), "vello", font=f(MONO_B, 40), fill=(232,236,240))

# ---- main stat ----
num_font = f(SANS_B, 210)
# glow behind number
glow_text((150, 400), "$10", num_font, GOLD, blur=26, passes=1, anchor="lm")
draw = ImageDraw.Draw(img)
# measure $10 width
w10 = draw.textlength("$10", font=num_font)
arrow_font = f(SANS_B, 150)
draw.text((150, 400), "$10", font=num_font, fill=(150,140,90), anchor="lm")  # dimmed = the mirage price
ax = 150 + w10 + 40
draw.text((ax, 388), "→", font=arrow_font, fill=TEAL, anchor="lm")
warrow = draw.textlength("→", font=arrow_font)
gx = ax + warrow + 40
glow_text((gx, 400), "$20", num_font, GOLD, blur=22, passes=1, anchor="lm")
draw = ImageDraw.Draw(img)
draw.text((gx, 400), "$20", font=num_font, fill=GOLD, anchor="lm")

# teal underline accent under the whole number row
row_right = gx + draw.textlength("$20", font=num_font)
uy = 400 + 130
draw.line([(154, uy),(row_right, uy)], fill=TEAL, width=6)

# caption
cap_font = f(MONO, 44)
def spaced(s, n=4): return (" "*1).join(s)  # keep readable, mild spacing via tracking below
cap = "real cost per 1,000 views"
draw.text((156, uy+40), cap.upper(), font=f(MONO, 40), fill=TEAL, anchor="la")
sub = "after the phantom half bounces"
draw.text((156, uy+98), sub, font=f(MONO, 30), fill=MUTE, anchor="la")

# bottom-right wordmark
draw.text((W-70, H-56), "vello.gg", font=f(MONO, 30), fill=(90,94,108), anchor="ra")

# ---- film grain ----
random.seed(7)
noise = Image.new("L", (W, H))
npx = noise.load()
for y in range(H):
    for x in range(W):
        npx[x,y] = random.randint(0,255)
noise = noise.filter(ImageFilter.GaussianBlur(0.4))
img = Image.blend(img, Image.merge("RGB",(noise,noise,noise)), 0.035)

# subtle vignette darkening at edges
vig = Image.new("L",(W,H),0)
dv = ImageDraw.Draw(vig)
dv.ellipse([-W*0.25,-H*0.25,W*1.25,H*1.25], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(220))
dark = Image.new("RGB",(W,H),(0,0,0))
img = Image.composite(img, dark, vig)

out = "/sessions/pensive-intelligent-babbage/mnt/outputs/vello-cpm-card.png"
img.save(out, "PNG")
print("saved", out, img.size)
