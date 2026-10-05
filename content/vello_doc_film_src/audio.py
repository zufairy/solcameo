"""VELLO — 'A Nature Documentary About You' — fully programmed score + sound design.
Everything except the narration (Kokoro TTS, bm_george) is synthesized here with numpy."""
import numpy as np, json, soundfile as sf
from scipy import signal
from math import gcd

SR = 48000
DUR = 60.8
N = int(SR * DUR)
rng = np.random.default_rng(7)
TL = {x['id']: x for x in json.load(open('timeline_t.json'))}
def T(i): return TL[i]['start']
def E(i): return TL[i]['start'] + TL[i]['dur']

# ---------------------------------------------------------------- helpers
def buf(): return np.zeros((N, 2), np.float32)
def t_(n): return np.arange(n) / SR
def place(bus, x, at, gain=1.0, pan=0.0):
    if x.ndim == 1: x = np.stack([x * np.sqrt(0.5 * (1 - pan)), x * np.sqrt(0.5 * (1 + pan))], 1) * 1.414
    i = int(at * SR)
    if i >= N: return
    if i < 0: x = x[-i:]; i = 0
    n = min(len(x), N - i)
    bus[i:i + n] += x[:n] * gain
def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos'); return signal.sosfilt(sos, x, axis=0)
def hp(x, fc, order=2):
    sos = signal.butter(order, fc, 'high', fs=SR, output='sos'); return signal.sosfilt(sos, x, axis=0)
def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], 'band', fs=SR, output='sos'); return signal.sosfilt(sos, x, axis=0)
def env(n, a=0.005, d=0.2, curve=4.0):
    tt = t_(n); e = np.minimum(1, tt / max(a, 1e-4)) * np.exp(-np.maximum(0, tt - a) / max(d, 1e-4) * 1.0)
    return e
def saw(f, n, ph=0.0):
    p = np.cumsum(np.broadcast_to(f, (n,)) / SR) + ph; return 2 * (p % 1) - 1
def sq(f, n): p = np.cumsum(np.broadcast_to(f, (n,)) / SR); return np.sign(np.sin(2 * np.pi * p))
def sine(f, n, ph=0.0): p = np.cumsum(np.broadcast_to(f, (n,)) / SR); return np.sin(2 * np.pi * p + ph)
def noise(n): return rng.standard_normal(n).astype(np.float32)
def mtof(m): return 440 * 2 ** ((m - 69) / 12)
def load(path):
    x, sr = sf.read(path, dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    if sr != SR:
        g = gcd(SR, sr); x = signal.resample_poly(x, SR // g, sr // g).astype(np.float32)
    return x
_ir_cache = {}
def reverb(x, secs=2.0, wet=0.35, pre=0.02, bright=6000):
    key = (secs, bright)
    if key not in _ir_cache:
        n = int(secs * SR); tt = t_(n)
        irL = noise(n) * np.exp(-tt / (secs / 6.9)); irR = noise(n) * np.exp(-tt / (secs / 6.9))
        irL = lp(irL, bright); irR = lp(irR, bright)
        irL[:int(pre * SR)] = 0; irR[:int(pre * SR)] = 0
        _ir_cache[key] = np.stack([irL, irR], 1) / np.sqrt(n) * 18
    ir = _ir_cache[key]
    if x.ndim == 1: x = np.stack([x, x], 1)
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c]) for c in range(2)], 1)[:len(x) + len(ir) // 2]
    xx = np.zeros_like(y); xx[:len(x)] = x
    return xx * (1 - wet) + y * wet
def stereo(x, width=0.0):
    return np.stack([x, x], 1) if x.ndim == 1 else x

# ---------------------------------------------------------------- instruments
def kick(dur=0.45, f0=150, f1=42, drive=2.5, click=0.5):
    n = int(dur * SR); tt = t_(n)
    f = f1 + (f0 - f1) * np.exp(-tt * 28)
    x = sine(f, n) * np.exp(-tt * 7.5)
    x += click * noise(n) * np.exp(-tt * 250)
    return np.tanh(x * drive) * 0.9
def snare(dur=0.3):
    n = int(dur * SR); tt = t_(n)
    x = bp(noise(n), 900, 7000) * np.exp(-tt * 16) * 1.3 + sine(185, n) * np.exp(-tt * 25) * 0.6
    return np.tanh(x * 1.6)
def clap():
    n = int(0.35 * SR); tt = t_(n); x = np.zeros(n)
    for k, o in enumerate([0, 0.011, 0.022, 0.035]):
        i = int(o * SR); m = n - i; x[i:] += bp(noise(m), 1000, 5000) * np.exp(-t_(m) * (60 if k < 3 else 13))
    return np.tanh(x * 1.5) * 0.8
def hat(dur=0.06, open_=False):
    n = int((0.25 if open_ else dur) * SR); tt = t_(n)
    return hp(noise(n), 7500) * np.exp(-tt * (14 if open_ else 70)) * 0.5
def metal(f=320, dur=0.8):
    n = int(dur * SR); tt = t_(n)
    mod = sine(f * 1.414, n) * 900 * np.exp(-tt * 5)
    return sine(f + mod, n) * np.exp(-tt * 6) * 0.7
def heartbeat(gain=1.0):
    n = int(0.55 * SR); x = np.zeros(n)
    for o, a in [(0, 1.0), (0.2, 0.7)]:
        i = int(o * SR); m = n - i; tt = t_(m)
        x[i:] += sine(48 + 30 * np.exp(-tt * 30), m) * np.exp(-tt * 14) * a
    return lp(np.tanh(x * 2.2), 180) * gain
def musicbox(freq, dur=1.6, detune_cents=0.0, bright=1.0):
    n = int(dur * SR); tt = t_(n)
    f = freq * 2 ** (detune_cents / 1200)
    parts = [(1, 1.0, 3.0), (2.76, 0.45 * bright, 7.5), (5.40, 0.25 * bright, 13), (8.93, 0.12 * bright, 20)]
    x = sum(a * sine(f * r, n) * np.exp(-tt * d) for r, a, d in parts)
    x += noise(n) * np.exp(-tt * 300) * 0.15 * bright  # tine pluck
    return x * 0.35
def pad(freqs, dur, cutoff=900, det=0.12):
    n = int(dur * SR); x = np.zeros(n)
    for f in freqs:
        for d in (-det, 0, det):
            x += saw(f * 2 ** (d / 12), n, rng.random())
    x = lp(x / (len(freqs) * 3), cutoff, 2)
    a = np.minimum(1, t_(n) / 0.4) * np.minimum(1, (dur - t_(n)) / 0.4)
    return x * a
def impact(dur=3.0, sub=38, gain=1.0):
    n = int(dur * SR); tt = t_(n)
    s = sine(sub + 60 * np.exp(-tt * 9), n) * np.exp(-tt * 1.6)
    nb = lp(noise(n), 2500) * np.exp(-tt * 5) * 0.8
    x = np.tanh((s * 1.6 + nb) * 1.8)
    return reverb(x * gain, 3.5, 0.45, bright=3500)
def stamp():
    n = int(0.25 * SR); tt = t_(n)
    x = bp(noise(n), 300, 3000) * np.exp(-tt * 40) + sine(90, n) * np.exp(-tt * 30)
    return np.tanh(x * 3)
def riser(dur, f0=200, f1=6000, noise_amt=1.0):
    n = int(dur * SR); tt = t_(n); p = tt / dur
    x = noise(n) * noise_amt
    # swept band via stft-free trick: filter segments
    out = np.zeros(n); seg = int(0.05 * SR)
    for i in range(0, n, seg):
        fc = f0 * (f1 / f0) ** (i / n)
        out[i:i + seg] = bp(x[i:i + seg + 0][:seg], max(40, fc * 0.6), min(SR * 0.45, fc * 1.4), 1)
    tone = saw(80 * 2 ** (4 * p), n) * 0.25
    return (out * 1.5 + lp(tone, 3000)) * p ** 2.2
def shepard(dur, up=True, rate=0.18, base=55):
    """Endless rising (or falling) Shepard–Risset glissando: the sound of dread."""
    n = int(dur * SR); tt = t_(n); x = np.zeros(n)
    K = 8
    for k in range(K):
        pos = (k / K + (rate if up else -rate) * tt) % 1.0
        f = base * 2 ** (pos * K)
        amp = np.exp(-((pos - 0.5) ** 2) / 0.045)
        x += sine(f, n) * amp + 0.3 * saw(f, n) * amp
    return lp(x / K, 5000) * np.minimum(1, tt / 0.8)
def glitch(dur=0.25):
    n = int(dur * SR); x = np.zeros(n); i = 0
    while i < n:
        L = int(rng.uniform(0.008, 0.04) * SR)
        kind = rng.integers(3)
        seg = sq(rng.uniform(200, 3000), L) if kind == 0 else (noise(L) if kind == 1 else sine(rng.uniform(1000, 6000), L))
        x[i:i + L] += seg[:max(0, min(L, n - i))] * rng.uniform(0.3, 1)
        i += L
    return np.round(x * 6) / 6 * 0.5  # bitcrush
def static(dur, gain=0.3):
    n = int(dur * SR); x = noise(n)
    crackle = (rng.random(n) > 0.9993) * rng.uniform(-1, 1, n) * 6
    return (hp(x, 1500) * 0.5 + lp(crackle, 5000)) * gain
def tick():
    n = int(0.03 * SR); return bp(noise(n), 2500, 8000) * np.exp(-t_(n) * 180) * 0.8
def squelch(dur=0.4):
    n = int(dur * SR); tt = t_(n)
    f = 400 * np.exp(-tt * 6) + 60
    return lp(saw(f, n) * np.exp(-tt * 7), 1200) * 0.6 + bp(noise(n), 200, 900) * np.exp(-tt * 12) * 0.4
def data_chirp(dur=0.12):
    n = int(dur * SR); f = rng.choice([1800, 2400, 3200, 4100]) * (1 + 0.5 * (t_(n) / dur > 0.5))
    return sq(f, n) * 0.18 * (t_(n) < dur * 0.95)

def tape_stop(x, t0, t1):
    """Apply a tape-stop (pitch+speed slows to zero) to section [t0,t1] of bus x."""
    i0, i1 = int(t0 * SR), int(t1 * SR); n = i1 - i0
    speed = np.linspace(1, 0, n) ** 1.3
    pos = np.cumsum(speed); pos = np.clip(pos, 0, n - 1)
    for c in range(2):
        seg = x[i0:i1, c].copy(); x[i0:i1, c] = np.interp(pos, np.arange(n), seg) * np.linspace(1, 0.2, n)
    return x

# ---------------------------------------------------------------- buses
mus, sfx, vo = buf(), buf(), buf()

BPM = 140; BEAT = 60 / BPM

# --- Act A/B: the twisted lullaby (A minor, music box, wow & flutter, detune getting worse)
melody = [69, 72, 76, 81, 80, 76, 72, 71, 69, 72, 76, 77, 76, 75, 71, 68,
          69, 72, 76, 81, 83, 84, 83, 80, 81, 76, 72, 69, 68, 69, 70, 69]
step = 0.36
t = 0.15
i = 0
while t < 11.6:
    m = melody[i % len(melody)]
    drift = (t / 11.6) ** 2 * 60  # detune grows -> the lullaby rots
    det = rng.normal(0, 8 + drift * 0.4) - drift
    wobble = 1 + 0.004 * np.sin(t * 5.1)
    place(mus, musicbox(mtof(m) * wobble, 1.8, det), t, 0.55, pan=np.sin(i) * 0.3)
    if i % 4 == 0:  # bass note
        place(mus, musicbox(mtof(m - 24), 2.2, det, 0.4), t, 0.4)
    t += step * (1 + 0.1 * (t > 9))  # slows as 'it gets tired'
    i += 1
# vinyl / VHS bed across the whole film (quieter later)
bed = static(DUR, 0.05)
place(sfx, bed, 0, 1.0)
# heartbeat (slow in A/B)
hb_t = 0.2
while hb_t < 11.6:
    place(sfx, heartbeat(), hb_t, 0.75); hb_t += 1.05 - 0.02 * hb_t
# clock ticks through the human section
tt_ = 4.7
while tt_ < 11.6:
    place(sfx, tick(), tt_, 0.5, pan=0.5 if int(tt_ * 2) % 2 else -0.5); tt_ += 0.5
# REC beep + opening crack
place(sfx, sine(1000, int(0.12 * SR)) * 0.25, 0.05, 1.0)
place(sfx, impact(2.5, 34, 0.6), 0.0, 0.8)
# 'About you.' – sub swell & low bell
place(mus, pad([mtof(33), mtof(40), mtof(46)], 3.0, 400), T('a2') - 0.3, 0.6)
# tape slowdown at the end of B ('it gets tired')
mus = tape_stop(mus, 10.9, 11.75)

# --- Act C: the machine wakes (11.6 – 19.9)
place(mus, shepard(8.6, True, 0.16, 40), 11.5, 0.45)
place(sfx, impact(3.0, 30, 1.0), T('c1') - 0.05, 0.9)
bt = T('c1')
k = 0
while bt < 19.85:
    full = bt > T('c2') - 0.02
    if k % 2 == 0 or full: place(mus, kick(0.4, 160, 44, 3.0), bt, 0.9 if full else 0.6)
    if full and k % 4 == 2: place(mus, snare(), bt, 0.55)
    if full and k % 8 == 7: place(mus, metal(rng.uniform(200, 400)), bt, 0.35, pan=rng.uniform(-.7, .7))
    for s16 in range(4):
        place(mus, hat(), bt + s16 * BEAT / 4, 0.25 if s16 % 2 else 0.12, pan=0.4)
        # grinding 16th bass on A1
        n16 = int(BEAT / 4 * SR)
        b = saw(mtof(33 + (12 if s16 == 3 else 0)), n16) * env(n16, 0.002, 0.07)
        place(mus, np.tanh(lp(b, 300 + 2500 * ((bt - 11.6) / 8.3) ** 2) * 3) * 0.35, bt + s16 * BEAT / 4, 1.0)
    bt += BEAT; k += 1
for pid in ['c2', 'c3', 'c4', 'c5', 'c6']:
    place(sfx, glitch(0.18), T(pid) - 0.08, 0.6, pan=rng.uniform(-.8, .8))
    for j in range(5): place(sfx, data_chirp(), T(pid) + j * 0.07, 0.5, pan=rng.uniform(-1, 1))
# counter ratchet during 'sixty times a day'
for j in range(40): place(sfx, tick(), T('c6') + j * 0.035, 0.45, pan=rng.uniform(-1, 1))

# --- Act D: extinction (19.9 – 28.6)
bt = T('d1') - 0.05; k = 0
while bt < E('d6'):
    place(mus, kick(0.6, 120, 36, 4.0), bt, 0.95)                     # half-time, heavy
    if k % 2 == 1: place(mus, snare(0.5), bt, 0.5)
    place(mus, np.tanh(lp(saw(mtof(28), int(BEAT * 2 * SR)), 180) * 3) * 0.25, bt, 1.0)
    bt += BEAT * 2; k += 1
for pid in ['d1', 'd3', 'd5']:
    place(sfx, glitch(0.3), T(pid) - 0.05, 0.55)
for pid in ['d2', 'd4', 'd6']:
    place(sfx, impact(2.6, 32, 1.1), T(pid) - 0.02, 1.0)
    place(sfx, stamp(), T(pid) - 0.02, 0.9)
    place(mus, pad([mtof(45), mtof(46), mtof(51)], 1.2, 1600, 0.3), T(pid), 0.35)  # dissonant stab
# the habitat shrinks: shepard falls, everything slows and dies
place(mus, shepard(2.4, False, 0.35, 50), T('d7') - 0.2, 0.5)
mus = tape_stop(mus, T('d7') + 0.3, T('e1') - 0.55)

# --- Act E: reverse psychology (28.6 – 40.3). Near silence. Drone. The lullaby, reversed.
e0 = T('e1') - 0.5
dr = pad([mtof(21), mtof(21.3), mtof(28), mtof(33.2)], E('e7') - e0 + 0.6, 300, 0.25)
place(mus, dr, e0, 0.9)
t = e0 + 0.3; j = 0
while t < T('e7'):
    m = melody[j % 16] - 12
    nb = musicbox(mtof(m), 1.4, rng.normal(-40, 25))[::-1] * 0.8  # reversed tines = swells
    place(mus, nb, t, 0.35, pan=np.sin(j * 1.7) * 0.6); t += 0.72; j += 1
place(sfx, impact(4.0, 28, 1.3), T('e2') - 0.02, 1.0)                          # DON'T USE VELLO
place(mus, pad([mtof(57), mtof(58), mtof(63), mtof(64)], 2.8, 2500, 0.35), T('e2'), 0.35)
for pid in ['e4', 'e5', 'e6']:
    place(sfx, squelch(), T(pid) - 0.05, 0.6, pan=rng.uniform(-.6, .6))       # eyes opening
    place(sfx, heartbeat(1.2), T(pid) + 0.2, 0.8)
# 'They prefer you that way' -> riser + accelerating heartbeat + shepard into the pupil
r0 = T('e7') - 0.2; r1 = T('f1') - 0.12
place(sfx, riser(r1 - r0, 150, 9000), r0, 0.8)
place(mus, shepard(r1 - r0, True, 0.6, 45), r0, 0.5)
hb = r0
while hb < r1 - 0.15:
    place(sfx, heartbeat(1.1), hb, 0.9); hb += max(0.16, 0.6 - (hb - r0) * 0.25)
# 60 ms of total silence before the drop
cut0, cut1 = int((r1) * SR), int((r1 + 0.1) * SR)

# --- Act F: THE DROP — lime. (40.3 – 48.8)
d0 = T('f1') - 0.1
prog = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [55, 60, 64]), (55, [55, 59, 62]), (57, [57, 60, 64])]
bar = BEAT * 4
place(sfx, impact(3.5, 30, 1.4), d0, 1.0)
for b_, (root, ch) in enumerate(prog):
    b0 = d0 + b_ * bar
    if b0 > 48.9: break
    for q in range(4):
        tq = b0 + q * BEAT
        if tq > 48.9: break
        place(mus, kick(0.4, 170, 45, 3.2), tq, 1.0)
        if q % 2 == 1: place(mus, clap(), tq, 0.55)
        place(mus, hat(open_=True), tq + BEAT / 2, 0.25, pan=0.3)
        for s16 in range(4):
            ts = tq + s16 * BEAT / 4
            n16 = int(BEAT / 4 * SR)
            note = ch[(q * 4 + s16) % 3] + (12 if s16 % 4 == 3 else 0)
            a = saw(mtof(note), n16) + saw(mtof(note) * 1.006, n16) + sq(mtof(note + 12), n16) * 0.3
            a = lp(a * env(n16, 0.002, 0.08), 3500 + 2500 * np.sin(b_ + s16))
            place(mus, a * 0.13, ts, 1.0, pan=0.5 if s16 % 2 else -0.5)
            # sidechained sub bass (off the kick)
            if s16 in (1, 2, 3):
                sb = sine(mtof(root - 24), n16) * env(n16, 0.01, 0.12)
                place(mus, np.tanh(sb * 2) * 0.35, ts, 1.0)
    place(mus, pad([mtof(n) for n in ch], bar, 2200, 0.15), b0, 0.18)
# the lullaby returns, but in the light: music box melody on top, clean, harmonised
t = d0; i = 0
while t < 48.8:
    m = melody[i % len(melody)] + 12
    place(mus, musicbox(mtof(m), 1.2, 0, 1.3), t, 0.28, pan=0.2)
    place(mus, musicbox(mtof(m + 4 if i % 3 else m + 7), 1.2, 0, 1.0), t, 0.12, pan=-0.2)
    t += BEAT / 2; i += 1
for pid in ['f3', 'f4']:
    place(sfx, metal(640, 1.4), T(pid), 0.35)

# --- Act G: the ending (48.8 – 60.8)
g0 = 48.85
# beat continues, filtered, until "the only question is"
bt = g0; k = 0; stop = T('g2') + 0.2
while bt < stop:
    place(mus, lp(kick(0.4, 150, 42, 3.0), 900), bt, 0.8)
    if k % 2 == 1: place(mus, lp(clap(), 1500), bt, 0.3)
    bt += BEAT; k += 1
place(mus, pad([mtof(45), mtof(52), mtof(57), mtof(60)], stop - g0 + 0.5, 700, 0.2), g0, 0.5)
place(sfx, riser(T('g3') - T('g2'), 200, 8000), T('g2'), 0.6)
# 'whose side are they on?' — drone + two heartbeats, the question hangs
place(mus, pad([mtof(33), mtof(39)], 2.4, 250, 0.4), T('g3'), 0.8)
place(sfx, heartbeat(1.3), T('g3') + 0.1, 0.9); place(sfx, heartbeat(1.3), T('g3') + 1.0, 0.9)
# LOGO SLAM
L0 = T('g4') - 0.45
place(sfx, impact(4.5, 30, 1.5), L0, 1.0)
place(sfx, glitch(0.35), L0 - 0.3, 0.7)
place(mus, pad([mtof(57), mtof(64), mtof(69), mtof(71), mtof(76)], 5.0, 5000, 0.12), L0, 0.3)
for j, m in enumerate([81, 88, 93, 95, 100]):
    place(mus, musicbox(mtof(m), 2.5, 0, 1.4), L0 + 0.05 + j * 0.06, 0.25, pan=(j - 2) * 0.3)
# 'Before you're taken.' — the lullaby's last notes, rotten again; heartbeat stops
for j, m in enumerate([76, 72, 69, 68]):
    place(mus, musicbox(mtof(m), 2.5, -30 - j * 25), T('g5') - 0.2 + j * 0.42, 0.45)
place(sfx, heartbeat(1.4), T('g5') + 0.1, 0.9)
place(sfx, heartbeat(0.9), T('g5') + 1.3, 0.6)
# final static burst and hard cut
place(sfx, static(0.35, 1.2), 59.95, 0.9)
place(sfx, glitch(0.35), 59.95, 0.8)

# ---------------------------------------------------------------- narration
for pid, x in TL.items():
    v = load(f'vo/t_{pid}.wav')
    v = hp(v, 70)
    act = pid[0]
    if act == 'c':  # the machine lines: subtle ring-mod + crush
        rm = sine(np.full(len(v), 50.0), len(v))
        v = v * (0.8 + 0.2 * rm); v = np.round(v * 64) / 64
    vv = stereo(v)
    if act in 'ab': vv = reverb(v, 1.2, 0.18, bright=5000)
    elif act == 'e': vv = reverb(v, 2.8, 0.3, bright=4000)
    elif act == 'g': vv = reverb(v, 2.2, 0.22, bright=5000)
    else: vv = reverb(v, 0.8, 0.12, bright=6000)
    place(vo, vv, x['start'], 1.0)
# creepy doubled voices
for pid, g in [('a2', 0.55), ('e2', 0.7), ('e7', 0.8), ('g3', 0.45), ('g5', 0.85)]:
    lo = load(f'vo/low_{pid}.wav'); lo2 = load(f'vo/low2_{pid}.wav')
    place(vo, reverb(hp(lo, 60), 3.0, 0.45, bright=2500), T(pid), g * 0.6, 0)
    place(vo, reverb(hp(lo2, 50), 3.5, 0.5, bright=1800), T(pid) + 0.012, g * 0.35, 0)
    # reversed-reverb pre-swell (ghost breathes in before the line)
    rv = reverb(load(f'vo/t_{pid}.wav'), 2.5, 1.0, bright=3000)[:, 0][::-1]
    rv = rv[-int(1.2 * SR):] if len(rv) > 1.2 * SR else rv
    place(vo, rv, T(pid) - len(rv) / SR + 0.05, g * 0.5)

# ---------------------------------------------------------------- mix
# duck music under narration
vo_env = np.abs(vo).max(1)
vo_env = lp(vo_env, 6)
vo_env = np.clip(vo_env * 9, 0, 1)
duck = 1 - 0.6 * vo_env
mus *= duck[:, None]
# silence gap just before the drop + hard stop at the end
mus[cut0:cut1] = 0; sfx[cut0:cut1] *= 0.0
master = mus * 0.55 + sfx * 0.6 + vo * 3.2
end = int(60.3 * SR); master[end:] *= 0.0
fade = int(0.05 * SR); master[end - fade:end] *= np.linspace(1, 0, fade)[:, None]
master = hp(master, 25)
master /= np.percentile(np.abs(master), 99.95) + 1e-9
master = np.tanh(master * 1.1) / np.tanh(1.1)
master /= np.abs(master).max() + 1e-9
sf.write('mix_raw.wav', (master * 0.89).astype(np.float32), SR, subtype='FLOAT')
np.save('stems.npy', np.stack([mus.mean(1)*0.55, sfx.mean(1)*0.6, vo.mean(1)*3.2]).astype(np.float32)); print('ok')
