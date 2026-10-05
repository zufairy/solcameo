import subprocess, re
B = eval(re.search(r'BEATS=(\[.*?\])', open('beats.js').read()).group(1))
def K(k):
    i = int(k); f = k - i; return B[i] + (B[min(i + 1, len(B) - 1)] - B[i]) * f
S0, DUR = 40.621, 55.6
V2 = '/home/claude/vv/audio/v2/'
# (file, trim_start, trim_end, place_at, tempo, gain)  — trim None = whole file
LINES = [
    ('dlg/money.mp3', 0.0, 1.0, 0.30, 1.0, 1.45),              # how much money you make?
    ('dlg/money.mp3', 3.0, 5.0, 2.55, 1.0, 1.45),              # how much? seventy thousand last month.
    ('dlg/money.mp3', 21.45, 23.05, K(9) + 0.05, 1.0, 1.75),   # you make 72 grand a month?
    ('dlg/money.mp3', 23.5, 24.3, K(12) - 0.05, 1.0, 1.25),    # yeah.
    ('vo/j01.wav', None, None, K(14) + 0.1, 1.15, 1.0),        # that was the old money...
    ('vo/j02.wav', None, None, K(20) + 0.05, 1.1, 1.0),        # the new money? sells attention.
    ('vo/j03.wav', None, None, K(24) + 0.08, 1.2, 1.0),        # your agent clips it...
    ('vo/j04t.wav', None, None, K(31) - 0.05, 1.12, 1.05),     # paid for every view... while you sleep
    ('vo/j06.wav', None, None, K(35) + 0.35, 1.0, 1.0),        # brief in. clips out.
    ('vo/j08t.wav', None, None, K(43) + 0.05, 1.08, 1.0),      # 5,000 videos... site went down
    ('vo/j09.wav', None, None, K(52) + 0.05, 1.1, 1.0),        # one agent, 145 countries
    ('vo/j10.wav', None, None, K(57) - 0.1, 1.0, 1.1),         # settled on solana
    ('dlg/crazy.mp3', 0.0, 1.95, K(61) + 0.1, 1.0, 1.2),       # you're looking at me like I'm crazy
    ('dlg/crazy.mp3', 2.3, 5.05, K(64) + 0.05, 1.0, 1.2),      # crazy? this is obscene
    ('dlg/delusion_iso.mp3', 0.45, 1.66, K(68) + 0.15, 1.0, 1.3),   # complete delusion.
    ('dlg/delusion_iso.mp3', 4.92, 7.16, K(70.4) + 0.1, 1.0, 1.3), # it's only delusional until it works
    ('vo/j11.wav', None, None, K(75) + 0.1, 1.0, 1.0),         # everyone's gonna say they were early
    ('vo/j12.wav', None, None, K(78.2) + 0.05, 1.0, 1.15),     # be early
    ('vo/j05.wav', None, None, K(80) + 0.1, 1.0, 1.15),        # you in?
    ('vo/j13.wav', None, None, K(84) + 0.35, 1.0, 2.4),        # vello.
]
sfx = []
def q(f, t, v): sfx.append((f, t, v))
CUTS = [4, 9, 14, 20, 24, 31, 35, 39, 43, 46, 49.5, 52, 56, 61, 64, 68, 75, 80]
for k in CUTS: q('sfx/vhs.mp3', K(k) - 0.03, 0.22)
q(V2 + 'subdrop', 0.0, 0.3)
q('sfx/chaching.mp3', K(4) + 1.4, 0.35)                     # $70,000 lands
q('sfx/chaching.mp3', K(9) + 0.2, 0.3)                      # $72,000
q(V2 + 'swish', K(20) - 0.1, 0.18)
for i in range(3): q('sfx/ping.mp3', K(24) + i * 0.9, 0.12)  # posted
q(V2 + 'riser', K(29) - 3.0, 0.35); q(V2 + 'revswell', K(29) - 1.5, 0.35)
q(V2 + 'subdrop', K(29), 0.75); q(V2 + 'logosting', K(29), 0.35); q('sfx/cheer.mp3', K(31) - 0.05, 0.32)
for i in range(4): q('sfx/vhs.mp3', K(35) + i * 0.22, 0.12)
for k in range(4): q('sfx/chaching.mp3', K(39 + k), 0.22)   # clip. post. earn. repeat.
q('sfx/counter.mp3', K(41) - 0.1, 0.3)
q('sfx/counter.mp3', K(43) + 0.05, 0.25)                    # 5,000 videos
q('sfx/flap.mp3', K(46), 0.35)                              # flip counter
q('sfx/crash.mp3', K(49.5) - 0.05, 0.4)                     # the site went down
for i in range(12): q('sfx/ping.mp3', K(52) + 0.05 + i * 0.17, 0.08)
q(V2 + 'swish', K(56) - 0.1, 0.2); q('sfx/chaching.mp3', K(57) + 0.9, 0.25)
q(V2 + 'shutter', K(61), 0.25)
q('sfx/counter.mp3', K(64) + 1.25, 0.3)
q(V2 + 'deepwhoosh', K(68) - 0.2, 0.3)
q(V2 + 'swish', K(78.2) - 0.1, 0.2)
q(V2 + 'deepwhoosh', K(84) - 0.25, 0.35); q(V2 + 'subdrop', K(84), 0.65); q(V2 + 'logosting', K(84), 0.4)

inputs = ['-ss', str(S0), '-t', str(DUR + 0.5), '-i', 'song.mp3']
filt = ['[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.2,equalizer=f=60:t=q:w=1:g=2[mus]']
vlab = []
for (f, a, b, t, tempo, gain) in LINES:
    inputs += ['-i', f]; j = inputs.count('-i') - 1; d = int(t * 1000)
    ch = f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo'
    if a is not None: ch += f',atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={b - a - 0.05}:d=0.05'
    if tempo != 1.0: ch += f',atempo={tempo}'
    if f.startswith('dlg'): ch += ',highpass=f=110,equalizer=f=2800:t=q:w=1.2:g=2.5,acompressor=threshold=0.1:ratio=3:attack=5:release=80:makeup=1.6'
    ch += f',volume={gain},adelay={d}|{d}[v{j}]'
    filt.append(ch); vlab.append(f'[v{j}]')
filt.append(''.join(vlab) + f'amix=inputs={len(vlab)}:normalize=0,highpass=f=90,equalizer=f=3200:t=q:w=1.2:g=3,equalizer=f=250:t=q:w=1:g=-2,acompressor=threshold=0.12:ratio=4:attack=4:release=90:makeup=2.2,volume=1.5,aecho=0.8:0.5:35:0.08[vob]')
filt.append('[vob]asplit=2[vo1][vosc]')
filt.append('[vosc]volume=2.0,asplit=2[sc1][sc2]')
filt.append('[mus]asplit=2[ml][mh]')
filt.append('[ml]lowpass=f=220[mlow]'); filt.append('[mh]highpass=f=220[mhigh]')
filt.append('[mhigh][sc1]sidechaincompress=threshold=0.03:ratio=6:attack=8:release=300:makeup=1[mhd]')
filt.append('[mlow][sc2]sidechaincompress=threshold=0.2:ratio=1.5:attack=10:release=300:makeup=1[mld]')
filt.append('[mld][mhd]amix=inputs=2:normalize=0[musd]')
slab = []
for (f, t, v) in sfx:
    ff = f if f.endswith('.mp3') else f + '.mp3'
    inputs += ['-i', ff]; j = inputs.count('-i') - 1; d = int(max(0, t) * 1000)
    filt.append(f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={v},adelay={d}|{d}[s{j}]'); slab.append(f'[s{j}]')
filt.append(''.join(slab) + f'amix=inputs={len(slab)}:normalize=0[sfxb]')
filt.append(f'[musd][vo1][sfxb]amix=inputs=3:normalize=0,alimiter=limit=0.93,atrim=0:{DUR},afade=t=in:d=0.15,afade=t=out:st={DUR - 1.8}:d=1.8[out]')
subprocess.run(['ffmpeg', '-y', '-v', 'error'] + inputs + ['-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', '-ac', '2', 'mix.wav'], check=True)
print('ok', len(LINES), len(sfx))
