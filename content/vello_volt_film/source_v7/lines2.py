import json, re, difflib
L = {}
for n, pre in [('elon', 'E'), ('tgm', 'T'), ('pplan', 'P'), ('fvf', 'F')]:
    txt = open(f'txt/{n}.txt').read(); al = json.load(open(f'al_{n}.json'))
    toks = [w[0] for w in al]
    sents = re.split(r'(?<=[.!?])\s+', txt.strip()); allw = []; sid = []
    for k, s in enumerate(sents):
        ws = [w for w in re.sub(r"[^a-z0-9' ]", ' ', s.lower().replace('-', ' ')).split() if w]; allw += ws; sid += [k] * len(ws)
    sm = difflib.SequenceMatcher(a=allw, b=toks, autojunk=False); M = {}
    for a, b, c in sm.get_matching_blocks():
        for j in range(c): M[a + j] = b + j
    for k, s in enumerate(sents):
        idx = [M[i] for i in range(len(allw)) if sid[i] == k and i in M]
        if not idx: continue
        w = [[al[i][0], al[i][1], al[i][2]] for i in range(min(idx), max(idx) + 1)]
        L[f'{pre}{k}'] = {'src': n, 's': w[0][1], 'e': w[-1][2], 't': s, 'w': w}
json.dump(L, open('lines2.json', 'w'))
for k, v in L.items(): print(f"{k}|{v['s']:.1f}|{v['e']-v['s']:.1f}|{v['t'][:90]}")
