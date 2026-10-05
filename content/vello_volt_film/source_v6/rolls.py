import json, re, subprocess, os
L = json.load(open('lines.json')); AL = {i: json.load(open(f'al{i}.json')) for i in range(9)}
IDS = [5, 6, 11, 12, 17, 18, 52, 58, 71, 73, 74, 81, 82, 84, 85, 86, 106, 109, 112, 168, 169, 183, 226, 227, 262, 271, 272, 277, 307, 318, 358, 383, 504, 505, 506, 507, 509, 510, 512, 538, 582, 609, 612]
os.makedirs('rolls', exist_ok=True); W = {}
for i in IDS:
    x = L[i]; c = x['c']; words = [w for w in re.sub(r"[^a-z0-9%' ]", ' ', x['t'].lower().replace('-', ' ')).split() if w]
    # find aligned words in this chunk by time window
    seg = [w for w in AL[c] if w[1] >= x['s'] - c * 240 - 0.01 and w[2] <= x['e'] - c * 240 + 0.01]
    s0 = x['s'] - c * 240
    tw = [[words[k] if k < len(words) else w[0], round(w[1] - s0, 2), round(w[2] - s0, 2)] for k, w in enumerate(seg[:len(words)])]
    W[i] = {'t': x['t'], 'd': round(x['e'] - x['s'], 2), 'w': tw}
    subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'quiet', '-ss', str(max(0, s0 - 0.06)), '-t', str(x['e'] - x['s'] + 0.2), '-i', f'iso/iso{c}.mp3', '-af', 'afade=t=in:d=0.03,areverse,afade=t=in:d=0.08,areverse', '-ar', '48000', f'rolls/L{i}.wav'])
open('words.js', 'w').write('window.WORDS=' + json.dumps(W) + ';'); json.dump(W, open('words.json', 'w'))
for i in IDS: print(i, W[i]['d'], len(W[i]['w']), W[i]['t'][:60])
