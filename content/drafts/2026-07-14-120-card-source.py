from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random, math

W, H = 1600, 900
BG = (10, 10, 15)
TEAL = (0, 255, 209)
LIME = (195, 240, 0)
MUTE = (120, 124, 140)
WHITE = (240, 243, 246)

SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

def f(path, s): return ImageFont.truetype(path, s)

# base with very subtle radial glow
img = Image.new("RGB", (W, H), BG)
px = img.load()
for y in range(H):
    for x in range(0, W, 2):
        dx = (x - W*0.5) / (W*0.9)
        dy = (y - H*0.42) / (H*0.9)
        d = math.sqrt(dx*dx + dy*dy)
        glow = max(0.0, 0.10 - d*0.11)
        r = int(BG[0] + glow*60)
        g = int(BG[1] + glow*80)
        b = int(BG[2] + glow*85)
        px[x, y] = (min(r,28), min(g,38), min(b,44))
        if x+1 < W: px[x+1, y] = px[x, y]

draw = ImageDraw.Draw(img)

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
    shade = [(3,3),(2,4),(1,5)]  # darker green inner shading cells
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
        col = (140, 175, 0) if (cx, cy) in shade else LIME
        d2.rectangle([x0, y0, x0+u-1, y0+u-1], fill=col, outline=(8,10,6), width=2)
    for yy in [oy+u*1.4, oy+u*3.0, oy+u*4.6]:
        d2.line([(ox-u*2.1, yy),(ox-u*0.4, yy)], fill=LIME, width=3)

U = 12
draw_bolt(120, 96, U)
draw = ImageDraw.Draw(img)
draw.text((120+5*U+22, 96+U*1.4), "vello", font=f(MONO_B, 40), fill=WHITE)

# ---- huge $120 ----
big = f(SANS_B, 330)
cxn, cyn = W//2, 440
draw.text((cxn, cyn), "$120", font=big, fill=WHITE, anchor="mm")

# pixel-glitch displacement on the right edge of the number
bbox = draw.textbbox((cxn, cyn), "$120", font=big, anchor="mm")
random.seed(14)
gx0 = int(bbox[0] + (bbox[2]-bbox[0])*0.62)
for _ in range(14):
    sy = random.randint(bbox[1], bbox[3]-16)
    sh = random.choice([8, 10, 14, 18])
    sx = random.randint(gx0, bbox[2]-30)
    sw = random.randint(30, 110)
    off = random.choice([-18, -12, 12, 18, 24])
    slice_ = img.crop((sx, sy, sx+sw, sy+sh))
    img.paste(slice_, (sx+off, sy))
draw = ImageDraw.Draw(img)

# ---- teal audit line striking through ----
ly = cyn + 6
layer = Image.new("RGBA", (W,H), (0,0,0,0))
dl = ImageDraw.Draw(layer)
dl.line([(190, ly), (W-190, ly)], fill=TEAL+(255,), width=8)
gl = layer.filter(ImageFilter.GaussianBlur(14))
img = Image.alpha_composite(img.convert("RGBA"), gl).convert("RGB")
draw = ImageDraw.Draw(img)
draw.line([(190, ly), (W-190, ly)], fill=TEAL, width=7)

# ---- labels: "displayed" struck grey · "verified" lime ----
lab_y = 690
fd = f(MONO_B, 58)
w1 = draw.textlength("displayed", font=fd)
w2 = draw.textlength("verified", font=fd)
gap = 70
total = w1 + gap + w2
x1 = (W - total) / 2
draw.text((x1, lab_y), "displayed", font=fd, fill=(110, 114, 128), anchor="lm")
draw.line([(x1-8, lab_y+2), (x1+w1+8, lab_y+2)], fill=(110,114,128), width=5)
x2 = x1 + w1 + gap
layer = Image.new("RGBA", (W,H), (0,0,0,0))
dl = ImageDraw.Draw(layer)
dl.text((x2, lab_y), "verified", font=fd, fill=LIME+(255,), anchor="lm")
gl = layer.filter(ImageFilter.GaussianBlur(12))
img = Image.alpha_composite(img.convert("RGBA"), gl).convert("RGB")
draw = ImageDraw.Draw(img)
draw.text((x2, lab_y), "verified", font=fd, fill=LIME, anchor="lm")

# ---- film grain ----
random.seed(11)
noise = Image.new("L", (W, H))
npx = noise.load()
for y in range(H):
    for x in range(W):
        npx[x,y] = random.randint(0,255)
noise = noise.filter(ImageFilter.GaussianBlur(0.4))
img = Image.blend(img, Image.merge("RGB",(noise,noise,noise)), 0.03)

# vignette
vig = Image.new("L",(W,H),0)
dv = ImageDraw.Draw(vig)
dv.ellipse([-W*0.25,-H*0.25,W*1.25,H*1.25], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(220))
dark = Image.new("RGB",(W,H),(0,0,0))
img = Image.composite(img, dark, vig)

out = "/sessions/wonderful-busy-goldberg/mnt/outputs/vello-120-card.png"
img.save(out, "PNG")
print("saved", out, img.size)
