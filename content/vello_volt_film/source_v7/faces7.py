import cv2, os, json, numpy as np
from concurrent.futures import ProcessPoolExecutor
F = cv2.CascadeClassifier('/home/claude/haarcascade_frontalface_alt2.xml'); P = cv2.CascadeClassifier('/home/claude/haarcascade_profileface.xml')
def track(clip):
    d = 'seq/' + clip; fs = sorted(f for f in os.listdir(d) if f.endswith('.jpg')); out = []
    for f in fs:
        g = cv2.imread(f'{d}/{f}', 0); h, w = g.shape; s = 480 / w; g2 = cv2.equalizeHist(cv2.resize(g, (480, int(h * s))))
        r = list(F.detectMultiScale(g2, 1.1, 5, minSize=(30, 30)))
        if not r: r = list(P.detectMultiScale(g2, 1.1, 5, minSize=(30, 30))) + [(480 - x - ww, y, ww, hh) for (x, y, ww, hh) in P.detectMultiScale(cv2.flip(g2, 1), 1.1, 5, minSize=(30, 30))]
        if r: x, y, ww, hh = max(r, key=lambda b: b[2] * b[3]); out.append([(x + ww / 2) / 480, (y + hh / 2) / (h * s), hh / (h * s)])
        else: out.append(None)
    hit = [i for i, v in enumerate(out) if v]
    if len(hit) < max(3, len(out) * 0.35): return clip, None
    a = np.array([out[i] if out[i] else [np.nan] * 3 for i in range(len(out))], float)
    for k in range(3):
        col = a[:, k]; idx = np.arange(len(col)); m = ~np.isnan(col); a[:, k] = np.interp(idx, idx[m], col[m])
        # median 5 + EMA
        med = np.array([np.median(a[max(0, i - 2):i + 3, k]) for i in range(len(a))]); e = med.copy()
        for i in range(1, len(e)): e[i] = e[i - 1] * 0.75 + med[i] * 0.25
        a[:, k] = e
    return clip, [[round(float(v), 4) for v in row] for row in a]
if __name__ == '__main__':
    clips = sorted(d for d in os.listdir('seq') if os.path.isdir('seq/' + d) and (d.startswith(('tgm', 'pplanes', 'elon', 'fvf', 'freedom', 'ski'))))
    with ProcessPoolExecutor(2) as ex: res = dict(r for r in ex.map(track, clips))
    good = {k: v for k, v in res.items() if v}
    open('faces7.js', 'w').write('window.FACES7=' + json.dumps(good) + ';')
    print(len(clips), len(good)); print(sorted(good))
