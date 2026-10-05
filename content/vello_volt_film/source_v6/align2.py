import sys, json, re, wave, difflib
from pocketsphinx import Decoder
i = int(sys.argv[1])
text = open(f'txt/t{i}.txt').read()
words = [w for w in re.sub(r"[^a-z' ]", ' ', text.lower().replace('-', ' ')).split() if w]
d = Decoder(samprate=16000)
with wave.open(f'iso/iso{i}.wav') as w: raw = w.readframes(w.getnframes())
hyp = []
step = 16000 * 2 * 20  # decode in 20 s blocks
for off in range(0, len(raw), step):
    d.start_utt(); d.process_raw(raw[off:off + step], full_utt=True); d.end_utt()
    base = off / 32000
    for sg in d.seg() or []:
        wd = re.sub(r'\(\d+\)$', '', sg.word)
        if wd.startswith('<') or wd.startswith('['): continue
        hyp.append((wd, base + sg.start_frame / 100, base + (sg.end_frame + 1) / 100))
sm = difflib.SequenceMatcher(a=words, b=[h[0] for h in hyp], autojunk=False)
T = [None] * len(words)
for a, b, n in sm.get_matching_blocks():
    for k in range(n): T[a + k] = (hyp[b + k][1], hyp[b + k][2])
# interpolate gaps
known = [k for k, t in enumerate(T) if t]
out = []
for k, w in enumerate(words):
    if T[k]: out.append([w, round(T[k][0], 2), round(T[k][1], 2)]); continue
    p = max([j for j in known if j < k], default=None); q = min([j for j in known if j > k], default=None)
    t0 = T[p][1] if p is not None else 0.0; t1 = T[q][0] if q is not None else t0 + 0.3 * (k - (p or 0))
    a = (k - (p if p is not None else -1)); b = ((q if q is not None else len(words)) - (p if p is not None else -1))
    s = t0 + (t1 - t0) * (a - 1) / b; e = t0 + (t1 - t0) * a / b
    out.append([w, round(s, 2), round(e, 2), 'i'])
json.dump(out, open(f'al{i}.json', 'w'))
print(i, len(words), len(hyp), len(known), round(len(known) / len(words), 2))
