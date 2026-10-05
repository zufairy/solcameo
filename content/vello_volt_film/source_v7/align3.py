import sys, json, re, wave, difflib
from pocketsphinx import Decoder
n = sys.argv[1]; text = open(f'txt/{n}.txt').read()
words = [w for w in re.sub(r"[^a-z0-9' ]", ' ', text.lower().replace('-', ' ')).split() if w]
d = Decoder(samprate=16000)
with wave.open(f'iso/{n}.wav') as w: raw = w.readframes(w.getnframes())
# try forced alignment first
out = None
try:
    d2 = Decoder(samprate=16000); d2.set_align_text(' '.join(x for x in words if d2.lookup_word(x) is not None))
    d2.start_utt(); d2.process_raw(raw, full_utt=True); d2.end_utt()
    seg = [s for s in (d2.seg() or []) if not s.word.startswith(('<', '[', '('))]
    if len(seg) > len(words) * 0.8: out = [[re.sub(r'\(\d+\)$', '', s.word), s.start_frame / 100, (s.end_frame + 1) / 100] for s in seg]
except Exception as e: pass
if out is None:
    hyp = []; step = 32000 * 20
    for off in range(0, len(raw), step):
        d.start_utt(); d.process_raw(raw[off:off + step], full_utt=True); d.end_utt()
        for sg in d.seg() or []:
            wd = re.sub(r'\(\d+\)$', '', sg.word)
            if not wd.startswith(('<', '[')): hyp.append((wd, off / 32000 + sg.start_frame / 100, off / 32000 + (sg.end_frame + 1) / 100))
    sm = difflib.SequenceMatcher(a=words, b=[h[0] for h in hyp], autojunk=False); T = [None] * len(words)
    for a, b, k in sm.get_matching_blocks():
        for j in range(k): T[a + j] = hyp[b + j][1:]
    kn = [i for i, t in enumerate(T) if t]; out = []
    for i, w in enumerate(words):
        if T[i]: out.append([w, *T[i]]); continue
        p = max([j for j in kn if j < i], default=None); q = min([j for j in kn if j > i], default=None)
        t0 = T[p][1] if p is not None else 0; t1 = T[q][0] if q is not None else t0 + 0.3
        a_ = i - (p if p is not None else -1); b_ = (q if q is not None else len(words)) - (p if p is not None else -1)
        out.append([w, t0 + (t1 - t0) * (a_ - 1) / b_, t0 + (t1 - t0) * a_ / b_, 'i'])
out = [[w[0], round(w[1], 2), round(w[2], 2)] + w[3:] for w in out]
json.dump(out, open(f'al_{n}.json', 'w')); print(n, len(words), len(out))
