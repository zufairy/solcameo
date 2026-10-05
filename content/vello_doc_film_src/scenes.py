"""Scene graph for 'VELLO — A Nature Documentary About You'. frame(t) -> uint8 HxWx3."""
from lib import *

BPM = 140; BEAT = 60 / BPM
DROP = T('f1') - 0.1
KICKS_F = [DROP + i * BEAT for i in range(40) if DROP + i * BEAT < 48.9]
LOGO = T('g4') - 0.45
END_STATIC = 59.95
IMPACTS = [T('c1') - 0.05, T('d2'), T('d4'), T('d6'), T('e2'), DROP, LOGO]

def since(t, times):
    d = [t - x for x in times if t >= x]
    return min(d) if d else 99.0

def blank(v=0.0):
    return np.zeros((H, W, 3), np.float32) + v

def pil_to_np(im): return np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
def np_to_pil(a): return Image.fromarray((clamp01(a) * 255).astype(np.uint8))

def put_text(c, key, text, font, size, cx, cy, col=(255, 255, 255), alpha=1.0, scale=1.0, rgb=0, spacing=0.95, tracking=0, add=False):
    sp = TXT(key, text, font, size, fill=tuple(col) if isinstance(col, tuple) else col, spacing=spacing, tracking=tracking)
    if scale != 1.0: sp = scale_sprite(sp, scale)
    if rgb: sp = rgb_split_sprite(sp, int(rgb))
    blit(c, sp, cx, cy, alpha, add)
    return sp

def typed(text, t, a, cps=28):
    n = int(max(0, t - a) * cps)
    return text[:n]

# --------------------------------------------------------------- overlays
def rec_overlay(c, t, label='REC', col=(255, 255, 255)):
    im = np_to_pil(c); d = ImageDraw.Draw(im)
    if int(t * 2) % 2 == 0: d.ellipse((70, 62, 96, 88), fill=(230, 20, 25))
    d.text((110, 56), label, font=F('mono', 30), fill=col)
    s = t + 3 * 3600 + 14 * 60
    tc = f"{int(s // 3600):02d}:{int(s // 60 % 60):02d}:{int(s % 60):02d}:{int((s % 1) * 30):02d}"
    d.text((W - 330, 56), tc, font=F('mono', 30), fill=col)
    d.text((70, H - 90), 'SPECIMEN FOOTAGE  ·  2026', font=F('monor', 22), fill=col)
    # viewfinder corners
    L = 60
    for (x, y, sx, sy) in [(40, 40, 1, 1), (W - 40, 40, -1, 1), (40, H - 40, 1, -1), (W - 40, H - 40, -1, -1)]:
        d.line((x, y, x + L * sx, y), fill=col, width=3); d.line((x, y, x, y + L * sy), fill=col, width=3)
    return pil_to_np(im)

def film_dust(c, t, amt=1.0):
    r = np.random.default_rng(int(t * FPS) * 3 + 1)
    im = np_to_pil(c); d = ImageDraw.Draw(im)
    for _ in range(int(6 * amt)):
        x = r.integers(0, W); d.line((x, 0, x + r.integers(-8, 8), H), fill=(200, 190, 170), width=1) if r.random() < 0.25 else None
        x, y = r.integers(0, W), r.integers(0, H); rr = r.integers(1, 4)
        d.ellipse((x, y, x + rr, y + rr), fill=(20, 15, 10) if r.random() < .5 else (220, 210, 190))
    return pil_to_np(im)

# --------------------------------------------------------------- the diorama
_room_cache = {}
def room_base(pal):
    if pal in _room_cache: return _room_cache[pal]
    im = Image.new('RGB', (W, H), (4, 3, 3)); d = ImageDraw.Draw(im)
    if pal == 'sepia':
        back, floor, side, ceil = (92, 70, 48), (58, 41, 26), (44, 32, 22), (30, 22, 16)
    else:  # night/lime world
        back, floor, side, ceil = (34, 44, 38), (22, 28, 24), (16, 20, 18), (10, 12, 11)
    fx0, fy0, fx1, fy1 = 260, 120, 1660, 900   # front opening
    bx0, by0, bx1, by1 = 560, 260, 1360, 700   # back wall
    d.polygon([(fx0, fy0), (fx1, fy0), (bx1, by0), (bx0, by0)], fill=ceil)
    d.polygon([(fx0, fy1), (fx1, fy1), (bx1, by1), (bx0, by1)], fill=floor)
    d.polygon([(fx0, fy0), (bx0, by0), (bx0, by1), (fx0, fy1)], fill=side)
    d.polygon([(fx1, fy0), (bx1, by0), (bx1, by1), (fx1, fy1)], fill=side)
    d.rectangle((bx0, by0, bx1, by1), fill=back)
    # floor boards
    for k in range(1, 9):
        xa = bx0 + (bx1 - bx0) * k / 9; xb = fx0 + (fx1 - fx0) * k / 9
        d.line((xa, by1, xb, fy1), fill=tuple(int(v * 0.8) for v in floor), width=2)
    # window
    d.rectangle((620, 310, 860, 520), fill=(8, 10, 22) if pal == 'sepia' else (4, 6, 10))
    d.rectangle((620, 310, 860, 520), outline=tuple(int(v * 0.6) for v in back), width=10)
    d.line((740, 310, 740, 520), fill=tuple(int(v * 0.6) for v in back), width=6)
    # poster on wall
    d.rectangle((1180, 320, 1300, 470), fill=tuple(int(v * 1.25) for v in back))
    d.text((1192, 340), 'GRIND\nNEVER\nSTOPS', font=F('bebas', 34), fill=tuple(int(v * 0.5) for v in back))
    # museum frame
    d.rectangle((fx0 - 22, fy0 - 22, fx1 + 22, fy1 + 22), outline=(40, 30, 20) if pal == 'sepia' else (20, 24, 20), width=22)
    arr = pil_to_np(im)
    _room_cache[pal] = arr
    return arr

def draw_human(d, pose, x, y, s, nod=0.0, slump=0.0, col=(14, 10, 8)):
    """Silhouette. pose 'desk' (sitting at desk, phone in hand) or 'bed' (asleep)."""
    if pose == 'desk':
        # chair
        d.rectangle((x - 70 * s, y - 10 * s, x + 40 * s, y + 10 * s), fill=col)
        d.line((x - 60 * s, y, x - 60 * s, y + 150 * s), fill=col, width=int(10 * s))
        d.line((x + 30 * s, y, x + 30 * s, y + 150 * s), fill=col, width=int(10 * s))
        d.line((x - 70 * s, y, x - 90 * s, y - 170 * s), fill=col, width=int(12 * s))
        # body (hunched)
        hb = slump * 25
        d.polygon([(x - 50 * s, y), (x + 30 * s, y), (x + 55 * s, y - (150 - hb) * s), (x - 10 * s, y - (185 - hb) * s), (x - 55 * s, y - 120 * s)], fill=col)
        # legs
        d.line((x + 20 * s, y, x + 110 * s, y + 10 * s), fill=col, width=int(26 * s))
        d.line((x + 110 * s, y + 10 * s, x + 110 * s, y + 150 * s), fill=col, width=int(22 * s))
        # head
        hx, hy = x + (40 + 30 * nod) * s, y - (215 - 55 * nod - hb) * s
        d.ellipse((hx - 38 * s, hy - 42 * s, hx + 38 * s, hy + 42 * s), fill=col)
        # arms to desk/phone
        px, py = x + 150 * s, y - 70 * s
        d.line((x + 35 * s, y - (150 - hb) * s, px, py), fill=col, width=int(22 * s))
        return (px, py), (hx, hy)
    else:  # bed
        d.rectangle((x - 260 * s, y - 40 * s, x + 260 * s, y + 40 * s), fill=(30, 36, 30))
        d.rectangle((x - 270 * s, y - 110 * s, x - 245 * s, y + 90 * s), fill=(22, 26, 22))
        d.rectangle((x + 245 * s, y - 70 * s, x + 270 * s, y + 90 * s), fill=(22, 26, 22))
        d.ellipse((x - 240 * s, y - 70 * s, x - 150 * s, y - 25 * s), fill=(60, 66, 60))  # pillow
        d.ellipse((x - 215 * s, y - 100 * s, x - 145 * s, y - 35 * s), fill=col)         # head
        d.chord((x - 170 * s, y - 95 * s, x + 240 * s, y + 20 * s), 180, 360, fill=(70, 80, 60))  # blanket
        return (x, y), (x - 180 * s, y - 70 * s)

def room(t, pal='sepia', nod=0.0, slump=0.0, pose='desk', window_eyes=0.0, bowl=0.0, clock_speed=1.0, phone_glow=1.0, eyecol='red'):
    c = room_base(pal).copy()
    im = np_to_pil(c); d = ImageDraw.Draw(im)
    # wall clock
    cx, cy, r = 1010, 360, 44
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(200, 185, 150) if pal == 'sepia' else (40, 48, 40), outline=(20, 15, 10), width=5)
    a1 = t * 6 * clock_speed; a2 = t * 0.5 * clock_speed
    d.line((cx, cy, cx + r * 0.8 * np.sin(a1), cy - r * 0.8 * np.cos(a1)), fill=(20, 10, 8), width=3)
    d.line((cx, cy, cx + r * 0.5 * np.sin(a2), cy - r * 0.5 * np.cos(a2)), fill=(20, 10, 8), width=6)
    if pose == 'desk':
        # desk
        d.rectangle((1020, 640, 1400, 665), fill=(26, 18, 12)); d.rectangle((1040, 665, 1060, 820), fill=(26, 18, 12)); d.rectangle((1360, 665, 1380, 820), fill=(26, 18, 12))
        # lamp
        d.line((1330, 640, 1300, 540), fill=(20, 14, 10), width=8); d.polygon([(1270, 530), (1340, 520), (1320, 565)], fill=(20, 14, 10))
        (px, py), (hx, hy) = draw_human(d, 'desk', 930, 700, 1.0, nod, slump)
        # phone
        d.rounded_rectangle((px - 8, py - 44, px + 22, py + 6), 5, fill=(230, 240, 255))
        if bowl > 0:
            bx, by = 1230, 640
            d.chord((bx - 50, by - 45, bx + 50, by + 25), 0, 180, fill=(210, 200, 180))
            for k in range(3):
                pts = [(bx - 20 + k * 20 + 8 * np.sin(t * 5 + j * 0.8 + k), by - 20 - j * 12) for j in range(7)]
                d.line(pts, fill=(220, 215, 205), width=3)
    else:
        (px, py), (hx, hy) = draw_human(d, 'bed', 1000, 700, 1.0)
    c = pil_to_np(im)
    # lamp/phone light
    if pose == 'desk':
        g = np.exp(-(((xx - px) ** 2 + (yy - py) ** 2) / (2 * 90 ** 2)))[..., None]
        c += g * np.array([0.5, 0.55, 0.65]) * 0.55 * phone_glow
        g2 = np.exp(-(((xx - 1300) ** 2 + (yy - 620) ** 2) / (2 * 180 ** 2)))[..., None]
        c += g2 * np.array([0.6, 0.45, 0.2]) * 0.4
    # eyes in the window
    if window_eyes > 0:
        n = int(np.ceil(window_eyes * 5))
        pos = [(670, 370), (805, 360), (700, 470), (790, 455), (745, 410)]
        for k in range(n):
            o = clamp01(window_eyes * 5 - k) * (0.85 + 0.15 * np.sin(t * 3 + k))
            blit(c, eye(64, o, 0.6, 0.3, eyecol, 2, 0.2), pos[k][0], pos[k][1])
    # "zz"
    if nod > 0.6 or pose == 'bed':
        zc = (195, 240, 0) if pal != 'sepia' else (235, 225, 200)
        for k in range(3):
            ph = (t * 0.8 + k / 3) % 1
            put_text(c, f'z{k}', 'z' if k % 2 else 'Z', 'bebas', 40 + 16 * k, hx + 60 + ph * 60 + k * 18, hy - 60 - ph * 120 - k * 20, col=zc, alpha=1 - ph)
    return c

def plaque(c, title, sub, alpha=1.0, y=990):
    sp = TXT('pl' + title, title, 'serif', 46, fill=(236, 214, 160), tracking=4)
    blit(c, sp, W / 2, y - 14, alpha)
    sp2 = TXT('pls' + sub, sub, 'monor', 22, fill=(200, 180, 140), tracking=2)
    blit(c, sp2, W / 2, y + 34, alpha)

# --------------------------------------------------------------- phone sprites
@lru_cache(maxsize=256)
def phone_sprite(w, col, content, open_q=12, seed=0):
    h = int(w * 2.0)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    rim = {'red': (120, 10, 14), 'lime': (120, 150, 0), 'white': (180, 180, 180)}[col]
    d.rounded_rectangle((0, 0, w - 1, h - 1), int(w * 0.14), fill=(10, 10, 14, 255), outline=rim + (255,), width=max(2, w // 40))
    arr = np.asarray(im).astype(np.float32) / 255.0
    if content == 'eye':
        blit_rgba(arr, eye(int(w * 0.8), open_q / 12, 0, 0, col if col != 'white' else 'pale', 3, 0.3), w / 2, h * 0.45)
    elif content == 'ui':
        r = np.random.default_rng(seed)
        im = Image.fromarray((arr * 255).astype(np.uint8), 'RGBA'); d = ImageDraw.Draw(im)
        c = (195, 240, 0) if col == 'lime' else (235, 30, 40)
        d.rectangle((w * 0.12, h * 0.14, w * 0.88, h * 0.6), fill=tuple(int(v * 0.25) for v in c) + (255,))
        d.polygon([(w * 0.42, h * 0.3), (w * 0.42, h * 0.44), (w * 0.6, h * 0.37)], fill=c + (255,))
        d.rectangle((w * 0.12, h * 0.66, w * 0.12 + w * 0.76 * r.uniform(0.3, 1), h * 0.69), fill=c + (255,))
        for k in range(3): d.rectangle((w * 0.12, h * (0.74 + k * 0.05), w * r.uniform(0.4, 0.88), h * (0.76 + k * 0.05)), fill=(90, 90, 90, 255))
        arr = np.asarray(im).astype(np.float32) / 255.0
    return arr

def blit_rgba(dst, sp, cx, cy):
    h, w = sp.shape[:2]; x0, y0 = int(cx - w / 2), int(cy - h / 2)
    X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(dst.shape[1], x0 + w), min(dst.shape[0], y0 + h)
    s = sp[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0]; a = s[..., 3:4]
    dst[Y0:Y1, X0:X1, :3] = dst[Y0:Y1, X0:X1, :3] * (1 - a) + s[..., :3] * a
    dst[Y0:Y1, X0:X1, 3:4] = np.maximum(dst[Y0:Y1, X0:X1, 3:4], a)

def phone_grid(c, t, n_side, col, cx=W / 2, cy=H / 2, cell=None, zoom=1.0, content='eye', blink=True, alpha=1.0):
    cell = cell or (H * 0.9 / n_side)
    cell *= zoom
    pw = int(cell * 0.42)
    if pw < 6: return
    for i in range(-n_side, n_side + 1):
        for j in range(-n_side, n_side + 1):
            x = cx + i * cell * 0.5; y = cy + j * cell
            if x < -pw or x > W + pw or y < -pw * 2 or y > H + pw * 2: continue
            k = (i * 31 + j * 17) % 7
            o = 12 if not blink else int(12 * clamp01(abs(np.sin(t * 1.3 + k)) * 3))
            sp = phone_sprite(pw, col, content if (i + j) % 2 == 0 or content == 'ui' else 'ui', o, k)
            blit(c, sp, x, y, alpha)

# --------------------------------------------------------------- eye field (act E, F, G)
_r = np.random.default_rng(11)
EYES = []
while len(EYES) < 70:
    x, y = _r.uniform(60, W - 60), _r.uniform(60, H - 60)
    if ((x - W / 2) / 520) ** 2 + ((y - H / 2) / 300) ** 2 < 1: continue
    s = _r.uniform(70, 210)
    if all((x - a) ** 2 + (y - b) ** 2 > ((s + ss) * 0.55) ** 2 for a, b, ss, _ in EYES):
        EYES.append((x, y, s, _r.uniform(0, 6.28)))
EYES.sort(key=lambda e: (e[0] - W / 2) ** 2 + (e[1] - H / 2) ** 2)

def eye_field(c, t, n, col='red', look_center=False, look_cam=False, open_amt=1.0, t_open=None, per=0.07):
    for k in range(min(n, len(EYES))):
        x, y, s, ph = EYES[k]
        o = open_amt
        if t_open is not None: o *= eout(seg(t, t_open + k * per, t_open + k * per + 0.25))
        # blinking
        b = (t * 0.7 + ph) % 3.0
        if b < 0.12: o *= abs(b - 0.06) / 0.06
        if look_cam: lx, ly = 0, 0
        elif look_center: lx, ly = np.clip((W / 2 - x) / 500, -1, 1), np.clip((H / 2 - y) / 300, -1, 1)
        else: lx, ly = np.sin(t * 0.9 + ph), np.cos(t * 0.6 + ph) * 0.5
        if o > 0.02: blit(c, eye(s, o, lx, ly, col, 3, 0.7), x, y)

# =============================================================== ACTS
def act_A(t):
    fx = dict(grain=0.09, sepia=0.55)
    if t < 0.45:
        r = np.random.default_rng(int(t * FPS))
        c = np.repeat(r.random((H // 4, W // 4, 1)).astype(np.float32), 3, 2).repeat(4, 0).repeat(4, 1) * 0.8
        return c, dict(grain=0.1, glitch=0.8, rgb=6)
    if t < T('a2') - 0.12:
        lt = t - 0.45
        c = blank(0.02) + (FOG[0][..., None] * 0.08 + FOG[1][..., None] * 0.05 * np.sin(t)) * np.array([1, 0.9, 0.7])
        # huge faint eye opening behind the title
        e = eye(1500, ease(seg(t, 1.0, 2.9)) * 0.75, np.sin(t * 0.7) * 0.3, 0, 'brown', 3, 0.8)
        blit(c, e, W / 2, H / 2, alpha=0.16 + 0.1 * seg(t, 2, 3))
        s = 1 + 0.04 * lt
        put_text(c, 'pres', 'P R E S E N T E D   W I T H   C A R E', 'monor', 24, W / 2, 330, col=(210, 195, 160), alpha=seg(t, 0.5, 0.9))
        put_text(c, 'title', 'A Nature\nDocumentary', 'serif', 150, W / 2, 540, col=(240, 228, 200), scale=s, alpha=ease(seg(t, 0.55, 1.1)), spacing=1.0)
        put_text(c, 'sub', '(there is nothing to worry about)', 'serif', 42, W / 2, 760, col=(225, 205, 165), alpha=ease(seg(t, 1.6, 2.2)))
        c = film_dust(c, t)
        c = rec_overlay(c, t, 'REC', (235, 225, 205))
        fx.update(glitch=0.3 if abs(t - 2.25) < 0.05 else 0, rgb=2)
        return c, fx
    # 'About you.' — extreme close-up
    lt = t - (T('a2') - 0.12)
    c = blank(0.01)
    pup = int(2 + 5 * seg(lt, 0.1, 0.9))
    blit(c, eye(2600, eout(seg(lt, 0, 0.18)), 0, 0, 'brown', pup, 1.0), W / 2 + np.sin(t * 40) * 3, H / 2)
    put_text(c, 'about', 'ABOUT YOU.', 'anton', 150, W / 2, H - 170, alpha=seg(lt, 0.05, 0.1), rgb=6)
    fx = dict(grain=0.1, sepia=0.35, rgb=4 + 12 * (lt > 0.95), glitch=0.6 * (lt > 0.9), shake=3)
    return c, fx

def act_B(t):
    t0 = T('b1') - 0.25
    lt = t - t0
    nod = 0.0
    if t > T('b4'): nod = ease(seg(t, T('b4'), T('b4') + 0.4)) * (1 - 0.7 * ease(seg(t, T('b5'), T('b5') + 0.2)))
    if t > T('b6'): nod = 0.35 + 0.65 * ease(seg(t, T('b6'), E('b6')))
    slump = seg(t, T('b6'), E('b6'))
    c = room(t, 'sepia', nod, slump, 'desk', window_eyes=seg(t, T('b6') - 0.2, E('b6') + 0.3) ** 0.7,
             bowl=float(t > T('b5')), clock_speed=1 + 25 * seg(t, T('b6'), E('b6')))
    # camera push
    z = 1 + 0.06 * seg(t, t0, T('c1'))
    if z > 1.001:
        im = np_to_pil(c); w2, h2 = int(W / z), int(H / z)
        im = im.crop(((W - w2) // 2, (H - h2) // 2 - 20, (W - w2) // 2 + w2, (H - h2) // 2 - 20 + h2)).resize((W, H), Image.BILINEAR)
        c = pil_to_np(im)
    plaque(c, 'HOMO  CLIPPUS', 'the human clipper  ·  habitat: bedroom  ·  status: vulnerable', ease(seg(t, T('b1'), T('b1') + 0.3)))
    # posts counter
    if t > T('b2') - 0.05:
        k = 1 + int(3 * seg(t, T('b2'), E('b2') - 0.1) + 0.0001)
        k = min(4, k)
        im = np_to_pil(c); d = ImageDraw.Draw(im)
        d.text((1390, 150), 'POSTS TODAY', font=F('mono', 26), fill=(240, 228, 200))
        d.text((1390, 180), f'{k}', font=F('anton', 150), fill=(240, 228, 200))
        d.text((1470, 250), '/ 4', font=F('anton', 70), fill=(180, 160, 120))
        c = pil_to_np(im)
    if T('b3') - 0.05 < t < T('b4') - 0.02:
        put_text(c, 'byhand', 'BY HAND.', 'anton', 220, W / 2, H / 2 - 40, col=(245, 235, 210), rgb=3, alpha=0.93)
    for pid, word in [('b4', 'IT SLEEPS.'), ('b5', 'IT EATS.'), ('b6', 'IT GETS TIRED.')]:
        if T(pid) - 0.03 < t < E(pid) + 0.1:
            put_text(c, 'bw' + pid, word, 'serif', 64, W / 2, 205, col=(245, 235, 210))
    c = film_dust(c, t)
    c = rec_overlay(c, t, 'REC', (235, 225, 205))
    dark = seg(t, T('b6'), E('b6') + 0.3)
    c *= (1 - 0.45 * dark)
    fx = dict(grain=0.08, sepia=0.8 - 0.3 * dark, rgb=1 + 4 * dark, glitch=0.15 if abs(t - T('b3')) < 0.06 else 0.4 * (t > E('b6') + 0.05))
    return c, fx

def act_C(t):
    c = blank(0.0)
    fx = dict(grain=0.07, rgb=3, sepia=0)
    si = since(t, [T('c1') - 0.05])
    if t < T('c2') - 0.05:
        lt = t - (T('c1') - 0.15)
        # red scan beams
        c += (np.exp(-((yy - (H / 2 + 400 * np.sin(t * 3))) / 6) ** 2) * 0.5)[..., None] * RED
        phw = 330
        sp = phone_sprite(phw, 'red', 'eye', int(12 * eout(seg(lt, 0.5, 1.3))), 0)
        blit(c, scale_sprite(sp, 1 + 0.25 * seg(lt, 0, 2.4)), W / 2, H / 2 + 40)
        put_text(c, 'sn', 'SOMETHING NEW', 'anton', 170, W / 2, 150, rgb=8 * (1 - seg(lt, 0, 0.5)) + 3)
        put_text(c, 'sn2', 'HAS LEARNED TO CLIP', 'mono', 40, W / 2, 1000, col=(235, 30, 40), alpha=seg(lt, 1.3, 1.5))
        fx.update(shake=10 * max(0, 1 - si * 3), glitch=0.6 * max(0, 1 - si * 4), flash=0.6 * max(0, 1 - si * 8), flash_col=(1, 0.1, 0.1))
        return c, fx
    if t < T('c3') - 0.03:
        lt = t - T('c2')
        blit(c, eye(1300, 1, np.sin(t * 7) * 0.2, 0, 'red', 2, 1.0), W / 2 + 250, H / 2)
        hrs = int(lt * 40) % 24; mins = int(lt * 2400) % 60
        put_text(c, f'clk{hrs}{mins}', f'{hrs:02d}:{mins:02d}', 'mono', 90, 420, 250, col=(235, 30, 40))
        put_text(c, 'dns', 'IT DOES\nNOT\nSLEEP.', 'anton', 190, 420, 620, rgb=4)
        return c, fx
    if t < T('c4') - 0.03:
        lt = t - T('c3')
        lines = ['> fetch campaign brief ............ OK', '> rules: 9:16 · hook < 2s · no reuploads', '> source: podcast_ep_214.mp4 (2h41m)',
                 '> scanning for moments ▮▮▮▮▮▮▮▮▮▮', '> 50 candidate hooks found', '> ranking by retention model ...',
                 '> captions: generated · style: house', '> deadline: snapshot in 3d 04h', '> page_017 warmed · ready', '> page_018 warmed · ready',
                 '> page_019 warmed · ready', '> evidence: auto-capture ON', '> human required: NO']
        n = int(lt * 14) + 2
        im = np_to_pil(c); d = ImageDraw.Draw(im)
        for i, l in enumerate(lines[:n]):
            y = 140 + i * 58 - max(0, n - 13) * 58
            d.text((140, y), l, font=F('mono', 38), fill=(235, 235, 235) if 'NO' not in l else (255, 40, 50))
        c = pil_to_np(im)
        blit(c, eye(420, 1, -0.8, -0.2, 'red', 2, 0.8), W - 330, 260)
        c[:, :, 1:] *= 0.9
        return c, dict(grain=0.07, rgb=2, glitch=0.1)
    if t < T('c5') - 0.03:
        lt = t - T('c4')
        base = blank(0)
        phone_grid(base, t, 3, 'red', zoom=1.4, content='ui', blink=False)
        n = 7; out = base.copy(); hh = H // n
        for i in range(n):
            sh = int((1 if i % 2 else -1) * 260 * eout(seg(lt, 0, 0.25)) * (1 - seg(lt, 0.5, 0.8)))
            out[i * hh:(i + 1) * hh] = np.roll(base[i * hh:(i + 1) * hh], sh, 1)
            out[i * hh:i * hh + 3] = 1.0
        put_text(out, 'cut', 'CUT.', 'anton', 360, W / 2, H / 2, col=(255, 255, 255), rgb=10)
        return out, dict(grain=0.07, rgb=6, flash=0.4 * max(0, 1 - lt * 6), shake=6)
    if t < T('c6') - 0.03:
        lt = t - T('c5')
        ns = 1 + int(eout(seg(lt, 0, 0.7)) * 6)
        phone_grid(c, t, ns + 2, 'red', cell=H * 0.9 / ns, content='eye')
        put_text(c, 'post', 'POST.', 'anton', 320, W / 2, H / 2, rgb=8)
        return c, dict(grain=0.07, rgb=5, glitch=0.2)
    lt = t - T('c6')
    z = 2 ** ((lt * 1.6) % 1)
    phone_grid(c, t, 9, 'red', cell=160, zoom=z, content='eye', alpha=0.55)
    c *= 0.6
    # counter
    dur = E('c6') - T('c6') + 0.2
    p = seg(lt, 0, dur * 0.6)
    val = int(4 + 56 * eout(p))
    txt = f'{val}'
    if lt > dur * 0.72: txt = '6,000' if lt < dur * 0.86 else '60,000'
    put_text(c, 'cnt' + txt, txt, 'anton', 420, W / 2, H / 2 - 40, col=(255, 255, 255), rgb=6 + 10 * (lt > dur * 0.72))
    put_text(c, 'pday', 'POSTS / DAY', 'mono', 50, W / 2, H / 2 + 250, col=(235, 30, 40))
    return c, dict(grain=0.07, rgb=5, glitch=0.5 * (lt > dur * 0.72), shake=4 * (lt > dur * 0.72))

JOBS = ['VIDEO EDITOR', 'CLIPPER', 'COPYWRITER', 'SOCIAL MEDIA MANAGER', 'THUMBNAIL DESIGNER', 'CAPTION WRITER', 'CONTENT ASSISTANT',
        'COMMUNITY MANAGER', 'SCRIPTWRITER', 'VIRTUAL ASSISTANT', 'UGC CREATOR', 'POSTING INTERN', 'MOTION DESIGNER', 'VOICE ACTOR',
        'PRODUCER', 'RESEARCHER', 'COLORIST', 'SUBTITLER', 'SEO WRITER', 'AD BUYER']
_jr = np.random.default_rng(5)
JOBWALL = [(JOBS[_jr.integers(len(JOBS))], _jr.uniform(-100, W), 40 + k * 44, _jr.uniform(0, 1)) for k in range(26)] + \
          [(JOBS[_jr.integers(len(JOBS))], _jr.uniform(700, W + 200), 40 + k * 44, _jr.uniform(0, 1)) for k in range(26)]

def act_D1(t):
    t0 = T('d1') - 0.1
    lt = t - t0
    c = blank(0.02)
    im = np_to_pil(c); d = ImageDraw.Draw(im)
    for (j, x, y, st) in JOBWALL:
        x2 = x - lt * 60
        d.text((x2, y), j, font=F('mono', 30), fill=(70, 70, 76))
        if lt / 7.5 > st:
            wlen = F('mono', 30).getlength(j) * clamp01((lt / 7.5 - st) * 6)
            d.line((x2 - 4, y + 18, x2 + wlen, y + 18), fill=(200, 20, 28), width=4)
    c = pil_to_np(im)
    fx = dict(grain=0.08, rgb=3)
    words = [('d1', 'd2', 'EDITORS.', '01', 'THE EDITOR'), ('d3', 'd4', 'SOCIAL MEDIA\nMANAGERS.', '02', 'THE SOCIAL MANAGER'),
             ('d5', 'd6', 'COPYWRITERS.', '03', 'THE COPYWRITER')]
    for wid, gid, word, num, lab in words:
        end = T(words[words.index((wid, gid, word, num, lab)) + 1][0]) - 0.02 if wid != 'd5' else T('d7') - 0.1
        if T(wid) - 0.1 <= t < end:
            sp = TXT('w' + wid, word, 'anton', 230, fill=(255, 255, 255), spacing=0.95)
            if t > T(gid):
                m = seg(t, T(gid) + 0.15, end)
                sp = drip(sp, m * 1.3, seed=int(num), maxlen=260)
            s = 1 + 0.03 * (t - T(wid))
            blit(c, scale_sprite(sp, s), W / 2, H / 2 + 20 + (sp.shape[0] - TXT('w' + wid, word, 'anton', 230, fill=(255, 255, 255), spacing=0.95).shape[0]) / 2 * s)
            put_text(c, 'lab' + num, f'SPECIMEN {num}  ·  {lab}', 'mono', 30, W / 2, 190, col=(200, 200, 200))
            if t > T(gid) - 0.02:
                p = seg(t, T(gid) - 0.02, T(gid) + 0.1)
                st = TXT('gone', 'GONE', 'anton', 260, fill=(230, 20, 30))
                # stamp box
                h_, w_ = st.shape[:2]
                box = np.zeros((h_ + 60, w_ + 80, 4), np.float32)
                box[..., :3] = RED; box[:14, :, 3] = 1; box[-14:, :, 3] = 1; box[:, :14, 3] = 1; box[:, -14:, 3] = 1
                blit_rgba(box, st, (w_ + 80) / 2, (h_ + 60) / 2)
                # distress
                box[..., 3] *= (value_noise(box.shape[0], box.shape[1], 6, int(num)) > 0.28)
                im2 = Image.fromarray((clamp01(box) * 255).astype(np.uint8), 'RGBA').rotate(-12, expand=True, resample=Image.BILINEAR)
                bb = np.asarray(im2).astype(np.float32) / 255
                blit(c, scale_sprite(bb, 1.8 - 0.8 * eout(p)), W / 2 + 180, H / 2 + 60, alpha=p ** 0.3)
    si = since(t, [T('d2'), T('d4'), T('d6')])
    fx.update(shake=16 * max(0, 1 - si * 4), flash=0.5 * max(0, 1 - si * 10), flash_col=(1, 0.15, 0.1), glitch=0.5 * max(0, 1 - si * 5))
    return c, fx

def act_D2(t):
    t0 = T('d7') - 0.1
    p = seg(t, t0, T('e1') - 0.4)
    c = room(t, 'sepia', 0.9, 1.0, 'desk', window_eyes=1.0, bowl=1.0)
    r = 1.25 - 1.0 * ease(p)
    rr = (RAD * (H / 2)) / (H / 2)
    mask = clamp01((r - rr) * 12)[..., None]
    out = c * mask
    # eyes waiting in the darkness beyond the habitat
    ef = blank(0)
    eye_field(ef, t, int(10 + 50 * p), 'red', look_center=True, t_open=t0, per=0.03)
    out = out + ef * (1 - mask)
    put_text(out, 'hab', 'THE HABITAT IS SHRINKING.', 'serif', 58, W / 2, 120, col=(240, 228, 200), alpha=seg(t, T('d7'), T('d7') + 0.2))
    out = rec_overlay(out, t, 'REC', (235, 225, 205))
    # tape stop darkening
    ts = seg(t, T('e1') - 1.0, T('e1') - 0.45)
    out *= (1 - ts)
    return out, dict(grain=0.08, sepia=0.5, rgb=2 + 6 * ts, glitch=0.3 * ts)

def act_E(t):
    fx = dict(grain=0.05, rgb=1)
    if t < T('e2') - 0.05:
        c = blank(0.0)
        s = typed('our advice.', t, T('e1'), 18)
        if s: put_text(c, 'adv' + s, s, 'serif', 84, W / 2, H / 2, col=(236, 226, 205))
        return c, fx
    if t < T('e3') - 0.1:
        lt = t - T('e2')
        fi = int(t * FPS)
        inv = (fi % 5 == 0) or (fi % 7 == 0)
        c = blank(1.0 if inv else 0.0)
        col = (0, 0, 0) if inv else (255, 255, 255)
        sp = TXT('dont' + str(inv), "DON'T\nUSE VELLO.", 'anton', 330, fill=col, spacing=0.9)
        blit(c, scale_sprite(sp, 1.02 + 0.05 * lt), W / 2 + np.random.default_rng(fi).normal(0, 8), H / 2 + 20)
        si = lt
        return c, dict(grain=0.08, rgb=10 + 20 * max(0, 1 - si * 3), shake=12, glitch=0.5, flash=0.4 * max(0, 1 - si * 8))
    # the little human in a spotlight + eyes accumulating
    c = blank(0)
    small = 1.0
    if t > T('e4'): small = 1 - 0.5 * ease(seg(t, T('e4'), E('e4')))
    rm = room(t, 'sepia', 0.3 + 0.4 * seg(t, T('e5'), E('e5')), seg(t, T('e5'), E('e5')), 'desk', 0, 0)
    sp = np.dstack([rm, clamp01(1.0 - np.sqrt(((xx - 930) / 360) ** 2 + ((yy - 560) / 330) ** 2)) ** 0.5])
    sp = sp[180:900, 480:1380]
    sp = scale_sprite(sp, 0.7 * small)
    lum = sp[..., :3] @ np.array([0.3, 0.59, 0.11]); sp[..., :3] = lum[..., None] * np.array([1.05, 0.9, 0.7])
    blit(c, sp, W / 2, H / 2 + 30)
    n = 0; col = 'pale'
    if t > T('e4') - 0.05: n = 6
    if t > T('e5') - 0.05: n = 22
    if t > T('e6') - 0.05: n = 70
    t_open = {6: T('e4') - 0.05, 22: T('e5') - 0.05, 70: T('e6') - 0.05}.get(n)
    look_cam = t > T('e7') + 0.2
    if t > T('e7'): col = 'red'
    if n:
        eye_field(c, t, 6, col, look_center=not look_cam, look_cam=look_cam)
        if n > 6: eye_field_range(c, t, 6, n, col, look_cam, t_open)
    caps = {'e3': 'keep clipping by hand.', 'e4': 'stay small.', 'e5': 'stay tired.', 'e6': 'stay quiet.'}
    for k, s in caps.items():
        if T(k) - 0.05 < t < (T(list(caps)[list(caps).index(k) + 1]) - 0.05 if k != 'e6' else T('e7') - 0.05):
            sp_ = TXT('cap' + k, s, 'serif', 64 if k != 'e6' else 46, fill=(236, 226, 205))
            y0 = H - 150; hh, ww = sp_.shape[:2]
            c[int(y0 - hh / 2 - 18):int(y0 + hh / 2 + 18), int(W / 2 - ww / 2 - 40):int(W / 2 + ww / 2 + 40)] *= 0.08
            blit(c, sp_, W / 2, y0)
    if t > T('e7') - 0.05:
        c[H - 190:H - 90, 380:W - 380] *= 0.08
        put_text(c, 'prefer', 'THEY PREFER YOU THAT WAY.', 'mono', 50, W / 2, H - 140, col=(235, 30, 40), rgb=3)
        # zoom into a single eye's pupil
        zt = seg(t, T('e7') + 1.05, T('f1') - 0.12)
        if zt > 0:
            w = 300 * (40 ** ein(zt))
            if w < 9000:
                e = eye(int(min(w, 4000)), 1, 0, 0, 'red', 3, 1.0)
                if w > 4000: e = scale_sprite(e, w / 4000)
                blit(c, e, W / 2, H / 2)
            c *= (1 - ein(seg(zt, 0.75, 1.0)))
            fx.update(rgb=4 + 20 * zt, shake=zt * 10)
    fx.update(grain=0.07, sepia=0.2 if t < T('e7') else 0)
    return c, fx

def eye_field_range(c, t, a, b, col, look_cam, t_open):
    for k in range(a, min(b, len(EYES))):
        x, y, s, ph = EYES[k]
        o = eout(seg(t, t_open + (k - a) * 0.015, t_open + (k - a) * 0.015 + 0.2)) if t_open else 1
        bb = (t * 0.7 + ph) % 3.0
        if bb < 0.12: o *= abs(bb - 0.06) / 0.06
        lx, ly = (0, 0) if look_cam else (np.clip((W / 2 - x) / 500, -1, 1), np.clip((H / 2 - y) / 300, -1, 1))
        if o > 0.02: blit(c, eye(s, o, lx, ly, col, 3, 0.7), x, y)

def kick_env(t):
    s = since(t, KICKS_F); return max(0, 1 - s * 5)

def zoom_img(c, z):
    if z <= 1.001: return c
    im = np_to_pil(c); w2, h2 = int(W / z), int(H / z)
    return pil_to_np(im.crop(((W - w2) // 2, (H - h2) // 2, (W - w2) // 2 + w2, (H - h2) // 2 + h2)).resize((W, H), Image.BILINEAR))

_MARK = None
def mark():
    global _MARK
    if _MARK is None:
        _MARK = np.asarray(Image.open('/mnt/user-data/uploads/vello/apps/web/public/vello-mark-lime.png').convert('RGBA')).astype(np.float32) / 255
    return _MARK
_LOGO = None
def logo():
    global _LOGO
    if _LOGO is None:
        _LOGO = np.asarray(Image.open('/mnt/user-data/uploads/vello/apps/web/public/vello-logo-white.png').convert('RGBA')).astype(np.float32) / 255
    return _LOGO

def lime_bg(t, strength=1.0):
    c = blank(0.0)
    rays = (np.sin(ANG * 18 + t * 2.0) > 0.6).astype(np.float32) * clamp01(RAD - 0.2) * 0.12
    rings = clamp01(1 - np.abs(((RAD * 3 - t * 4) % 1) - 0.5) * 12) * 0.12
    c += ((rays + rings) * strength)[..., None] * LIME
    return c

def act_F(t):
    lt = t - DROP
    k = kick_env(t)
    fx = dict(grain=0.05, rgb=2 + 6 * k, flash=0.16 * k, flash_col=(0.76, 0.94, 0), scan=True)
    if lt < 0.12:
        return blank(1.0), dict(grain=0.0, flash=0)
    if t < T('f2') - 0.08:
        c = lime_bg(t)
        eye_field(c, t, 70, 'lime', look_center=True, open_amt=eout(seg(lt, 0.1, 0.6)))
        c *= 0.55
        ms = 2.6 - 1.6 * eout(seg(lt, 0.1, 0.45))
        blit(c, scale_sprite(mark(), ms * 1.0), W / 2, 330)
        if t > T('f1') + 0.2:
            put_text(c, 'agent1', 'AN AGENT THAT', 'anton', 150, W / 2, 610, rgb=2)
            put_text(c, 'agent2', 'WORKS FOR YOU.', 'anton', 200, W / 2, 800, col=(195, 240, 0), rgb=3)
        return zoom_img(c, 1 + 0.05 * k), fx
    if t < T('f3') - 0.06:
        c = room(t, 'night', pose='bed')
        c += (np.exp(-(((xx - 960) ** 2) / (2 * 380 ** 2) + ((yy - 640) ** 2) / (2 * 200 ** 2))) * 0.28)[..., None] * LIME
        # lime agents working around the sleeper
        pos = [(430, 330), (1490, 330), (380, 700), (1540, 700), (960, 180)]
        for i, (x, y) in enumerate(pos):
            if lt > 0.1 * i:
                blit(c, phone_sprite(120, 'lime', 'ui', 12, i), x, y + 10 * np.sin(t * 3 + i))
                chip = ['POSTED ✓', 'SUBMITTED ✓', 'VERIFIED ✓', 'POSTED ✓', 'CUT 50 ✓'][i]
                put_text(c, 'chip' + str(i), chip, 'mono', 26, x, y + 150, col=(195, 240, 0))
        blit(c, scale_sprite(mark(), 0.45), 1000, 560 - 20 * np.sin(t * 2), alpha=0.9)
        n = int(seg(t, T('f2'), E('f2')) * 60)
        put_text(c, 'posted' + str(n), f'CLIPS POSTED WHILE YOU SLEPT: {n:02d}', 'mono', 32, W / 2, 80, col=(195, 240, 0))
        put_text(c, 'runs', 'IT RUNS YOUR CLIPPING PAGES\nWHILE YOU SLEEP.', 'bebas', 84, W / 2, 965, spacing=0.95)
        return zoom_img(c, 1 + 0.035 * k), fx
    if t < T('f4') - 0.06:
        c = lime_bg(t, 0.7)
        # grid of pages (avatars)
        im = np_to_pil(c); d = ImageDraw.Draw(im)
        for i in range(12):
            x = 260 + (i % 6) * 280; y = 170 if i < 6 else 900
            d.ellipse((x - 60, y - 60, x + 60, y + 60), outline=(195, 240, 0), width=6)
            d.text((x - 62, y + 70), f'@page_{i + 1:02d}', font=F('mono', 22), fill=(220, 240, 180))
        c = pil_to_np(im)
        for i in range(12):
            x = 260 + (i % 6) * 280; y = 170 if i < 6 else 900
            blit(c, eye(90, 1, np.sin(t * 2 + i) * 0.5, 0, 'lime', 2, 0.3), x, y)
        put_text(c, 'kp', 'YOU KEEP\nTHE PAGES.', 'anton', 210, W / 2, H / 2, rgb=3)
        return zoom_img(c, 1 + 0.05 * k), fx
    c = lime_bg(t, 0.7)
    put_text(c, 'kpay', 'YOU KEEP\nTHE PAYOUT.', 'anton', 210, W / 2, H / 2 - 70, col=(195, 240, 0), rgb=3)
    p = eout(seg(t, T('f4'), T('f4') + 0.8))
    im = np_to_pil(c); d = ImageDraw.Draw(im)
    x0, x1, y = 460, 1460, 900
    d.rectangle((x0, y, x1, y + 34), outline=(195, 240, 0), width=3)
    d.rectangle((x0 + 6, y + 6, x0 + 6 + (x1 - x0 - 12) * 0.85 * p, y + 28), fill=(195, 240, 0))
    d.text((x0, y + 50), f'{int(85 * p)}% TO YOU', font=F('mono', 32), fill=(255, 255, 255))
    d.text((x1 - 330, y + 50), 'nothing paid = you pay nothing', font=F('monor', 22), fill=(170, 190, 140))
    c = pil_to_np(im)
    return zoom_img(c, 1 + 0.05 * k), fx

def act_G(t):
    fx = dict(grain=0.06, rgb=2)
    if t < T('g2') - 0.08:
        lt = t - (T('g1') - 0.2)
        c = blank(0)
        # perspective floor grid
        hor = 420
        g = np.zeros((H, W), np.float32)
        below = yy > hor
        zz = 1 / np.maximum((yy - hor) / (H - hor), 1e-3)
        gx = np.abs(((xx - W / 2) / (yy - hor + 1e-3) * 4) % 1 - 0.5) < 0.02
        gz = np.abs(((zz + lt * 3) % 1) - 0.5) < 0.04 * (1 / zz)
        g = (gx | gz) & below
        c += g[..., None] * np.where(xx < W / 2, 1, 0)[..., None] * RED * 0.6
        c += g[..., None] * np.where(xx >= W / 2, 1, 0)[..., None] * LIME * 0.6
        # eyes rising from the horizon in rows
        for row in range(4):
            y = H + 80 - (H - hor + 200) * eout(seg(lt, row * 0.25, row * 0.25 + 1.2)) * (0.3 + 0.23 * row)
            s = 150 - row * 28
            for i in range(-8, 9):
                x = W / 2 + i * s * 1.25 + (row % 2) * s * 0.6
                col = 'red' if x < W / 2 else 'lime'
                blit(c, eye(s, 1, 0, -0.3, col, 3, 0.4), x, y)
        s = typed('THE AGENTS ARE COMING\nEITHER WAY.', t, T('g1'), 26)
        if s: put_text(c, 'come' + s, s, 'anton', 130, W / 2, 230, rgb=3)
        return c, fx
    if t < LOGO:
        c = blank(0)
        left = xx < W / 2 + 30 * np.sin(yy / 30 + t * 20) * (np.random.default_rng(int(t * FPS)).random() < 0.4)
        c += left[..., None] * RED * 0.18 + (~left)[..., None] * LIME * 0.14
        cam = t > T('g3') + 0.1
        blit(c, eye(820, 1, 0 if cam else 0.9, 0, 'red', 3, 1.0), W / 4 + 20, H / 2 + 40)
        blit(c, eye(820, 1, 0 if cam else -0.9, 0, 'lime', 3, 0.5), 3 * W / 4 - 20, H / 2 + 40)
        if t < T('g3') - 0.05:
            put_text(c, 'oq', 'THE ONLY QUESTION IS', 'mono', 48, W / 2, 150)
        else:
            put_text(c, 'ws', 'WHOSE SIDE\nARE THEY ON?', 'anton', 190, W / 2, H / 2, rgb=5)
        return c, dict(grain=0.06, rgb=3, glitch=0.15)
    if t < END_STATIC:
        lt = t - LOGO
        c = lime_bg(t, 0.6 * max(0, 1 - lt * 0.3))
        # shockwave
        c += (np.exp(-((RAD - lt * 2.2) / 0.05) ** 2) * 0.8 * max(0, 1 - lt))[..., None] * LIME
        # a faint lime eye behind the logo, opening at 'before you're taken'
        if t > T('g5') - 0.4:
            blit(c, eye(1700, eout(seg(t, T('g5') - 0.4, T('g5') + 0.8)) * 0.8, 0, 0, 'lime', 2, 0.2), W / 2, H / 2 - 30, alpha=0.22)
        lg = scale_sprite(logo(), 0.62 * (1.25 - 0.25 * eout(seg(lt, 0, 0.3))))
        blit(c, lg, W / 2, 440)
        put_text(c, 'url', 'velloagents.com', 'grot', 70, W / 2, 680, col=(195, 240, 0), alpha=seg(lt, 0.25, 0.45))
        s = typed("before you're taken.", t, T('g5'), 14)
        if s: put_text(c, 'byt' + s, s, 'serif', 76, W / 2, 840, col=(235, 30, 40))
        fi = int(t * FPS)
        gl = 0.5 if (fi % 23 == 0) else 0
        return c, dict(grain=0.05, rgb=2 + 12 * max(0, 1 - lt * 4) + 8 * gl, flash=0.9 * max(0, 1 - lt * 6), flash_col=(1, 1, 1), glitch=gl + 0.6 * max(0, 1 - lt * 5))
    if t < 60.3:
        r = np.random.default_rng(int(t * FPS))
        c = np.repeat(r.random((H // 3, W // 3, 1)).astype(np.float32), 3, 2).repeat(3, 0).repeat(3, 1)
        return c, dict(grain=0.1, glitch=1.0, rgb=12)
    c = blank(0)
    lt = t - 60.3
    blit(c, eye(110, eout(seg(lt, 0.1, 0.3)), 0, 0, 'red', 2, 0.5), W - 180, H - 140)
    return c, dict(grain=0.04, rgb=1)

SCENES = [
    (0, T('b1') - 0.25, act_A),
    (T('b1') - 0.25, T('c1') - 0.15, act_B),
    (T('c1') - 0.15, T('d1') - 0.1, act_C),
    (T('d1') - 0.1, T('d7') - 0.1, act_D1),
    (T('d7') - 0.1, T('e1') - 0.4, act_D2),
    (T('e1') - 0.4, DROP, act_E),
    (DROP, T('g1') - 0.2, act_F),
    (T('g1') - 0.2, 61, act_G),
]

def frame(t):
    for a, b, fn in SCENES:
        if a <= t < b:
            c, fx = fn(t); break
    c = post(clamp01(c), t, **fx)
    return (clamp01(c) * 255).astype(np.uint8)
