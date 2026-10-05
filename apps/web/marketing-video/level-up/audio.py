import json
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000; DUR = 60.0; N = int(SR * DUR)
MUS = np.zeros((N, 2)); SFX = np.zeros((N, 2))
rng = np.random.default_rng(3)
def mf(m): return 440.0 * 2 ** ((m - 69) / 12)
def lp(x, f, o=2): return sosfilt(butter(o, min(f, SR / 2 - 100) / (SR / 2), 'low', output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f / (SR / 2), 'high', output='sos'), x)
def bp(x, a, b): return sosfilt(butter(2, [a / (SR / 2), b / (SR / 2)], 'band', output='sos'), x)
def put(buf, sig, t0, g=1.0, pan=0.0):
    i = int(round(t0 * SR));
    if i >= N or i + len(sig) <= 0: return
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), N - i)
    buf[i:i + n, 0] += sig[:n] * g * np.sqrt((1 - pan) / 2) * 1.414
    buf[i:i + n, 1] += sig[:n] * g * np.sqrt((1 + pan) / 2) * 1.414
def env(n, a=.004, d=.08, s=.6, r=.05):
    e = np.ones(n) * s; na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n); e[:na] = np.linspace(0, 1, na)
    nd2 = min(nd, max(0, n - na)); e[na:na + nd2] = np.linspace(1, s, nd2)
    nr = min(nr, n); e[-nr:] *= np.linspace(1, 0, nr)
    return e
def osc(kind, f, dur, duty=.5, vib=0.0, slide=None):
    n = int(dur * SR); t = np.arange(n) / SR
    fr = np.full(n, f) if slide is None else np.geomspace(f, slide, n)
    if vib: fr = fr * (1 + vib * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / .15 - 1, 0, 1))
    ph = np.cumsum(fr) / SR
    x = ph % 1.0
    if kind == 'sq': s = np.where(x < duty, 1.0, -1.0); s = lp(s, 9000)
    elif kind == 'tri': s = 4 * np.abs(x - .5) - 1
    elif kind == 'saw': s = lp(2 * x - 1, 7000)
    else: s = np.sin(2 * np.pi * ph)
    return s
def note(kind, m, dur, vol=.2, duty=.5, a=.004, d=.08, s=.6, r=.05, vib=0.0):
    x = osc(kind, mf(m), dur, duty, vib); return x * env(len(x), a, d, s, r) * vol

# ---------------- drums ----------------
def kick(v=.9):
    n = int(.25 * SR); t = np.arange(n) / SR; f = 50 + 140 * np.exp(-t * 35)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14) * v
def snare(v=.5):
    n = int(.18 * SR); t = np.arange(n) / SR
    return (hp(rng.standard_normal(n), 1500) * .8 + np.sin(2 * np.pi * 200 * t) * .5) * np.exp(-t * 22) * v
def hat(v=.15, dec=45):
    n = int(.07 * SR); t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 8000) * np.exp(-t * dec) * v

BEAT = .5
def drums(t0, t1, kpat, spat, hpat, v=1.0):
    k = 0
    while t0 + k * BEAT / 2 < t1 - .05:
        tb = t0 + k * BEAT / 2; pos = k % 8
        if kpat[pos]: put(MUS, kick(.8 * v), tb)
        if spat[pos]: put(MUS, snare(.42 * v), tb, pan=.05)
        if hpat[pos]: put(MUS, hat(.11 * v), tb, pan=.3)
        k += 1

# chord helpers (midi roots) ------------
C, Am, F, G, E, Dm, Em = [48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50], [40, 44, 47], [50, 53, 57], [52, 55, 59]
def bassline(t0, t1, chords, pattern='oct', vol=.28, kind='tri'):
    k = 0; bars = 0
    while t0 + k * BEAT / 2 < t1 - .05:
        tb = t0 + k * BEAT / 2; ch = chords[(k // 8) % len(chords)]
        root = ch[0] - 12
        if pattern == 'oct': m = root + (12 if k % 2 else 0)
        elif pattern == 'drive': m = root if k % 4 != 3 else ch[2] - 12
        else: m = root if k % 4 == 0 else None
        if m is not None: put(MUS, note(kind, m, BEAT / 2 * .9, vol, s=.8, r=.03), tb)
        k += 1
def arp(t0, t1, chords, vol=.07, kind='sq', duty=.25, up=24, step=.125, pan=-.35):
    k = 0
    while t0 + k * step < t1 - .05:
        tb = t0 + k * step; ch = chords[int(k * step / 2) % len(chords)]
        seq = [ch[0], ch[1], ch[2], ch[1] + 12, ch[2] + 12, ch[1] + 12, ch[2], ch[1]]
        put(MUS, note(kind, seq[k % 8] + up - 12, step * .9, vol, duty=duty, d=.05, s=.3, r=.02), tb, pan=pan)
        k += 1
def pad(t0, t1, chords, vol=.05):
    k = 0
    while t0 + k * 2 < t1 - .05:
        ch = chords[k % len(chords)]; d = min(2.0, t1 - (t0 + k * 2))
        for m in ch: put(MUS, note('saw', m + 12, d, vol, a=.15, d=.3, s=.7, r=.25), t0 + k * 2, pan=(m % 3 - 1) * .4)
        k += 1
def melody(t0, notes, vol=.12, kind='sq', duty=.5, pan=.15, vib=.012):
    for m, b, d in notes:
        put(MUS, note(kind, m, d * BEAT * .95, vol, duty=duty, d=.1, s=.55, r=.05, vib=vib), t0 + b * BEAT, pan=pan)

THEME = [(72, 0, 1), (76, 1, .5), (79, 1.5, .5), (81, 2, 1), (79, 3, .5), (76, 3.5, .5), (77, 4, 1), (76, 5, .5), (74, 5.5, .5), (72, 6, 1.5),
         (72, 8, .5), (74, 8.5, .5), (76, 9, 1), (79, 10, .5), (77, 10.5, .5), (76, 11, 1), (74, 12, .5), (72, 12.5, .5), (74, 13, 2)]
BOSSM = [(69, 0, .5), (72, 0.5, .5), (76, 1, .5), (75, 1.5, .5), (76, 2, 1), (72, 3, .5), (74, 3.5, .5), (65, 4, .5), (69, 4.5, .5), (72, 5, .5), (71, 5.5, .5), (72, 6, 1), (67, 7, .5), (71, 7.5, .5)]
NIGHT = [(76, 0, 2), (72, 2, 1), (74, 3, 1), (69, 4, 3), (77, 8, 2), (76, 10, 1), (74, 11, 1), (72, 12, 3)]

# ---------------- score ----------------
# title jingle 0-3
for i, m in enumerate([60, 64, 67, 72, 76, 79, 84]): put(MUS, note('sq', m, .12, .1, duty=.25, s=.4), .15 + i * .07, pan=.2)
put(MUS, note('tri', 36, 1.2, .25, s=.7, r=.3), .15)
for i, m in enumerate([72, 76, 79]): put(MUS, note('sq', m, 1.5, .045, duty=.5, a=.05, s=.6, r=.6), .7)
# overworld 3.0-9.6
S = 3.0
bassline(S, 9.6, [C, Am, F, G], 'oct', .22); arp(S + 2, 9.6, [C, Am, F, G], .045); melody(S + 1, THEME[:10], .09)
drums(S + 2, 9.4, [1, 0, 0, 0, 1, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 1, 0], .7)
# boot 9.6-13.5: sparse pad + pulses
pad(9.6, 13.5, [F, G], .04)
for k in range(8): put(MUS, note('tri', 36 + (k % 2) * 7, .2, .18), 9.6 + k * .5)
# boss 13.5 - 26.2
S = 13.5
bassline(S, 26.1, [Am, F, G, E], 'drive', .3, kind='sq')
arp(S, 26.1, [Am, F, G, E], .045, duty=.125)
drums(S, 26.1, [1, 0, 0, 1, 1, 0, 0, 0], [0, 0, 1, 0, 0, 0, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1], 1.0)
for rep in range(3): melody(S + 2 + rep * 4, BOSSM, .085, duty=.5, pan=.2)
# flurry riser
n = int(1.6 * SR); t = np.arange(n) / SR; put(MUS, osc('sq', 220, 1.6, .5, slide=1760) * np.linspace(0, .08, n), 24.0)
# victory sting 26.2
for i, m in enumerate([72, 76, 79, 84]): put(MUS, note('sq', m, .1, .1, duty=.25), 26.2 + i * .075)
for m in [60, 64, 67, 72]: put(MUS, note('sq', m, .6, .05, duty=.5, s=.5, r=.3), 26.5)
# power-up 27.0 - 34.0
S = 27.0
bassline(S, 34.0, [C, F, G, C], 'oct', .22); arp(S, 34.0, [C, F, G, C], .05, duty=.25); pad(S, 34.0, [C, F, G, C], .03)
drums(S + 1, 33.9, [1, 0, 0, 0, 1, 0, 0, 0], [0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 0, 1, 0, 1, 0, 1], .8)
melody(S + 1, THEME, .085)
# posting 34.0-37.6
S = 34.0
bassline(S, 37.6, [F, G, Em, Am], 'oct', .24); arp(S, 37.6, [F, G, Em, Am], .05)
drums(S, 37.5, [1, 0, 1, 0, 1, 0, 1, 0], [0, 0, 1, 0, 0, 0, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], .9)
melody(S, [(81, 0, 1), (79, 1, .5), (77, 1.5, .5), (79, 2, 1.5), (76, 4, 1), (74, 5, .5), (72, 5.5, .5)], .085)
# night 37.6-43.2 (lullaby)
S = 37.6
pad(S, 43.2, [Am, F, C, G], .045)
for k in range(int((43.2 - S) / 1.0)): put(MUS, note('tri', [45, 41, 48, 43][int(k / 2) % 4] - 12, .9, .2, a=.02, s=.6, r=.2), S + k)
melody(S + .5, NIGHT, .09, kind='tri', vib=.02, pan=-.1)
for k in range(int((43.2 - S) / .5)): put(MUS, hat(.05, 60), S + k * .5 + .25, pan=.4)
# music box sparkles
for k in range(11): put(MUS, note('sine', [84, 88, 91, 86][k % 4], .5, .04, s=.3, r=.3), S + .25 + k * .5, pan=-.4)
# morning 43.2-50.2
S = 43.2
for m in [60, 64, 67, 72, 76]: put(MUS, note('saw', m, 1.8, .03, a=.8, s=.8, r=.4), S)
bassline(S + 1.0, 50.1, [C, G, Am, F], 'oct', .24); arp(S + 1.0, 50.1, [C, G, Am, F], .05)
drums(S + 1.0, 50.0, [1, 0, 0, 1, 1, 0, 0, 0], [0, 0, 1, 0, 0, 0, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1], .9)
melody(S + 1.0, THEME[:13], .09)
# level complete fanfare 50.2-54.0
S = 50.2
fan = [(67, 0, .33), (72, .33, .33), (76, .66, .34), (79, 1, .33), (84, 1.33, .33), (88, 1.66, 1.6), (86, 3.5, .33), (84, 3.83, .33), (83, 4.16, .34), (84, 4.5, 2.5)]
melody(S, fan, .11, duty=.5, vib=.015)
melody(S, [(m - 12, b, d) for m, b, d in fan], .05, duty=.25, pan=-.2)
for (ch, b) in [(C, 0), (G, 3.5), (C, 4.5)]:
    for m in ch: put(MUS, note('sq', m + 12, (1.8 if b != 4.5 else 3.0) * BEAT * 1.0 + .3, .04, duty=.5, s=.6, r=.4), S + b * BEAT)
drums(S + 2.25, 53.9, [1, 0, 0, 0, 1, 0, 0, 0], [0, 0, 1, 0, 0, 0, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1], .8)
bassline(S + 2.25, 53.9, [C, F, G, C], 'oct', .22)
# outro 54.2-60
S = 54.2
pad(S, 60, [F, G, C], .04)
melody(S + .5, [(72, 0, 1), (76, 1, .5), (79, 1.5, .5), (81, 2, 1), (79, 3, 1), (84, 4, 4)], .08, kind='tri', vib=.02)
for k in range(int((59.5 - S) / .5)): put(MUS, note('tri', [41, 43, 48][min(2, int(k / 4))] - 12, .45, .2, s=.7, r=.1), S + k * .5)
for i, m in enumerate([72, 76, 79, 84, 88]): put(MUS, note('sine', m, 2.5, .05, a=.01, s=.4, r=1.5), 57.0 + i * .06)

# ---------------- SFX ----------------
def sweep(f0, f1, dur, kind='sq', vol=.15, duty=.5):
    x = osc(kind, f0, dur, duty, slide=f1); return x * env(len(x), .003, dur * .6, .3, dur * .3) * vol
def noiseburst(dur, lo, hi, vol, dec=10):
    n = int(dur * SR); t = np.arange(n) / SR; return bp(rng.standard_normal(n), lo, hi) * np.exp(-t * dec) * vol
def whoosh(dur, f0, f1, vol=.2):
    n = int(dur * SR); x = rng.standard_normal(n); out = np.zeros(n); blk = 1024
    for b0 in range(0, n, blk):
        u = b0 / n; fc = f0 * (f1 / f0) ** u; out[b0:b0 + blk] = bp(x[b0:b0 + blk], fc * .7, min(fc * 1.4, 20000))
    return out * np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5 * vol
def ding(m1, m2, vol=.12):
    a = note('sq', m1, .07, vol, duty=.5, s=.8, r=.01); b = note('sq', m2, .35, vol, duty=.5, d=.05, s=.5, r=.25)
    return np.concatenate([a, b])
def chime(ms, vol=.08):
    L = int(1.2 * SR); out = np.zeros(L)
    for i, m in enumerate(ms):
        x = note('sine', m, 1.0, vol, a=.002, d=.2, s=.3, r=.6); j = int(i * .04 * SR); out[j:j + len(x)] += x[:L - j]
    return out

EV = json.load(open('events.json'))
coin_i = 0
for name, t in EV:
    if name == 'start': put(SFX, ding(83, 88, .13), t)
    elif name == 'wipe': put(SFX, whoosh(.7, 300, 5000, .25), t)
    elif name == 'boot': put(SFX, sweep(80, 900, .9, 'sq', .08, .25), t); put(SFX, noiseburst(.9, 2000, 6000, .03, 1), t)
    elif name == 'eyes': put(SFX, note('sq', 88, .05, .08), t); put(SFX, note('sq', 93, .05, .08), t + .12); put(SFX, note('sq', 100, .08, .08), t + .24)
    elif name == 'blink': put(SFX, note('sine', 100, .03, .04), t)
    elif name == 'hop': put(SFX, sweep(320, 780, .12, 'sq', .07, .25), t, pan=-.1)
    elif name == 'land': put(SFX, note('sine', 40, .1, .35, s=.3, r=.05), t); put(SFX, noiseburst(.08, 200, 1200, .12, 40), t)
    elif name == 'jump': put(SFX, sweep(200, 1000, .22, 'sq', .08, .5), t)
    elif name == 'jumpbig': put(SFX, sweep(150, 1600, .5, 'sq', .08, .5), t)
    elif name == 'slash': put(SFX, whoosh(.22, 1200, 9000, .35), t, pan=.2)
    elif name == 'spin':
        for k in range(8): put(SFX, whoosh(.16, 1500, 8000, .18), t + k * .17, pan=(-1) ** k * .3)
    elif name == 'hit': put(SFX, sweep(700, 120, .18, 'sq', .1, .5), t, pan=.3); put(SFX, noiseburst(.2, 300, 5000, .2, 18), t, pan=.3); put(SFX, note('sine', 45, .15, .3, s=.2, r=.05), t)
    elif name == 'cardland': put(SFX, note('sq', 79 + (int(t * 10) % 5), .06, .05, duty=.25), t, pan=-.2)
    elif name == 'poof': put(SFX, noiseburst(1.0, 80, 2500, .5, 4), t); put(SFX, sweep(300, 40, .8, 'sq', .08), t); put(SFX, note('sine', 35, .8, .4, s=.3, r=.4), t)
    elif name == 'cheer':
        for i, m in enumerate([72, 76, 79, 84]): put(SFX, note('sq', m, .08, .06, duty=.25), t + i * .06)
    elif name == 'wand':
        for i in range(12): put(SFX, note('sine', 84 + i * 2, .15, .05, s=.3, r=.08), t + i * .03, pan=.3)
    elif name == 'cap': put(SFX, note('sq', 91, .04, .045, duty=.25), t, pan=(t % 1) - .5)
    elif name == 'star': put(SFX, ding(86, 91, .05), t, pan=(t % 1) - .5)
    elif name == 'reframe': put(SFX, whoosh(.25, 800, 6000, .09), t, pan=(t % 1) - .5)
    elif name == 'portal': put(SFX, sweep(100, 400, .8, 'sine', .25), t); put(SFX, whoosh(.8, 200, 4000, .2), t)
    elif name == 'launch': put(SFX, whoosh(.3, 600, 7000, .15), t, pan=-.2); put(SFX, sweep(400, 1200, .15, 'sq', .04, .25), t)
    elif name == 'arrive': put(SFX, chime([88, 95], .05), t, pan=.2); put(SFX, noiseburst(.1, 1500, 8000, .06, 30), t)
    elif name == 'launch_s': put(SFX, whoosh(.2, 900, 7000, .06), t, pan=-.3)
    elif name == 'arrive_s': put(SFX, note('sine', 96, .2, .03, s=.3, r=.1), t, pan=.3)
    elif name == 'lightoff': put(SFX, noiseburst(.03, 2000, 8000, .2, 100), t, pan=-.4)
    elif name == 'dawn': put(SFX, whoosh(2.0, 200, 3000, .08), t)
    elif name == 'chest': put(SFX, sweep(90, 60, .35, 'sq', .06, .5), t); put(SFX, chime([84, 88, 91, 96], .06), t + .3)
    elif name == 'coin':
        put(SFX, ding(83 + (coin_i % 3) * 2, 88 + (coin_i % 3) * 2, .065), t, pan=-.3 + (coin_i % 5) * .15); coin_i += 1
    elif name == 'chestclose': put(SFX, note('sine', 50, .15, .3, s=.2, r=.05), t); put(SFX, noiseburst(.1, 300, 2000, .15, 30), t)
    elif name == 'confetti':
        for k in range(6): put(SFX, noiseburst(.08, 1000, 9000, .15, 40), t + k * .05, pan=(-1) ** k * .5)
    elif name == 'endcard': put(SFX, chime([72, 79, 84, 88], .07), t)
    elif name == 'cta': put(SFX, ding(88, 95, .07), t)

# ---------------- mix ----------------
def reverb(x, dec=1.6, mix=.18):
    n = int(dec * SR); t = np.arange(n) / SR
    out = np.zeros_like(x)
    for c in range(2):
        ir = lp(rng.standard_normal(n), 7000) * np.exp(-t * 4.5 / dec); ir /= np.sqrt(np.sum(ir ** 2))
        out[:, c] = fftconvolve(x[:, c], ir)[:len(x)]
    return x + out * mix
MUS = reverb(MUS, 1.4, .2); SFX = reverb(SFX, 1.0, .12)
# duck music slightly under loud sfx
env_s = lp(np.abs(SFX).mean(1), 8)
duck = 1 - .35 * np.clip(env_s / (env_s.max() + 1e-9) * 3, 0, 1)
mix = MUS * duck[:, None] * .9 + SFX * 1.0
mix[:, 0] = hp(mix[:, 0], 30); mix[:, 1] = hp(mix[:, 1], 30)
fade = np.ones(N); fn = int(1.5 * SR); fade[-fn:] = np.linspace(1, 0, fn)
mix *= fade[:, None]
mix = np.tanh(mix / np.abs(mix).max() * 1.3); mix = mix / np.abs(mix).max() * .9
wavfile.write('score.wav', SR, (mix * 32767).astype(np.int16))
print('ok')
