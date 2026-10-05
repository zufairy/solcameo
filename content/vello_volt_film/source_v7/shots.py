import subprocess, json, os, sys
from PIL import Image, ImageDraw, ImageFont
from concurrent.futures import ThreadPoolExecutor
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 12)
names = ['tgm', 'pplanes', 'ski', 'brrt', 'elon', 'fvf', 'freedom']
def cuts(n):
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'quiet', '-i', f'a2/{n}.mp4', '-vf', f"scale=320:-2,select='gt(scene,0.28)',metadata=print:file=a2/{n}.sc", '-an', '-f', 'null', '-'])
    d = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'a2/{n}.mp4']))
    c = [0.0] + [float(l.split('pts_time:')[1]) for l in open(f'a2/{n}.sc') if 'pts_time' in l] + [d]
    return n, [(round(a, 2), round(b, 2)) for a, b in zip(c, c[1:]) if b - a > 0.2]
with ThreadPoolExecutor(4) as ex: R = dict(ex.map(cuts, names))
S = []
for n in names:
    for a, b in R[n]: S.append({'id': f'{n}{len([s for s in S if s["src"] == n])}', 'src': n, 'a': a, 'b': b})
json.dump(S, open('a2shots.json', 'w'))
print({n: len(R[n]) for n in names}, len(S))
os.makedirs('a2th', exist_ok=True)
def th(s):
    subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'quiet', '-ss', str((s['a'] + s['b']) / 2), '-i', f"a2/{s['src']}.mp4", '-frames:v', '1', '-vf', 'scale=200:112:force_original_aspect_ratio=decrease,pad=200:112:(ow-iw)/2:(oh-ih)/2', f"a2th/{s['id']}.jpg"])
with ThreadPoolExecutor(4) as ex: list(ex.map(th, S))
tw, thh, cols = 200, 112, 12
for p in range(0, len(S), 132):
    P = S[p:p + 132]; rows = (len(P) + cols - 1) // cols
    B = Image.new('RGB', (cols * tw, rows * (thh + 14)), 'black'); dr = ImageDraw.Draw(B)
    for k, s in enumerate(P):
        x = (k % cols) * tw; y = (k // cols) * (thh + 14)
        if os.path.exists(f"a2th/{s['id']}.jpg"): B.paste(Image.open(f"a2th/{s['id']}.jpg"), (x, y))
        dr.text((x + 2, y + thh), f"{s['id']} {s['b'] - s['a']:.1f}", fill='yellow', font=f)
    B.save(f'a2sheet{p // 132}.jpg', quality=75)
