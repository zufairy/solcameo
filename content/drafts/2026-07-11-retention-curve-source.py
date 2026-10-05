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

# base with subtle radial glow
img = Image.new("RGB", (W, H), BG)
px = img.load()
for y in range(H):
    for x in range(0, W, 2):
        dx = (x - W*0.5) / (W*0.9)
        dy = (y - H*0.45) / (H*0.9)
        d = math.sqrt(dx*dx + dy*dy)
        glow = max(0.0, 0.10 - d*0.11)
        r = int(BG[0] + glow*70)
        g = int(BG[1] + glow*90)
        b = int(BG[2] + glow*95)
        px[x, y] = (min(r,30), min(g,40), min(b,46))
        if x+1 < W: px[x+1, y] = px[x, y]

draw = ImageDraw.Draw(img)

def glow_lines(pts, color, width=6, blur=14):
    layer = Image.new("RGBA", (W, H), (0,0,0,0))
    d = ImageDraw.Draw(layer)
    d.line(pts, fill=color+(255,), width=width, joint="curve")
    g = layer.filter(ImageFilter.GaussianBlur(blur))
    base = Image.alpha_composite(img.convert("RGBA"), g)
    d2 = ImageDraw.Draw(base)
    d2.line(pts, fill=color+(255,), width=width, joint="curve")
    return base.convert("RGB")

# ---- lime pixel-art bolt + wordmark (top-left) ----
def draw_bolt(ox, oy, u):
    cells = [
        (4,0),(5,0),
        (3,1),(4,1),
        (2,2),(3,2),
        (0,3),(1,3),(2,3),(3,3),(4,3),(5,3),
        (2,4),(3,4),
        (1,5),(2,5),
        (0,6),(1,6),
    ]
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
    for yy in [oy+u*1.4, oy+u*3.0, oy+u*4.6]:
        d2.line([(ox-u*2.1, yy),(ox-u*0.4, yy)], fill=LIME, width=3)

U = 12
draw_bolt(120, 96, U)
draw = ImageDraw.Draw(img)
draw.text((120+5*U+22, 96+U*1.4), "vello", font=f(MONO_B, 40), fill=(232,236,240))

# ---- chart area ----
cx0, cy0 = 200, 280   # top-left of plot
cx1, cy1 = 1400, 700  # bottom-right of plot

# axes (subtle)
draw.line([(cx0, cy0-20),(cx0, cy1)], fill=(50,54,66), width=2)
draw.line([(cx0, cy1),(cx1+40, cy1)], fill=(50,54,66), width=2)
# axis labels
draw.text((cx0-14, cy0-28), "% still watching", font=f(MONO, 26), fill=MUTE, anchor="ls")
draw.text((cx1+44, cy1+10), "seconds in", font=f(MONO, 26), fill=MUTE, anchor="ra")

# real audience: smooth exponential-ish decay from 100% to ~35%
real_pts = []
for i in range(0, 101):
    t = i/100
    x = cx0 + t*(cx1-cx0)
    yval = math.exp(-1.05*t)          # 1.0 -> 0.35
    y = cy1 - yval*(cy1-cy0)
    real_pts.append((x, y))
img = glow_lines(real_pts, TEAL, width=7, blur=16)

# view farm: flat at 100% then cliff at ~5s mark, flatline near zero
farm_pts = []
cliff = 0.16
for i in range(0, 101):
    t = i/100
    x = cx0 + t*(cx1-cx0)
    if t < cliff:
        yval = 0.985
    elif t < cliff+0.045:
        yval = 0.985 - (t-cliff)/0.045*0.93
    else:
        yval = 0.05
    y = cy1 - yval*(cy1-cy0)
    farm_pts.append((x, y))
img = glow_lines(farm_pts, VIOLET, width=7, blur=16)
draw = ImageDraw.Draw(img)

# curve labels
draw.text((cx1-10, real_pts[100][1]+28), "real audience", font=f(MONO_B, 34), fill=TEAL, anchor="ra")
draw.text((cx0+(cx1-cx0)*cliff+70, cy0+40), "view farm", font=f(MONO_B, 34), fill=VIOLET, anchor="la")

# small gold marker where payout decision happens (on real curve, mid)
mi = 48
mx, my = real_pts[mi]
layer = Image.new("RGBA", (W,H), (0,0,0,0))
dl = ImageDraw.Draw(layer)
dl.ellipse([mx-10, my-10, mx+10, my+10], fill=GOLD+(255,))
gl = layer.filter(ImageFilter.GaussianBlur(12))
img = Image.alpha_composite(img.convert("RGBA"), gl).convert("RGB")
draw = ImageDraw.Draw(img)
draw.ellipse([mx-7, my-7, mx+7, my+7], fill=GOLD)
draw.text((mx+18, my-8), "gets paid", font=f(MONO, 26), fill=GOLD, anchor="lm")

# ---- caption ----
draw.text((200, 770), "RETENTION CURVES DON'T LIE", font=f(MONO_B, 44), fill=(232,236,240), anchor="la")
draw.text((200, 830), "a slope is a human. a cliff is a farm.", font=f(MONO, 30), fill=MUTE, anchor="la")

# bottom-right wordmark
draw.text((W-70, H-56), "vello.gg", font=f(MONO, 30), fill=(90,94,108), anchor="ra")

# ---- film grain ----
random.seed(11)
noise = Image.new("L", (W, H))
npx = noise.load()
for y in range(H):
    for x in range(W):
        npx[x,y] = random.randint(0,255)
noise = noise.filter(ImageFilter.GaussianBlur(0.4))
img = Image.blend(img, Image.merge("RGB",(noise,noise,noise)), 0.035)

# vignette
vig = Image.new("L",(W,H),0)
dv = ImageDraw.Draw(vig)
dv.ellipse([-W*0.25,-H*0.25,W*1.25,H*1.25], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(220))
dark = Image.new("RGB",(W,H),(0,0,0))
img = Image.composite(img, dark, vig)

out = "/sessions/wizardly-bold-gauss/mnt/outputs/vello-retention-card.png"
img.save(out, "PNG")
print("saved", out, img.size)
