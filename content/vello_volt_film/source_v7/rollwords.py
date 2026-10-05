import json, re, wave, subprocess, sys
from pocketsphinx import Decoder
L = json.load(open('lines2.json')); W = {}
def align_file(wav, text):
    words = [w for w in re.sub(r"[^a-z0-9' ]", ' ', text.lower().replace('-', ' ')).split() if w]
    subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'quiet', '-i', wav, '-ac', '1', '-ar', '16000', '/tmp/claude-0/a16.wav'])
    d = Decoder(samprate=16000); kn = [w for w in words if d.lookup_word(w) is not None]; d.set_align_text(' '.join(kn))
    with wave.open('/tmp/claude-0/a16.wav') as w: raw = w.readframes(w.getnframes())
    d.start_utt(); d.process_raw(raw, full_utt=True); d.end_utt()
    seg = [s for s in (d.seg() or []) if not s.word.startswith(('<', '[', '('))]
    return [[re.sub(r'\(\d+\)$', '', s.word), round(s.start_frame / 100, 2), round((s.end_frame + 1) / 100, 2)] for s in seg], words
for i in sys.argv[1:]:
    txt = re.sub(r'\[.*?\]', '', L[i]['t']).replace('Seashell', 'Shelby')
    w, words = align_file(f'rolls/{i}.wav', txt)
    if not w: print('FAIL', i); continue
    a, b = max(0, w[0][1] - 0.06), w[-1][2] + 0.12
    subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'quiet', '-i', f'rolls/{i}.wav', '-ss', str(a), '-to', str(b), '-af', 'afade=t=in:d=0.02,areverse,afade=t=in:d=0.06,areverse', f'rolls/{i}_t.wav'])
    subprocess.run(['mv', f'rolls/{i}_t.wav', f'rolls/{i}.wav'])
    W[i] = {'t': txt, 'd': round(b - a, 2), 'w': [[x[0], round(x[1] - a, 2), round(x[2] - a, 2)] for x in w]}
    print(i, W[i]['d'], len(W[i]['w']), '/', len(words))
old = json.load(open('words7.json')) if __import__('os').path.exists('words7.json') else {}
old.update(W); json.dump(old, open('words7.json', 'w'))
