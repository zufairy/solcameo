import sys, json, re, wave
from pocketsphinx import Decoder
def align(wav, text):
    words = [w for w in re.sub(r"[^a-z' ]", ' ', text.lower().replace('-', ' ')).split() if w]
    d = Decoder(samprate=16000, bestpath=False)
    # drop words unknown to dict
    known = [w for w in words if d.lookup_word(w) is not None]
    d.set_align_text(' '.join(known))
    with wave.open(wav) as w: raw = w.readframes(w.getnframes())
    d.start_utt(); d.process_raw(raw, full_utt=True); d.end_utt()
    out = []
    for sg in d.seg():
        if sg.word in ('<sil>', '<s>', '</s>', '[NOISE]', '(NULL)'): continue
        out.append([sg.word, round(sg.start_frame / 100, 2), round((sg.end_frame + 1) / 100, 2)])
    return out, len(words), len(known)
i = int(sys.argv[1])
res, n, k = align(f'iso/iso{i}.wav', open(f'txt/t{i}.txt').read())
json.dump(res, open(f'al{i}.json', 'w'))
print(i, n, k, len(res), res[:6], res[-3:])
