import subprocess
K = lambda k: 0.599 + 0.5785 * k
V = '/home/claude/vv/audio/v2/'
cues = []
q = lambda n, t, v: cues.append((V + n + '.mp3', t, v))
for i in range(10): q('shutter', i * 0.5785 / 2, 0.12)
q('swish', K(4) - 0.15, 0.25); q('swish', K(8) - 0.15, 0.25)
q('stutter', K(10) - 0.08, 0.22); q('deepwhoosh', K(13) - 0.3, 0.35); q('swish', K(14) - 0.12, 0.2); q('swish', K(16) - 0.15, 0.2)
for i, k in enumerate([18, 20, 22, 24]): q('thunk', K(k), 0.32)
for i in range(10): q('blips', K(26) + i * 0.17, 0.07)
q('shutter', K(30), 0.35); q('deepwhoosh', K(36) + 0.35, 0.38); q('thunk', K(36) + 0.72, 0.35)
q('logosting', K(38), 0.45); q('swish', K(41) - 0.1, 0.25); q('shutter', K(44), 0.25); q('deepwhoosh', K(45.5) - 0.2, 0.3)
q('subdrop', K(47), 0.45)
for k in [52, 56, 59, 62, 67]: q('swish', K(k) - 0.12, 0.2)
for i in range(5): q('swish', K(70) + i * 0.12, 0.14)
q('deepwhoosh', K(78) - 0.05, 0.45); q('subdrop', K(79), 0.55); q('logosting', K(79), 0.4)
inputs = ['-i', 'audio/track_v3b.mp3']; filt = ['[0:a]atrim=0:48.6,volume=0.9[m]']; labels = ['[m]']
for (f, t, v) in cues:
    inputs += ['-i', f]; j = len(inputs) // 2 - 1; d = int(max(0, t) * 1000)
    filt.append(f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={v},adelay={d}|{d}[s{j}]'); labels.append(f'[s{j}]')
filt.append(''.join(labels) + f'amix=inputs={len(labels)}:normalize=0:dropout_transition=0,alimiter=limit=0.95,atrim=0:48.6,afade=t=out:st=47.4:d=1.2[out]')
subprocess.run(['ffmpeg', '-y', '-v', 'error'] + inputs + ['-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', '-ac', '2', 'mix.wav'], check=True)
print('ok', len(cues))
