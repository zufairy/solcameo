"""Rendering primitives for the Vello film: eyes, noise, text, post-FX."""
import numpy as np, json
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage
from functools import lru_cache

W, H = 1920, 1080
FPS = 30
LIME = np.array([195, 240, 0]) / 255.0
RED = np.array([235, 20, 30]) / 255.0
BG = np.array([10, 10, 15]) / 255.0
FONTS = '/home/claude/film/fonts/'
TL = {x['id']: x for x in json.load(open('/home/claude/film/timeline_t.json'))}
def T(i): return TL[i]['start']
def E(i): return TL[i]['start'] + TL[i]['dur']

@lru_cache(None)
def F(name, size):
    p = {'anton': 'Anton-Regular.ttf', 'grot': 'SpaceGrotesk-Medium.ttf', 'archivo': 'ArchivoBlack-Regular.ttf',
         'serif': 'Fraunces-SemiBold.ttf', 'bebas': 'BebasNeue-Regular.ttf'}.get(name)
    if p: return ImageFont.truetype(FONTS + p, size)
    return ImageFont.truetype({'mono': '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
                               'monor': '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'}[name], size)

def clamp01(x): return np.clip(x, 0, 1)
def ease(x): x = clamp01(x); return x * x * (3 - 2 * x)
def eout(x): x = clamp01(x); return 1 - (1 - x) ** 3
def ein(x): x = clamp01(x); return x ** 3
def seg(t, a, b): return clamp01((t - a) / max(1e-6, b - a))

# ------------------------------------------------------------------ noise
_rng = np.random.default_rng(3)
def value_noise(h, w, scale, seed=0):
    r = np.random.default_rng(seed)
    g = r.random((h // scale + 3, w // scale + 3)).astype(np.float32)
    z = ndimage.zoom(g, scale, order=3)[:h, :w]
    return z
GRAIN = [(_rng.standard_normal((H // 2, W // 2)).astype(np.float32)) for _ in range(6)]
GRAIN = [np.repeat(np.repeat(g, 2, 0), 2, 1) for g in GRAIN]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
NX, NY = (xx - W / 2) / (H / 2), (yy - H / 2) / (H / 2)
RAD = np.sqrt(NX ** 2 + NY ** 2)
ANG = np.arctan2(NY, NX)
VIGNETTE = clamp01(1.12 - 0.3 * RAD ** 2)[..., None]
SCAN = (1 - 0.18 * ((np.arange(H) % 3) == 0))[:, None, None].astype(np.float32)
FOG = [value_noise(H, W, 240, s) for s in range(3)]

# ------------------------------------------------------------------ eyes
_VEINS = None
def _veins(n=256):
    global _VEINS
    if _VEINS is None:
        v = np.zeros((n, n), np.float32)
        for s in range(3):
            nz = value_noise(n, n, 16 + 8 * s, 50 + s) - 0.5
            v += np.exp(-(nz / 0.012) ** 2) * (0.8 - 0.2 * s)
        _VEINS = v
    return _VEINS

@lru_cache(maxsize=4096)
def eye_sprite(w, open_q, lx_q, ly_q, col, pupil_q=4, blood=0.6):
    """RGBA sprite of an eye, width w px. open_q 0..12, look quantized -3..3, col: 'brown'|'red'|'lime'|'pale'."""
    h = int(w * 0.62)
    op = open_q / 12.0
    lx, ly = lx_q / 3.0, ly_q / 3.0
    v, u = np.mgrid[0:h, 0:w].astype(np.float32)
    u = (u - w / 2) / (w / 2); v = (v - h / 2) / (w / 2)
    lid = op * 0.52 * np.clip(1 - u ** 2, 0, 1) ** 0.75
    inside = np.abs(v) < lid
    edge = clamp01((lid - np.abs(v)) * w * 0.25)
    # sclera
    sc = np.array([0.93, 0.89, 0.82], np.float32) * (1 - 0.45 * u ** 2)[..., None]
    vn = ndimage.zoom(_veins(), (h / 256, w / 256), order=1)[:h, :w]
    veinw = vn * blood * clamp01(np.abs(u) * 1.4 - 0.15)
    sc = sc * (1 - veinw[..., None]) + np.array([0.75, 0.05, 0.05]) * veinw[..., None]
    # iris
    cx, cy = lx * 0.42, ly * 0.14
    ir = 0.40
    du, dv = u - cx, v - cy
    d = np.sqrt(du ** 2 + dv ** 2) / ir
    a = np.arctan2(dv, du)
    fib = 0.55 + 0.45 * np.sin(a * 37 + np.sin(a * 11) * 2) * np.sin(a * 23 + d * 6)
    base = {'brown': (0.45, 0.25, 0.08), 'red': (0.95, 0.06, 0.05), 'lime': (0.77, 0.95, 0.0),
            'pale': (0.55, 0.65, 0.7), 'black': (0.05, 0.05, 0.05)}[col]
    iris = np.array(base, np.float32)[None, None] * (0.45 + 0.75 * fib[..., None]) * (1.25 - 0.6 * d[..., None])
    iris = iris * (1 - 0.8 * clamp01((d - 0.85) * 7))[..., None]
    pr = 0.28 + 0.07 * pupil_q
    if col in ('red', 'lime'):
        pupil = (du / (ir * pr * 0.32)) ** 2 + (dv / (ir * pr * 1.5)) ** 2 < 1
    else:
        pupil = d < pr
    col_ = np.where((d < 1)[..., None], iris, sc)
    col_ = np.where(pupil[..., None], 0.01, col_)
    # glow for red/lime
    if col in ('red', 'lime'):
        col_ = col_ + np.array(base)[None, None] * np.exp(-((d - 0.6) ** 2) / 0.08)[..., None] * 0.35 * (d < 1)[..., None]
    # highlight
    hd = np.sqrt((du + 0.12) ** 2 + (dv + 0.12) ** 2)
    col_ = col_ + (hd < 0.07)[..., None] * 0.9
    # lid shading (upper lid shadow)
    shade = clamp01(1 - clamp01((v + lid) / (0.25 + 1e-3)) * 0) * (1 - 0.6 * clamp01(1 - (v + lid) * 4))
    col_ = col_ * shade[..., None]
    alpha = edge * inside
    # lid rim (dark skin line)
    rim = clamp01(1 - np.abs(np.abs(v) - lid) * w * 0.12) * (np.abs(u) < 1) * (op > 0.02)
    out = np.dstack([clamp01(col_), alpha])
    out[..., :3] = out[..., :3] * (1 - rim[..., None]) + 0.02 * rim[..., None]
    out[..., 3] = np.maximum(out[..., 3], rim * 0.95)
    return out.astype(np.float32)

def eye(w, open_, lx=0, ly=0, col='brown', pupil=4, blood=0.6):
    return eye_sprite(int(w), int(round(clamp01(open_) * 12)), int(round(np.clip(lx, -1, 1) * 3)),
                      int(round(np.clip(ly, -1, 1) * 3)), col, int(pupil), blood)

def blit(canvas, sprite, cx, cy, alpha=1.0, add=False):
    """Alpha-composite an RGBA float sprite onto float canvas centered at (cx,cy)."""
    h, w = sprite.shape[:2]
    x0, y0 = int(cx - w / 2), int(cy - h / 2)
    x1, y1 = x0 + w, y0 + h
    sx0, sy0 = max(0, -x0), max(0, -y0)
    X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(canvas.shape[1], x1), min(canvas.shape[0], y1)
    if X1 <= X0 or Y1 <= Y0: return
    s = sprite[sy0:sy0 + (Y1 - Y0), sx0:sx0 + (X1 - X0)]
    a = s[..., 3:4] * alpha
    if add: canvas[Y0:Y1, X0:X1] += s[..., :3] * a
    else: canvas[Y0:Y1, X0:X1] = canvas[Y0:Y1, X0:X1] * (1 - a) + s[..., :3] * a

# ------------------------------------------------------------------ text layers
def text_layer(lines, font, size, fill=(255, 255, 255), spacing=0.95, align='center', tracking=0, stroke=0, stroke_fill=(0, 0, 0)):
    """Return RGBA float sprite of (multi-line) text."""
    f = F(font, size)
    if isinstance(lines, str): lines = lines.split('\n')
    bbs = [f.getbbox(l, stroke_width=stroke) for l in lines]
    ws = [b[2] - b[0] + tracking * max(0, len(l) - 1) for b, l in zip(bbs, lines)]
    lh = int(size * spacing)
    Wt, Ht = max(ws) + 20 + stroke * 2, lh * len(lines) + int(size * 0.35) + stroke * 2
    im = Image.new('RGBA', (Wt, Ht), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for i, l in enumerate(lines):
        x = 10 + (Wt - 20 - ws[i]) // 2 if align == 'center' else 10
        y = i * lh - bbs[i][1] + int(size * 0.12) + stroke
        if tracking:
            for ch in l:
                d.text((x, y), ch, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
                x += f.getlength(ch) + tracking
        else:
            d.text((x, y), l, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
    return np.asarray(im).astype(np.float32) / 255.0

_tcache = {}
def TXT(key, *a, **k):
    kk = (key, a, tuple(sorted(k.items())))
    if kk not in _tcache: _tcache[kk] = text_layer(*a, **k)
    return _tcache[kk]

def scale_sprite(sp, s):
    if abs(s - 1) < 1e-3: return sp
    h, w = sp.shape[:2]
    nh, nw = max(1, int(h * s)), max(1, int(w * s))
    im = Image.fromarray((clamp01(sp) * 255).astype(np.uint8), 'RGBA').resize((nw, nh), Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255.0

def tint(sp, rgb):
    o = sp.copy(); o[..., :3] = np.asarray(rgb, np.float32)[None, None] * (sp[..., :3].mean(-1, keepdims=True) > -1); return o

def rgb_split_sprite(sp, k):
    o = np.zeros_like(sp)
    o[..., 0] = np.roll(sp[..., 0] * sp[..., 3], -k, 1); o[..., 1] = sp[..., 1] * sp[..., 3]; o[..., 2] = np.roll(sp[..., 2] * sp[..., 3], k, 1)
    o[..., 3] = np.maximum(np.maximum(np.roll(sp[..., 3], -k, 1), sp[..., 3]), np.roll(sp[..., 3], k, 1))
    a = o[..., 3:4]; o[..., :3] = np.where(a > 1e-4, o[..., :3] / np.maximum(a, 1e-4), 0)
    return o

def slice_glitch(img, amount, seed, bands=12, maxshift=120):
    if amount <= 0: return img
    r = np.random.default_rng(seed)
    out = img.copy(); h = img.shape[0]
    for _ in range(int(bands * amount) + 1):
        y0 = r.integers(0, h); hh = r.integers(4, max(6, int(h * 0.08)))
        sh = int(r.normal(0, maxshift * amount))
        out[y0:y0 + hh] = np.roll(img[y0:y0 + hh], sh, 1)
    return out

def drip(sp, t, seed=1, maxlen=300):
    """Melt a sprite downward: each column slides by a different amount."""
    h, w = sp.shape[:2]
    r = np.random.default_rng(seed)
    speeds = ndimage.gaussian_filter1d(r.random(w) ** 3, 3) * 3 + 0.05
    shift = (speeds * maxlen * t).astype(int)
    out = np.zeros((h + maxlen * 2, w, 4), np.float32)
    out[:h] = sp
    idx = np.arange(h + maxlen * 2)[:, None] - shift[None, :]
    idx = np.clip(idx, 0, h + maxlen * 2 - 1)
    res = np.take_along_axis(out, idx[..., None].repeat(4, 2), 0)
    # smear: fill trail
    return res

def post(img, t, rgb=0, glitch=0, shake=0, grain=0.06, scan=True, vign=True, flash=0, flash_col=(1, 1, 1), sepia=0, seed=0, chroma_bleed=0):
    fi = int(t * FPS)
    if sepia > 0:
        l = img @ np.array([0.3, 0.59, 0.11], np.float32)
        sep = l[..., None] * np.array([1.08, 0.92, 0.68], np.float32)
        img = img * (1 - sepia) + sep * sepia
    if shake > 0:
        r = np.random.default_rng(fi * 7 + seed)
        dx, dy = (r.normal(0, shake, 2)).astype(int)
        img = np.roll(img, (dy, dx), (0, 1))
    if glitch > 0: img = slice_glitch(img, glitch, fi * 13 + seed)
    if rgb > 0:
        k = int(rgb)
        img = np.stack([np.roll(img[..., 0], -k, 1), img[..., 1], np.roll(img[..., 2], k, 1)], -1)
    if vign: img = img * VIGNETTE
    if grain > 0: img = img + GRAIN[fi % 6][..., None] * grain
    if scan: img = img * SCAN
    if flash > 0: img = img * (1 - flash) + np.asarray(flash_col, np.float32) * flash
    return img
