import cv2, numpy as np, os, sys
from concurrent.futures import ProcessPoolExecutor
def fix(path):
    im = cv2.imread(path, 0); h, w = im.shape
    y0, y1, x0, x1 = int(h * 0.28), int(h * 0.96), int(w * 0.06), int(w * 0.94)
    band = im[y0:y1, x0:x1]
    bright = (band > 175).astype(np.uint8)
    # text strokes: bright pixels adjacent to dark outline (caption shadow) → morphological gradient high
    grad = cv2.morphologyEx(band, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    m = (bright & (grad > 60)).astype(np.uint8)
    # connect letters into words, keep only text-like rows (wide, short blobs)
    mc = cv2.dilate(m, np.ones((5, 11), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(mc)
    mask = np.zeros_like(band)
    for i in range(1, n):
        x, y, ww, hh, area = st[i]
        if hh < h * 0.16 and ww > hh * 1.2 and area > 60: mask[lab == i] = 255
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8))
    if mask.sum() == 0: return 0
    full = np.zeros_like(im); full[y0:y1, x0:x1] = mask
    out = cv2.inpaint(im, full, 6, cv2.INPAINT_TELEA)
    cv2.imwrite(path, out, [cv2.IMWRITE_JPEG_QUALITY, 90]); return 1
if __name__ == '__main__':
    files = [f'seq/{d}/{f}' for d in sorted(os.listdir('seq')) if d.startswith(('tgm', 'fvf', 'elon')) for f in sorted(os.listdir('seq/' + d))]
    with ProcessPoolExecutor(2) as ex: r = list(ex.map(fix, files, chunksize=20))
    print(len(files), sum(r))
