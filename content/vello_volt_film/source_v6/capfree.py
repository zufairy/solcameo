import cv2, numpy as np, json, sys
i = int(sys.argv[1]); cap = cv2.VideoCapture(f'src/bel_0{i}.mp4'); fps = cap.get(5); step = max(1, round(fps / 6))
res = []; n = 0
while True:
    ok = cap.grab()
    if not ok: break
    if n % step == 0:
        ok, fr = cap.retrieve(); g = cv2.cvtColor(cv2.resize(fr, (320, 180)), cv2.COLOR_BGR2GRAY)
        band = g[50:115, 40:280]; white = (band > 225).astype(np.uint8)
        # caption text = many small bright strokes with dark outline: bright pixels with strong vertical edges
        edges = cv2.Canny(band, 100, 220)
        score = float((white * (cv2.dilate(edges, None) > 0)).mean())
        res.append([round(n / fps, 2), round(score, 4), round(float(g.mean()), 1)])
    n += 1
json.dump(res, open(f'cap{i}.json', 'w')); print(i, len(res))
