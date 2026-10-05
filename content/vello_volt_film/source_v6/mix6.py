import subprocess, json, sys
ALL = json.load(open('beats_all.json'))
V2 = '/home/claude/vv/audio/v2/'; SFX = '/home/claude/v5/sfx/'
def grid(S0):
    B = [x - S0 for x in ALL if x >= S0 - 0.02]
    def K(k):
        i = int(k); f = k - i; return B[i] + (B[i + 1] - B[i]) * f
    return K
# audio item: (kind, ref, at, tempo, gain, trim, dur)
def R(id, at, tempo=1.0, gain=1.0, trim=0.0, dur=None): return ('roll', id, at, tempo, gain, trim, dur)
def VO(name, at, tempo=1.0, gain=1.0): return ('vo', name, at, tempo, gain, 0.0, None)
def DL(f, a, b, at, gain=1.3): return ('dlg', f, at, 1.0, gain, a, b - a)
def spec(v):
    if v == '1':
        S0 = 40.621; K = grid(S0); DUR = K(100) + 0.3
        A = [DL('dlg/money.mp3', 0.0, 1.0, 0.30, 1.45), DL('dlg/money.mp3', 3.0, 5.0, K(4) + 0.14, 1.45), DL('dlg/money.mp3', 21.45, 23.05, K(9) + 0.05, 1.75), DL('dlg/money.mp3', 23.5, 24.3, K(12) - 0.05, 1.25),
             R(168, K(14) + 0.1), R(71, K(14) + 2.0), VO('j02', K(20) + 0.05, 1.1), VO('j03', K(24) + 0.08, 1.2), VO('j04t', K(31) - 0.05, 1.12, 1.05), VO('j06', K(35) + 0.35),
             R(106, K(39) + 0.35, trim=0.3), VO('j08t', K(48) + 0.05, 1.08), VO('j09', K(57) + 0.05, 1.1), VO('j10', K(62) - 0.1, 1.0, 1.1),
             DL('dlg/crazy.mp3', 0.0, 1.95, K(65) + 0.1, 1.2), DL('dlg/crazy.mp3', 2.3, 5.05, K(68) + 0.05, 1.2), DL('dlg/delusion_iso.mp3', 0.45, 1.66, K(72) + 0.15), DL('dlg/delusion_iso.mp3', 4.92, 7.16, K(72) + 1.65),
             R(538, K(79) + 0.05, dur=3.3), R(509, K(85) + 0.05), R(510, K(85) + 0.9), VO('j05', K(87.5) + 0.05, 1.0, 1.15), VO('n9', K(89) + 0.3, 1.0, 1.8), R(168, K(93) + 0.2, 1.0, 1.15)]
        cuts = [4, 9, 12, 14, 20, 24, 31, 35, 39, 44, 48, 57, 61, 65, 68, 72, 79, 85]; drop = 29; end = 89
        X = [('chaching', K(4) + 1.4, 0.35), ('chaching', K(9) + 0.2, 0.3), (V2 + 'swish', K(20) - 0.1, 0.18), ('cheer', K(31) - 0.05, 0.32)] + [('ping', K(24) + i * 0.9, 0.12) for i in range(3)] + \
            [('chaching', K(44 + k), 0.22) for k in range(4)] + [('counter', K(48) + 0.05, 0.25), ('flap', K(51), 0.35), ('crash', K(54.5) - 0.05, 0.4)] + [('ping', K(57) + 0.05 + i * 0.17, 0.08) for i in range(12)] + \
            [(V2 + 'swish', K(61) - 0.1, 0.2), (V2 + 'shutter', K(65), 0.25), ('counter', K(68) + 1.25, 0.3), (V2 + 'deepwhoosh', K(72) - 0.2, 0.3), ('counter', K(39), 0.18)]
    elif v == '2':
        S0 = 146.24; K = grid(S0); DUR = K(92) + 0.4
        A = [R(17, 0.3), R(18, K(9.5) + 0.05, dur=1.2), R(226, K(12) + 0.05), R(227, K(12) + 1.9), VO('n1', K(19.5) + 0.05, 1.08), R(84, K(27) + 0.02, gain=1.2), R(85, K(27) + 0.35, 1.1, 1.2),
             VO('n3', K(31) + 0.1), R(106, K(35) + 0.35, trim=0.3), VO('n2', K(40) + 0.1), VO('n4', K(50) + 0.05, 1.1), R(505, K(56) + 0.1), R(277, K(62) + 0.05 - 0.25, trim=0.65), R(11, K(62) + 2.75),
             VO('n5', K(69) + 0.3), R(609, K(74) + 0.05), R(183, K(74) + 1.45), VO('j05', K(78) + 0.1, 1.0, 1.15), R(307, K(82) + 0.15, gain=1.25), VO('j13', K(86) + 0.1, 1.0, 2.4)]
        cuts = [9.5, 12, 19.5, 27, 31, 35, 40, 46, 50, 56, 62, 69, 74, 78]; drop = 29; end = 82
        X = [(V2 + 'subdrop', 0.0, 0.3), (V2 + 'deepwhoosh', K(9.5) - 0.2, 0.2), (V2 + 'stutter', K(27) - 0.05, 0.25)] + [('ping', K(31) + i * 0.5, 0.1) for i in range(3)] + \
            [('chaching', K(46 + k), 0.22) for k in range(4)] + [('ping', K(50) + 0.05 + i * 0.2, 0.08) for i in range(12)] + [(V2 + 'swish', K(69) - 0.1, 0.2), (V2 + 'shutter', K(78), 0.25)]
    else:
        S0 = 118.03; K = grid(S0); DUR = K(92) + 0.5
        A = [DL('dlg/billion.wav', 0.25, 2.3, 0.35, 1.5), DL('dlg/billion.wav', 5.75, 6.85, K(4) + 0.15, 1.5), VO('n6', K(6.5) + 0.05), VO('n7', K(15) + 0.05), R(538, K(19) + 0.05, dur=3.3),
             VO('n8', K(25) + 0.05, 1.1), R(71, K(34) + 0.05), R(74, K(34) + 1.75), VO('j10', K(42), 1.0, 1.1), R(262, K(46.6) + 0.2), R(582, K(52) + 0.1 - 0.25, trim=0.55), VO('j11', K(52) + 5.5),
             R(383, K(64) + 0.1), R(5, K(64) + 2.5), VO('j12', K(72) + 0.3, 1.0, 1.2), R(271, K(76) + 0.05), R(272, K(76) + 2.2, gain=1.15, dur=0.85), VO('j13', K(81) + 0.3, 1.0, 2.4), R(58, K(85) + 0.1, gain=1.4)]
        cuts = [4, 6.5, 15, 19, 25, 34, 41.5, 46.6, 52, 64, 72]; drop = 13; end = 81
        X = [(V2 + 'screech', K(15) - 0.1, 0.18), (V2 + 'deepwhoosh', K(15) - 0.25, 0.3)] + [('ping', K(25) + 0.05 + i * 0.3, 0.08) for i in range(12)] + [(V2 + 'swish', K(41.5) - 0.1, 0.2)] + \
            [(V2 + 'riser', K(76) - 3.0, 0.35), (V2 + 'revswell', K(76) - 1.5, 0.35), (V2 + 'subdrop', K(76), 0.7), ('cheer', K(76) + 0.05, 0.3)]
    # common: glitch on cuts, the drop, the flashy ending
    X += [('vhs', K(c) - 0.03, 0.22) for c in cuts]
    X += [(V2 + 'riser', K(drop) - 3.0, 0.35), (V2 + 'revswell', K(drop) - 1.5, 0.35), (V2 + 'subdrop', K(drop), 0.75), (V2 + 'logosting', K(drop), 0.35)]
    X += [(V2 + 'deepwhoosh', K(end) - 0.25, 0.35), (V2 + 'subdrop', K(end), 0.7), (V2 + 'logosting', K(end), 0.45)] + [(V2 + 'thunk', K(end + k), 0.35) for k in range(1, 4)] + \
         [('vhs', K(end + k) + 0.3, 0.18) for k in range(4)] + [(V2 + 'crack', K(end + 4), 0.3), (V2 + 'logosting', K(end + 4), 0.25)]
    return S0, DUR, A, X
def build(v):
    S0, DUR, A, X = spec(v)
    inputs = ['-ss', str(S0), '-t', str(DUR + 0.5), '-i', 'song.mp3']
    filt = ['[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.2,equalizer=f=60:t=q:w=1:g=2[mus]']
    vl = []
    for kind, ref, at, tempo, gain, trim, dur in A:
        f = f'rolls/L{ref}.wav' if kind == 'roll' else f'vo/{ref}.wav' if kind == 'vo' else ref
        inputs += ['-i', f]; j = inputs.count('-i') - 1; d = int(max(0, at) * 1000)
        ch = f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo'
        if trim or dur: ch += f',atrim={trim}' + (f':{trim + dur}' if dur else '') + ',asetpts=PTS-STARTPTS,afade=t=in:d=0.02'
        if tempo != 1.0: ch += f',atempo={tempo}'
        if kind in ('roll', 'dlg'): ch += ',highpass=f=110,equalizer=f=2800:t=q:w=1.2:g=2.5,acompressor=threshold=0.1:ratio=3:attack=5:release=80:makeup=1.6'
        ch += f',volume={gain * (1.15 if kind == "roll" else 1.0)},adelay={d}|{d}[v{j}]'; filt.append(ch); vl.append(f'[v{j}]')
    filt.append(''.join(vl) + f'amix=inputs={len(vl)}:normalize=0,highpass=f=90,equalizer=f=3200:t=q:w=1.2:g=3,equalizer=f=250:t=q:w=1:g=-2,acompressor=threshold=0.12:ratio=4:attack=4:release=90:makeup=2.2,volume=1.5,aecho=0.8:0.5:35:0.08[vob]')
    filt += ['[vob]asplit=2[vo1][vosc]', '[vosc]volume=2.0,asplit=2[sc1][sc2]', '[mus]asplit=2[ml][mh]', '[ml]lowpass=f=220[mlow]', '[mh]highpass=f=220[mhigh]',
             '[mhigh][sc1]sidechaincompress=threshold=0.03:ratio=6:attack=8:release=300:makeup=1[mhd]', '[mlow][sc2]sidechaincompress=threshold=0.2:ratio=1.5:attack=10:release=300:makeup=1[mld]', '[mld][mhd]amix=inputs=2:normalize=0[musd]']
    sl = []
    for f, t, vol in X:
        ff = f if f.startswith('/') else SFX + f
        ff = ff if ff.endswith('.mp3') else ff + '.mp3'
        inputs += ['-i', ff]; j = inputs.count('-i') - 1; d = int(max(0, t) * 1000)
        filt.append(f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={vol},adelay={d}|{d}[s{j}]'); sl.append(f'[s{j}]')
    filt.append(''.join(sl) + f'amix=inputs={len(sl)}:normalize=0[sfxb]')
    filt.append(f'[musd][vo1][sfxb]amix=inputs=3:normalize=0,alimiter=limit=0.93,atrim=0:{DUR},afade=t=in:d=0.12,afade=t=out:st={DUR - 2.0}:d=2.0[out]')
    subprocess.run(['ffmpeg', '-y', '-v', 'error'] + inputs + ['-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', '-ac', '2', f'mix{v}.wav'], check=True)
    print('mix', v, round(DUR, 2), len(A), len(X))
for v in (sys.argv[1:] or ['1', '2', '3']): build(v)
