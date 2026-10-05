import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

SR = 48000
DUR = 60.0
N = int(SR * DUR)
t = np.arange(N) / SR
L = np.zeros(N); Rr = np.zeros(N)
rng = np.random.default_rng(7)
B = [0, 5, 11, 18, 25, 33, 40, 47, 53, 60]

def midi(m): return 440.0 * 2 ** ((m - 69) / 12)
def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N: return
    n = min(len(sig), N - i)
    if i < 0: sig = sig[-i:]; n = min(len(sig), N); i = 0
    gl = np.cos((pan + 1) * np.pi / 4); gr = np.sin((pan + 1) * np.pi / 4)
    L[i:i + n] += sig[:n] * gain * gl * 1.414
    Rr[i:i + n] += sig[:n] * gain * gr * 1.414

def env_adsr(n, a, r):
    e = np.ones(n); na = int(a * SR); nr = int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na) ** 2
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e

def lp(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), 'low', output='sos'); return sosfilt(sos, x)
def hp(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), 'high', output='sos'); return sosfilt(sos, x)
def bp(x, lo, hi):
    sos = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos'); return sosfilt(sos, x)

# ---------- PAD ----------
CH = [
    [38, 45, 50],                 # S0 D drone
    [38, 45, 53, 64],             # Dm add9
    [34, 41, 57, 62],             # Bbmaj7
    [41, 48, 64, 67, 72],         # Fmaj9
    [31, 50, 58, 69],             # Gm9
    [39, 46, 55, 69, 74],         # Ebmaj7#11
    [38, 45, 53, 72],             # Dm eerie
    [34, 41, 62, 72, 77],         # Bb add
    [38, 45, 54, 64, 69, 74],     # D major (resolve)
]
def saw_voice(f, n, bright=8, det=0.0):
    tt = np.arange(n) / SR
    ph = 2 * np.pi * f * (1 + det) * tt + 0.3 * np.sin(2 * np.pi * 0.13 * tt)
    s = np.zeros(n)
    for k in range(1, bright + 1):
        if f * k > 9000: break
        s += np.sin(k * ph + k) / k
    return s

for i, ch in enumerate(CH):
    s0 = B[i] - 0.8; s1 = B[i + 1] + 0.8
    if i == 8: s1 = 60
    s0 = max(0, s0); n = int((s1 - s0) * SR)
    padL = np.zeros(n); padR = np.zeros(n)
    for j, m in enumerate(ch):
        f = midi(m)
        br = 3 if m < 45 else 6
        for d, pan in [(-0.004, -0.7), (0.0, 0.0), (0.0045, 0.7)]:
            v = saw_voice(f, n, br, d) * (0.9 if m < 45 else 0.45) / len(ch)
            padL += v * (1 - pan) / 2; padR += v * (1 + pan) / 2
    e = env_adsr(n, 1.4 if i else 3.0, 1.6)
    # slow swell/breath
    tt = np.arange(n) / SR
    e *= 0.8 + 0.2 * np.sin(2 * np.pi * 0.21 * tt + i)
    fc = 1800 + 900 * (i in (3, 5, 8))
    padL = lp(padL * e, fc); padR = lp(padR * e, fc)
    ii = int(s0 * SR); nn = min(n, N - ii)
    L[ii:ii + nn] += padL[:nn] * 0.55; Rr[ii:ii + nn] += padR[:nn] * 0.55

# ---------- DRUMS ----------
def kick(amp=1.0, dec=0.45):
    n = int(0.6 * SR); tt = np.arange(n) / SR
    f = 45 + 95 * np.exp(-tt * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-tt / dec * 2.2)
    s += 0.25 * rng.standard_normal(n) * np.exp(-tt * 180)
    return np.tanh(s * 1.6) * amp

def hat(amp=0.2, dec=0.04):
    n = int(0.15 * SR); tt = np.arange(n) / SR
    s = hp(rng.standard_normal(n), 7000) * np.exp(-tt / dec)
    return s * amp

def snare(amp=0.5):
    n = int(0.35 * SR); tt = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 900, 6000) * np.exp(-tt * 14)
    s += 0.5 * np.sin(2 * np.pi * 185 * tt) * np.exp(-tt * 25)
    return s * amp

# heartbeat in S0 (synced to shader heart(): peaks at fract(T*.9)=0.1 and 0.28)
for nb in range(0, 6):
    for off, a in [(0.1, 0.9), (0.28, 0.55)]:
        tm = (nb + off) / 0.9
        if tm < 5.2: add(kick(a * min(1, tm / 1.5 + 0.3), 0.3), tm, 0.8)

BPM = 100.0; beat = 60 / BPM
# (scene, kick pattern density, hats, snare)
PAT = {1: (0, 0, 0), 2: (2, 0, 0), 3: (1, 1, 1), 4: (1, 1, 0), 5: (1, 2, 1), 6: (2, 0, 0), 7: (1, 1, 1)}
for sc, (kd, hd, sd) in PAT.items():
    if kd == 0: continue
    st, en = B[sc], B[sc + 1] - 0.9
    k = 0
    while st + k * beat < en:
        tb = st + k * beat
        if kd == 1 or k % 2 == 0: add(kick(0.85), tb, 0.85)
        if hd:
            add(hat(0.12), tb + beat / 2, 1, 0.3)
            if hd == 2:
                add(hat(0.07), tb + beat / 4, 1, -0.4); add(hat(0.07), tb + 3 * beat / 4, 1, -0.4)
        if sd and k % 2 == 1: add(snare(0.28), tb, 1, 0.05)
        k += 1

# ---------- ARP (plucks) ----------
def pluck(f, amp=0.2, dec=0.35):
    n = int(1.0 * SR); tt = np.arange(n) / SR
    mod = np.sin(2 * np.pi * f * 2 * tt) * 1.6 * np.exp(-tt * 9)
    s = np.sin(2 * np.pi * f * tt + mod) * np.exp(-tt / dec)
    return s * amp

for sc in (3, 4, 5, 7):
    ch = CH[sc]; notes = [m + 12 for m in ch[1:]] + [ch[-1] + 24]
    st, en = B[sc] + 0.2, B[sc + 1] - 0.8
    k = 0; step = beat / 4
    while st + k * step < en:
        m = notes[(k * 3 + (k // 8)) % len(notes)]
        pan = np.sin(k * 0.9) * 0.8
        add(pluck(midi(m), 0.085 * (1 + 0.4 * (k % 4 == 0))), st + k * step, 1, pan)
        k += 1

# ---------- TRANSITIONS ----------
def riser(len_s=1.4):
    n = int(len_s * SR); tt = np.arange(n) / SR; x = tt / len_s
    no = rng.standard_normal(n)
    out = np.zeros(n); blk = 2048
    for b0 in range(0, n, blk):
        fc = 300 + 7000 * (b0 / n) ** 2
        seg = no[b0:b0 + blk]
        out[b0:b0 + blk] = bp(seg, fc * 0.7, min(fc * 1.4, 20000)) if fc < 13000 else seg
    f = 200 * 2 ** (x * 3)
    sw = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.3
    return (out * 0.6 + sw) * x ** 2.2

def impact(amp=1.0):
    n = int(2.5 * SR); tt = np.arange(n) / SR
    f = 28 + 70 * np.exp(-tt * 10)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 1.6)
    s += lp(rng.standard_normal(n), 2500) * np.exp(-tt * 7) * 0.6
    return np.tanh(s * 1.3) * amp

def shimmer(f0, len_s=3.0, amp=0.15):
    n = int(len_s * SR); tt = np.arange(n) / SR; s = np.zeros(n)
    for r, a in [(1, 1), (2.01, .5), (2.76, .35), (4.07, .25), (5.43, .15)]:
        s += a * np.sin(2 * np.pi * f0 * r * tt) * np.exp(-tt * (1.2 + r * .4))
    return s * amp

for b in B[1:9]:
    rs = riser(1.4); add(rs, b - 1.4, 0.35, 0)
    add(impact(0.9 if b != 53 else 1.25), b - 0.05, 0.9)
    add(shimmer(midi(74 if b != 53 else 86)), b, 0.5, 0.3)

# ---------- TEXT TICKS + WORD HITS ----------
LINES = [0.6, 2.7, 5.5, 8.1, 11.5, 14.6, 20.0, 21.6, 23.2, 25.5, 29.0, 33.5, 36.6, 40.5, 43.4, 47.5, 50.2]
def tick(amp=0.15):
    n = int(0.25 * SR); tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * 2400 * tt) * np.exp(-tt * 60) + 0.5 * np.sin(2 * np.pi * 3600 * tt) * np.exp(-tt * 90)
    return s * amp
for i, tl in enumerate(LINES):
    add(tick(0.12), tl, 1, -0.3 if i % 2 else 0.3)
for tl in (18.4, 20.0, 21.6, 23.2):  # craft words snap
    add(snare(0.35), tl, 1); add(shimmer(midi(79), 1.2, 0.1), tl, 1, 0)

# eye blink swoosh at 43.2 (lt 3.2)
n = int(0.5 * SR); tt = np.arange(n) / SR
sw = bp(rng.standard_normal(n), 400, 3000) * np.sin(np.pi * tt / 0.5) ** 2
add(sw, 42.95, 0.25)

# brand reveal: chime + sub at 55.6, 56.6, 57.4
add(shimmer(midi(81), 4.0, 0.22), 55.6, 1, -0.2)
add(shimmer(midi(86), 3.5, 0.14), 56.6, 1, 0.3)
add(shimmer(midi(93), 3.0, 0.10), 57.4, 1, 0)
add(impact(0.5), 55.55, 0.6)

# ---------- REVERB ----------
irn = int(2.8 * SR); it = np.arange(irn) / SR
irL = rng.standard_normal(irn) * np.exp(-it * 2.4); irR = rng.standard_normal(irn) * np.exp(-it * 2.4)
irL = lp(irL, 6000); irR = lp(irR, 6000)
irL /= np.sqrt(np.sum(irL ** 2)); irR /= np.sqrt(np.sum(irR ** 2))
wetL = fftconvolve(L, irL)[:N]; wetR = fftconvolve(Rr, irR)[:N]
L2 = L + 0.32 * wetL; R2 = Rr + 0.32 * wetR
# sub-cleanup, master
L2 = hp(L2, 25); R2 = hp(R2, 25)
fade = np.ones(N); fn = int(2.0 * SR); fade[-fn:] = np.linspace(1, 0, fn) ** 1.5
fi = int(0.05 * SR); fade[:fi] = np.linspace(0, 1, fi)
L2 *= fade; R2 *= fade
pk = max(np.abs(L2).max(), np.abs(R2).max())
L2 = np.tanh(L2 / pk * 1.4) ; R2 = np.tanh(R2 / pk * 1.4)
pk = max(np.abs(L2).max(), np.abs(R2).max())
st = np.stack([L2, R2], 1) / pk * 0.89
wavfile.write('soundtrack.wav', SR, (st * 32767).astype(np.int16))
print('ok', st.shape)
