import json, re
L = []
for i in range(9):
    txt = open(f'txt/t{i}.txt').read(); al = json.load(open(f'al{i}.json'))
    # sentences from original text, mapped by word counts
    sents = re.split(r'(?<=[.!?])\s+', txt.strip()); wi = 0
    for s in sents:
        n = len([w for w in re.sub(r"[^a-z' ]", ' ', s.lower().replace('-', ' ')).split() if w])
        if n == 0: continue
        seg = al[wi:wi + n]; wi += n
        if not seg: continue
        L.append({'id': len(L), 'c': i, 's': round(i * 240 + seg[0][1], 2), 'e': round(i * 240 + seg[-1][2], 2), 'n': n, 't': s,
                  'interp': sum(1 for x in seg if len(x) > 3) / len(seg)})
json.dump(L, open('lines.json', 'w'), indent=0)
for x in L:
    if x['n'] <= 16: print(f"{x['id']}|{x['s']:.1f}|{x['e']-x['s']:.1f}|{x['t']}")
