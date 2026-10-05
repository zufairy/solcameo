import json
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000; DUR = 60.0; N = int(SR * DUR)
MUS = np.zeros((N, 2)); SFX = np.zeros((N, 2))
rng = np.random.default_rng(11)
BPM = 104.0; B = 60 / BPM
def mf(m): return 440.0 * 2 ** ((m - 69) / 12)
def lp(x, f, o=2): return sosfilt(butter(o, min(f, SR / 2 - 200) / (SR / 2), 'low', output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f / (SR / 2), 'high', output='sos'), x)
def bp(x, a, b): return sosfilt(butter(2, [a / (SR / 2), min(b, SR / 2 - 200) / (SR / 2)], 'band', output='sos'), x)
def put(buf, sig, t0, g=1.0, pan=0.0):
    i = int(round(t0 * SR))
    if i >= N or i + len(sig) <= 0: return
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), N - i)
    buf[i:i + n, 0] += sig[:n] * g * np.sqrt((1 - pan) / 2) * 1.414
    buf[i:i + n, 1] += sig[:n] * g * np.sqrt((1 + pan) / 2) * 1.414
def env(n, a=.005, d=.1, s=.7, r=.08):
    e = np.ones(n) * s; na, nd, nr = min(int(a * SR), n), int(d * SR), min(int(r * SR), n)
    e[:na] = np.linspace(0, 1, na); nd = min(nd, n - na); e[na:na + nd] = np.linspace(1, s, nd)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e
def saw(f, dur, det=0.0):
    n = int(dur * SR); t = np.arange(n) / SR; ph = (f * (1 + det) * t) % 1; return 2 * ph - 1
def sqr(f, dur, duty=.5):
    n = int(dur * SR); t = np.arange(n) / SR; ph = (f * t) % 1; return np.where(ph < duty, 1., -1.)
def supersaw(f, dur, v=7, spread=.012):
    return sum(saw(f, dur, (k - (v - 1) / 2) / ((v - 1) / 2) * spread) for k in range(v)) / v

# ---------- drums ----------
def kick(v=1.):
    n = int(.35 * SR); t = np.arange(n) / SR; f = 45 + 120 * np.exp(-t * 30)
    return np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 1.6) * v
GIR = None
def snare(v=.6):  # 80s gated reverb snare
    n = int(.42 * SR); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * .6 + hp(rng.standard_normal(n), 900) * np.exp(-t * 16)
    tail = bp(rng.standard_normal(n), 500, 7000) * .55
    gate = np.where(t < .26, 1., np.exp(-(t - .26) * 60))
    return (body + tail * gate * np.exp(-t * 3)) * v
def hat(v=.12, dec=55): n = int(.08 * SR); t = np.arange(n) / SR; return hp(rng.standard_normal(n), 8500) * np.exp(-t * dec) * v
def clap(v=.3):
    n = int(.25 * SR); t = np.arange(n) / SR; x = bp(rng.standard_normal(n), 900, 4000)
    e = sum(np.exp(-np.clip(t - k * .012, 0, None) * 60) * (t >= k * .012) for k in range(3)) + np.exp(-t * 12) * .5
    return x * e * v

Am, F, C, G, Dm, E = [57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [50, 53, 57], [52, 56, 59]
PROG = [Am, F, C, G]

def bass_sec(t0, t1, prog, vol=.32, style='8th'):
    k = 0; step = B / 2 if style == '8th' else B / 4
    while t0 + k * step < t1 - .02:
        tb = t0 + k * step; ch = prog[int((tb - t0) / (4 * B)) % len(prog)]; root = ch[0] - 24
        m = root + (12 if (style == '16th' and k % 4 == 2) else 0)
        x = saw(mf(m), step * .92) * .6 + sqr(mf(m - 12), step * .92) * .4
        x = lp(x, 900 + 600 * (k % 2)) * env(len(x), .003, .08, .5, .02)
        put(MUS, x, tb, vol); k += 1
def pad_sec(t0, t1, prog, vol=.09, cutoff=2400):
    k = 0
    while t0 + k * 4 * B < t1 - .02:
        ch = prog[k % len(prog)]; d = min(4 * B, t1 - (t0 + k * 4 * B)) + .3
        for j, m in enumerate(ch + [ch[0] + 12]):
            x = lp(supersaw(mf(m), d), cutoff) * env(int(d * SR), .25, .5, .8, .35)
            put(MUS, x, t0 + k * 4 * B, vol / 4, pan=(j - 1.5) * .35)
        k += 1
def arp_sec(t0, t1, prog, vol=.08, oct_=12, cutoff=5000, pan=.3):
    k = 0; step = B / 4
    while t0 + k * step < t1 - .02:
        tb = t0 + k * step; ch = prog[int((tb - t0) / (4 * B)) % len(prog)]
        seq = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1] + 12, ch[0] + 12, ch[2]]
        m = seq[k % 8] + oct_
        x = lp(sqr(mf(m), step * .9, .3) * .5 + saw(mf(m), step * .9) * .5, cutoff) * env(int(step * .9 * SR), .002, .06, .25, .02)
        put(MUS, x, tb, vol, pan=pan * (1 if k % 2 else -1)); k += 1
def drum_sec(t0, t1, pat='full', v=1.):
    k = 0; step = B / 4
    while t0 + k * step < t1 - .02:
        tb = t0 + k * step; p = k % 16
        if pat in ('full', 'four') and p % 4 == 0: put(MUS, kick(.9 * v), tb)
        if pat == 'half' and p in (0, 10): put(MUS, kick(.9 * v), tb)
        if pat in ('full', 'half') and p in (4, 12): put(MUS, snare(.55 * v), tb, pan=.05); put(MUS, clap(.18 * v), tb)
        if pat in ('full', 'four') and p % 2 == 1: put(MUS, hat(.1 * v), tb, pan=.35)
        if pat == 'full' and p % 4 == 2: put(MUS, hat(.14 * v, 25), tb, pan=-.3)
        k += 1
def lead(t0, notes, vol=.12, pan=-.1):
    for m, b, d in notes:
        dur = d * B * .95; n = int(dur * SR); t = np.arange(n) / SR
        vib = 1 + .006 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t / .2 - .5, 0, 1)
        ph = np.cumsum(mf(m) * vib) / SR
        x = (2 * (ph % 1) - 1) * .5 + (2 * ((ph * 1.005) % 1) - 1) * .5
        x = lp(x, 3800) * env(n, .01, .12, .7, .08)
        put(MUS, x, t0 + b * B, vol, pan)
        put(MUS, x * .35, t0 + b * B + .75 * B, vol, -pan)  # dotted-8th-ish delay
THEME = [(69, 0, 1.5), (72, 1.5, .5), (76, 2, 1), (74, 3, 1), (72, 4, 1.5), (71, 5.5, .5), (67, 6, 2),
         (69, 8, 1.5), (72, 9.5, .5), (76, 10, 1), (79, 11, 1), (77, 12, 1.5), (76, 13.5, .5), (74, 14, 2)]
HOOK = [(81, 0, .5), (79, .5, .5), (76, 1, 1), (72, 2, .5), (74, 2.5, .5), (76, 3, 1), (77, 4, 1.5), (76, 5.5, .5), (72, 6, 2),
        (81, 8, .5), (79, 8.5, .5), (76, 9, 1), (84, 10, 1), (83, 11, 1), (79, 12, 4)]

# ---------- arrangement ----------
# 0-5 intro: pad + filtered arp + riser
pad_sec(0.2, 5.0, [Am, F], .08, 1800); arp_sec(1.2, 5.0, [Am, F], .05, 12, 1600)
# 5-15 mission 1 groove
S = 5.0
drum_sec(S, 15.0, 'full'); bass_sec(S, 15.0, PROG); pad_sec(S, 15.0, PROG, .07); arp_sec(S, 15.0, PROG, .045, 24, 4500); lead(S + 4 * B * 0 + 2 * B, THEME[:7], .1)
lead(S + 10 * B, THEME[7:], .1)
# 15-20 garage: half-time, tense
S = 15.0
drum_sec(S, 20.0, 'half', .9); bass_sec(S, 20.0, [Dm, E], .3, '16th'); pad_sec(S, 20.0, [Dm, E], .08, 1500)
# 20-25 agents roll: full + hook
S = 20.0
drum_sec(S, 25.0, 'full'); bass_sec(S, 25.0, PROG, .32, '16th'); arp_sec(S, 25.0, PROG, .05, 24); pad_sec(S, 25.0, PROG, .06); lead(S, HOOK[:9], .11)
# 25-31 top-down retro: chiptune variation
S = 25.0
k = 0
while S + k * B / 4 < 31:
    ch = PROG[int(k / 16) % 4]; m = [ch[0], ch[2], ch[1] + 12, ch[2]][k % 4] + 12
    put(MUS, sqr(mf(m), B / 4 * .8, .25) * env(int(B / 4 * .8 * SR), .002, .04, .4, .01), S + k * B / 4, .06, (-1) ** k * .3); k += 1
drum_sec(S, 31.0, 'four'); bass_sec(S, 31.0, PROG, .28)
lead(S + 2 * B, [(m + 12, b, d) for m, b, d in THEME[:7]], .06)
# 31-37 build
S = 31.0
drum_sec(S, 36.2, 'full'); bass_sec(S, 37.2, [F, G, Am, Am], .32, '16th'); pad_sec(S, 37.2, [F, G, Am, Am], .08, 3500); arp_sec(S, 37.2, [F, G, Am, Am], .055, 24)
for k in range(8): put(MUS, snare(.25 + k * .05), 36.2 + k * B / 8)
# 37.3-47 payout: big chorus
S = 37.3
drum_sec(S, 47.0, 'full', 1.05); bass_sec(S, 47.0, PROG, .34, '16th'); pad_sec(S, 47.0, PROG, .09, 4000); arp_sec(S, 47.0, PROG, .05, 24, 6000)
lead(S, HOOK, .12); lead(S + 16 * B, HOOK[:9], .11)
# 47 mission passed fanfare (original)
S = 47.0
fan = [(64, 0, .5), (69, .5, .5), (72, 1, .5), (76, 1.5, 1.5), (74, 3, .5), (76, 3.5, .5), (81, 4, 4)]
lead(S, fan, .14, .0); lead(S, [(m - 12, b, d) for m, b, d in fan], .08, .2)
for m in [57, 64, 69, 72, 76]: put(MUS, lp(supersaw(mf(m), 4.2), 5000) * env(int(4.2 * SR), .02, .4, .7, 1.2), S + 4 * B, .04)
put(MUS, kick(1.), S); put(MUS, snare(.7), S)
drum_sec(S + 4 * B, 52.0, 'four', .8); bass_sec(S + 4 * B, 52.0, [Am, F], .26)
# 52-60 outro
S = 52.0
pad_sec(S, 60, [F, G, Am, Am], .09, 2800); arp_sec(S, 58.5, [F, G, Am, Am], .04, 24, 3000)
lead(S + 2 * B, [(76, 0, 1), (74, 1, 1), (72, 2, 1), (76, 3, 1), (81, 4, 6)], .1)
for k in range(8): put(MUS, kick(.6), S + k * 2 * B)

# ---------- SFX ----------
def whoosh(dur, f0, f1, v=.2):
    n = int(dur * SR); x = rng.standard_normal(n); out = np.zeros(n); blk = 1024
    for b0 in range(0, n, blk): u = b0 / n; fc = f0 * (f1 / f0) ** u; out[b0:b0 + blk] = bp(x[b0:b0 + blk], fc * .7, fc * 1.4)
    return out * np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5 * v
def blip(ms, step=.06, v=.1, kind='sq'):
    out = np.zeros(int((len(ms) * step + .4) * SR))
    for i, m in enumerate(ms):
        x = (sqr(mf(m), .18, .5) if kind == 'sq' else np.sin(2 * np.pi * mf(m) * np.arange(int(.3 * SR)) / SR)); x = x * env(len(x), .002, .05, .4, .1); j = int(i * step * SR); out[j:j + len(x)] += x
    return out * v
def engine(dur, f0, f1, v=.2):
    n = int(dur * SR); t = np.arange(n) / SR; f = f0 * (f1 / f0) ** (t / dur)
    ph = np.cumsum(f) / SR; x = (2 * (ph % 1) - 1) + .5 * np.sin(2 * np.pi * ph * .5)
    return lp(x, 700) * env(n, .05, .2, .8, .3) * v
def chaching(v=.3):
    bell = blip([88, 93, 100], .05, .5, 'sine'); n = int(.35 * SR); t = np.arange(n) / SR
    clk = hp(rng.standard_normal(n), 3000) * np.exp(-t * 40)
    out = np.zeros(max(len(bell), n)); out[:len(bell)] += bell; out[:n] += clk * .5; return out * v
def static(dur, v=.15): n = int(dur * SR); return bp(rng.standard_normal(n), 1500, 7000) * v * (0.6 + .4 * np.sin(np.arange(n) / SR * 90))

EV = json.load(open('events.json'))
for name, t in EV:
    if name == 'title': put(SFX, whoosh(1.0, 200, 3000, .3), t)
    elif name == 'citybuzz':
        for k in range(6): put(SFX, sqr(120, .04, .5) * .05 * np.hanning(int(.04 * SR)), t + k * .09)
    elif name == 'ready': put(SFX, blip([81, 88], .08, .08), t)
    elif name == 'glitch': put(SFX, static(.3, .25), t)
    elif name == 'engine': put(SFX, engine(2.2, 45, 140, .5), t); put(SFX, engine(8, 70, 90, .12), t + 2.0)
    elif name == 'radio': put(SFX, static(.25, .2), t - .15)
    elif name == 'mission': put(SFX, blip([69, 76, 81], .09, .12), t); put(SFX, kick(.8), t)
    elif name == 'checkpoint': put(SFX, blip([84, 88, 91, 96], .05, .13), t); put(SFX, whoosh(.5, 400, 6000, .25), t)
    elif name == 'door':
        n = int(.9 * SR); x = lp(rng.standard_normal(n), 500) * (0.6 + .4 * np.sign(np.sin(np.arange(n) / SR * 2 * np.pi * 14))) * env(n, .05, .2, .8, .2); put(SFX, x, t, .35); put(SFX, kick(.7), t + .9)
    elif name == 'agentrev': put(SFX, engine(1.4, 60, 220, .35), t, pan=-.4)
    elif name == 'pickup': put(SFX, blip([79, 84, 91], .04, .1), t, pan=.2)
    elif name == 'gate': put(SFX, whoosh(.45, 300, 8000, .3), t - .15); put(SFX, blip([76, 83, 88], .05, .09), t)
    elif name == 'star': put(SFX, blip([93, 100], .06, .07, 'sine'), t + .05, pan=.4)
    elif name == 'whoosh': put(SFX, whoosh(.7, 250, 5000, .25), t - .2)
    elif name == 'brake':
        n = int(1.2 * SR); x = bp(rng.standard_normal(n), 1800, 4500) * env(n, .05, .2, .7, .4); put(SFX, x, t, .18)
    elif name == 'phone': put(SFX, blip([88, 84], .1, .08), t, pan=.5)
    elif name == 'msg': put(SFX, blip([91, 96], .07, .08, 'sine'), t, pan=.5)
    elif name == 'cash': put(SFX, chaching(.45), t, pan=.3)
    elif name == 'coin': put(SFX, chaching(.25), t, pan=-.2 + (t % 1) * .4)
    elif name == 'cashrain':
        for k in range(30): put(SFX, blip([96 + (k % 3) * 2], .03, .03, 'sine'), t + k * .2 + (k % 3) * .05, pan=(k % 5 - 2) * .2)
    elif name == 'passed': put(SFX, whoosh(.8, 200, 6000, .2), t - .3)
    elif name == 'endlogo': put(SFX, kick(1.), t); put(SFX, whoosh(1.0, 3000, 200, .2), t)
    elif name == 'cta': put(SFX, blip([84, 91], .07, .1), t)
    elif name == 'sub': put(SFX, blip([100], .02, .02, 'sine'), t)
# idle/drive engine bed following speed
VK = [[0, 0], [5.0, 0], [7.0, 22], [15.0, 22], [16.4, 8], [19.4, 8], [21.4, 24], [35.6, 24], [40.0, 0], [61, 0]]
tt = np.arange(N) / SR; vk = np.interp(tt, [k[0] for k in VK], [k[1] for k in VK])
f = 38 + vk * 3.2; ph = np.cumsum(f) / SR
eng = lp((2 * (ph % 1) - 1) + .6 * np.sin(2 * np.pi * ph * .5), 500) * (.035 + .05 * vk / 24) * (tt > 5) * (tt < 52)
SFX[:, 0] += eng; SFX[:, 1] += eng

def reverb(x, dec, mix):
    n = int(dec * SR); t = np.arange(n) / SR; out = np.zeros_like(x)
    for c in range(2):
        ir = lp(rng.standard_normal(n), 6500) * np.exp(-t * 4.5 / dec); ir /= np.sqrt(np.sum(ir ** 2)); out[:, c] = fftconvolve(x[:, c], ir)[:len(x)]
    return x + out * mix
MUS = reverb(MUS, 2.2, .28); SFX = reverb(SFX, 1.0, .12)
es = lp(np.abs(SFX).mean(1), 8); duck = 1 - .3 * np.clip(es / (es.max() + 1e-9) * 3, 0, 1)
mix = MUS * duck[:, None] + SFX
for c in range(2): mix[:, c] = hp(mix[:, c], 28)
fade = np.ones(N); fn = int(1.8 * SR); fade[-fn:] = np.linspace(1, 0, fn); mix *= fade[:, None]
mix = np.tanh(mix / np.abs(mix).max() * 1.4); mix = mix / np.abs(mix).max() * .9
wavfile.write('score.wav', SR, (mix * 32767).astype(np.int16)); print('ok')
