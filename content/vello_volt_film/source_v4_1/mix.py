import subprocess, json
B = json.loads(open('beats.js').read().split('=')[1].split(';')[0])
def K(k):
    i = int(k); f = k - i; return B[i] + (B[min(i + 1, len(B) - 1)] - B[i]) * f
S0, DUR = 81.874, 47.0
V2 = '/home/claude/vv/audio/v2/'
# voice-over placement: (file, start, tempo)
VO = [('vo01', 0.45, 1.0), ('vo02', K(8) + 0.05, 1.2), ('vo03', 7.0, 1.1), ('vo05', 11.0, 1.1), ('vo06', 13.75, 1.3), ('vo07', 15.62, 1.35),
      ('vo08', 18.1, 1.0), ('vo09', K(40) + 0.05, 1.1), ('vo10', 25.0, 1.0), ('vo11', 26.9, 1.1), ('vo12', 29.9, 1.0), ('vo13', 31.7, 1.0),
      ('vo18', K(62) + 0.05, 1.0), ('vo19', K(70) - 0.3, 1.15), ('vo16', K(76) + 0.1, 1.0), ('vo17', 44.9, 1.0)]
sfx = []
def q(f, t, v): sfx.append((f, t, v))
for i in range(16): q('sfx/glass.mp3', i * 0.5573 / 2, 0.14 if i % 2 else 0.2)       # glass plates stacking
q(V2 + 'subdrop', 0.0, 0.35)
for k in [8, 12, 16, 24, 28]: q('sfx/vhs.mp3', K(k) - 0.03, 0.28)                       # tracking glitch on cuts
q(V2 + 'stutter', K(14) - 0.06, 0.2); q(V2 + 'deepwhoosh', K(17) - 0.25, 0.3)
q(V2 + 'swish', K(20) - 0.1, 0.18); q(V2 + 'swish', K(22) - 0.1, 0.18)
for i in range(10): q('sfx/ping.mp3', K(24) + i * 0.17, 0.10)                           # icons appear
q(V2 + 'shutter', K(28), 0.3); q(V2 + 'riser', K(32) - 3.0, 0.35); q(V2 + 'revswell', K(32) - 1.5, 0.35)
q(V2 + 'subdrop', K(32), 0.7); q(V2 + 'logosting', K(32), 0.35)
q(V2 + 'swish', K(36) - 0.1, 0.25)
for k in [40, 44, 48, 52, 56, 60, 62]: q('sfx/vhs.mp3', K(k) - 0.03, 0.25)
for i in range(4): q('sfx/vhs.mp3', K(44) + i * 0.28, 0.15); q('sfx/vhs.mp3', K(48) + i * 0.28, 0.15)  # thumbnail glitches
for i in range(12): q('sfx/ping.mp3', K(62) + 0.15 + i * 0.5573 * 0.9, 0.08)              # map pins pop
q(V2 + 'deepwhoosh', K(78) - 0.2, 0.35); q(V2 + 'subdrop', K(80), 0.6); q(V2 + 'logosting', K(80), 0.35)

inputs = ['-ss', str(S0), '-t', str(DUR + 0.5), '-i', 'song.mp3']
filt = ['[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.25,equalizer=f=60:t=q:w=1:g=2[mus]']
vlab = []
for (n, t, tempo) in VO:
    inputs += ['-i', f'vo/{n}.wav']; j = inputs.count('-i') - 1; d = int(t * 1000)
    gain = {'vo06': 1.6, 'vo17': 2.4, 'vo08': 1.3}.get(n, 1.0)
    chain = f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo' + (f',atempo={tempo}' if tempo != 1.0 else '') + f',volume={gain},adelay={d}|{d}[v{j}]'
    filt.append(chain); vlab.append(f'[v{j}]')
# VO bus: clean-up EQ, presence, compression, short room
filt.append(''.join(vlab) + f'amix=inputs={len(vlab)}:normalize=0,highpass=f=90,equalizer=f=3200:t=q:w=1.2:g=3,equalizer=f=250:t=q:w=1:g=-2,acompressor=threshold=0.12:ratio=4:attack=4:release=90:makeup=2.2,volume=1.45,aecho=0.8:0.5:35:0.10[vob]')
filt.append('[vob]asplit=2[vo1][vosc]')
# music ducks under the voice (sidechain)
filt.append('[vosc]volume=2.0,asplit=2[sc1][sc2]')
filt.append('[mus]asplit=2[ml][mh]')
filt.append('[ml]lowpass=f=220[mlow]')
filt.append('[mh]highpass=f=220[mhigh]')
filt.append('[mhigh][sc1]sidechaincompress=threshold=0.03:ratio=6:attack=8:release=300:makeup=1[mhd]')
filt.append('[mlow][sc2]sidechaincompress=threshold=0.2:ratio=1.5:attack=10:release=300:makeup=1[mld]')
filt.append('[mld][mhd]amix=inputs=2:normalize=0[musd]')
slab = []
for (f, t, v) in sfx:
    ff = f if f.endswith('.mp3') else f + '.mp3'
    inputs += ['-i', ff]; j = inputs.count('-i') - 1; d = int(max(0, t) * 1000)
    filt.append(f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={v},adelay={d}|{d}[s{j}]'); slab.append(f'[s{j}]')
filt.append(''.join(slab) + f'amix=inputs={len(slab)}:normalize=0[sfxb]')
filt.append(f'[musd][vo1][sfxb]amix=inputs=3:normalize=0,alimiter=limit=0.93,atrim=0:{DUR},afade=t=in:d=0.02,afade=t=out:st={DUR-1.6}:d=1.6[out]')
subprocess.run(['ffmpeg', '-y', '-v', 'error'] + inputs + ['-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', '-ac', '2', 'mix.wav'], check=True)
print('ok', len(VO), len(sfx))
