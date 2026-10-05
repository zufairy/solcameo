import subprocess, os
B0, BT = 3.224, 0.4
bt = lambda k: B0 + k * BT
A = 'audio/'; V = 'audio/v2/'
# jadoodoo original audio snippets (her real crowd/celebration sound)
JD = {'A': 0.4, 'B': 5.2, 'C': 17.6, 'D': 28.2, 'E': 32.5}
snips = {'jdC1': (JD['C'] + 1.0, 1.6), 'jdB': (JD['B'] + 1.2, 1.0), 'jdA': (JD['A'] + 0.6, 1.0), 'jdD': (JD['D'] + 0.5, 0.9),
         'jdC2': (JD['C'] + 3.4, 0.9), 'jdB2': (JD['B'] + 3.0, 0.9), 'jdC3': (JD['C'] + 1.6, 0.6), 'jdA2': (JD['A'] + 0.6, 0.5), 'jdC4': (JD['C'] + 2.6, 0.5)}
os.makedirs('audio/snip', exist_ok=True)
for k, (s, d) in snips.items():
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(s), '-t', str(d), '-i', 'audio/jd_audio.wav', '-af', f'afade=t=in:d=0.03,afade=t=out:st={d-0.12}:d=0.12', f'audio/snip/{k}.wav'], check=True)
TR = {'zoom': ('deepwhoosh', 0.55, -0.35), 'whip': ('swish', 0.6, -0.22), 'slice': ('swish', 0.5, -0.2), 'spin': ('deepwhoosh', 0.5, -0.3),
      'pixel': ('blips', 0.35, -0.12), 'glitch': ('stutter', 0.45, -0.08), 'iris': ('shutter', 0.5, -0.04), 'wipe': ('swish', 0.55, -0.22),
      'split': ('deepwhoosh', 0.45, -0.28), 'flash': ('shutter', 0.4, -0.03)}
cues = []
def q(name, t, v): cues.append((name, t, v))
# transitions from the shot list (same order as scenes2.js)
shots = [(bt(0), 'zoom'), (bt(2), 'whip'), (bt(4), 'slice'), (bt(6), 'spin'), (bt(8), 'pixel'), (bt(10), 'glitch'), (bt(12), 'iris'), (bt(14), 'wipe'), (bt(16), 'zoom'),
         (bt(32), 'flash'), (bt(36), 'slice'), (bt(38), 'whip'), (bt(40), 'spin'), (bt(42), 'split'), (bt(44), 'iris'), (bt(48), 'glitch'), (bt(52), 'zoom'), (bt(60), 'wipe'), (bt(64), 'iris'),
         (bt(80), 'glitch'), (bt(82), 'slice'), (bt(84), 'whip'), (bt(86), 'pixel'), (bt(88), 'spin'), (bt(90), 'split'), (bt(92), 'zoom'), (bt(96), 'wipe'), (bt(104), 'slice')]
mt = ['glitch', 'whip', 'zoom', 'glitch', 'spin', 'flash', 'iris', 'slice', 'glitch', 'pixel', 'wipe', 'whip', 'zoom', 'glitch', 'whip', 'flash']
shots += [(bt(112 + k), mt[k]) for k in range(16)]
for t, ty in shots:
    n, v, o = TR[ty]; q(V + n, t + o, v * (0.75 if t >= bt(112) else 1))
# intro: start lights + engine
for x in [0.62, 1.12, 1.62, 2.12, 2.62]: q(V + 'thunk', x, 0.8)
q(V + 'engine', 0.9, 0.35); q(V + 'engine', 2.1, 0.45); q(V + 'crack', B0 - 0.02, 0.55); q(V + 'subdrop', B0, 0.5)
# hook flavour
q(V + 'airgun', bt(2) + 0.05, 0.45); q(V + 'screech', bt(6), 0.4); q(V + 'blips', bt(10), 0.35); q(V + 'blips', bt(14) + 0.05, 0.3)
# screen-record
q(A + 'typing', bt(16) + 0.6, 0.45); q(V + 'shutter', bt(16) + 0.55, 0.25); q(V + 'shutter', bt(16) + 3.0, 0.25); q(V + 'blips', bt(16) + 3.05, 0.3)
q(V + 'riser', bt(32) - 3.0, 0.6); q(V + 'revswell', bt(32) - 1.5, 0.55); q(V + 'crack', bt(16) + 5.6, 0.45)
# drop
q(V + 'subdrop', bt(32), 1.0); q(A + 'impact', bt(32), 0.7); q(V + 'logosting', bt(32), 0.55); q(V + 'crack', bt(32), 0.4)
q(V + 'airgun', bt(40) + 0.05, 0.45); q(V + 'screech', bt(42), 0.3); q(V + 'subdrop', bt(44), 0.45)
# nodes
q(V + 'thunk', bt(50), 0.55); q(V + 'blips', bt(52) + 0.3, 0.3); q(V + 'blips', bt(56), 0.3)
for i in range(6): q(A + 'coin', bt(60) + 0.45 + i * 0.06, 0.22)
# globe
q(V + 'blips', bt(66), 0.3); q(V + 'blips', bt(70), 0.3); q(V + 'riser', bt(80) - 3.0, 0.4)
# native edits: her real audio under each edit + crowd
q(V + 'crowd', bt(80), 0.35)
for k, s in zip(range(80, 92, 2), ['jdC1', 'jdB', 'jdA', 'jdD', 'jdC2', 'jdB2']): q('audio/snip/' + s, bt(k), 0.6)
q(V + 'crowd', bt(92), 0.45)
# x402
for j in range(8): q(A + 'coin', bt(96 + j) + 0.5, 0.42)
for j in range(8): q(V + 'blips', bt(96) + j * BT * 0.5, 0.12)
for i in range(5): q(A + 'coin', bt(104) + 0.3 + i * 0.07, 0.25)
q(V + 'shutter', bt(104) + 1.6, 0.4)
# montage
q('audio/snip/jdC3', bt(112), 0.6); q(V + 'engine', bt(113), 0.35); q(V + 'airgun', bt(114), 0.4); q(A + 'coin', bt(116), 0.4)
q(V + 'screech', bt(117), 0.35); q('audio/snip/jdA2', bt(119), 0.55); q('audio/snip/jdC4', bt(124), 0.55); q(V + 'crack', bt(126), 0.4)
# outro
q(V + 'subdrop', bt(128), 0.9); q(V + 'logosting', bt(128), 0.75); q(V + 'crack', bt(128), 0.25)

inputs = ['-i', A + 'track.mp3']; filt = ['[0:a]volume=0.8[m]']; labels = ['[m]']
for (n, t, v) in cues:
    f = n if n.endswith('.wav') or n.endswith('.mp3') else (n + ('.wav' if 'snip' in n else '.mp3'))
    inputs += ['-i', f]; j = len(inputs) // 2 - 1; d = int(max(0, t) * 1000)
    filt.append(f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={v},adelay={d}|{d}[s{j}]'); labels.append(f'[s{j}]')
filt.append(''.join(labels) + f'amix=inputs={len(labels)}:normalize=0:dropout_transition=0,acompressor=threshold=0.5:ratio=3:attack=5:release=120,alimiter=limit=0.95,atrim=0:60,afade=t=out:st=59.2:d=0.8[out]')
subprocess.run(['ffmpeg', '-y', '-v', 'error'] + inputs + ['-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', '-ac', '2', 'mix2.wav'], check=True)
print('ok', len(cues))
