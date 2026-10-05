import subprocess, json, sys, os
B7 = json.load(open('beats7.json'))
V2 = '/home/claude/vv/audio/v2/'; SFX = '/home/claude/v5/sfx/'
def R(id, at, tempo=1.0, gain=1.0, trim=0.0, dur=None): return ('roll', id, at, tempo, gain, trim, dur)
def VO(name, at, tempo=1.0, gain=1.0): return ('vo', name, at, tempo, gain, 0.0, None)
def DL(f, a, b, at, gain=1.25): return ('dlg', f, at, 1.0, gain, a, b - a)
def spec(v):
    b = B7[v]['beats']
    def K(k):
        i = int(k); f = k - i; return b[i] + (b[i + 1] - b[i]) * f
    if v == '4':
        A = [VO('wa', 0.3), R(595, K(3) + 0.05), R(596, K(3) + 1.7), R(597, K(3) + 2.5), R(467, K(9) + 0.2, dur=1.55), VO('wb', K(14) + 0.05), R(358, K(17) + 0.05), R(412, K(20) + 0.05),
             R(181, K(27) + 0.05), R(182, K(27) + 1.4), R(230, K(32) + 0.3), VO('wc', K(32) + 6.6), R(345, K(48) + 0.05), R(347, K(48) + 1.2, gain=1.2), VO('x1', K(51) + 0.05, 1.17),
             VO('j09', K(59) + 0.05, 1.1), DL('dlg/crazy.mp3', 0.0, 1.95, K(64) + 0.1), DL('dlg/crazy.mp3', 2.3, 5.05, K(67) + 0.05), R(590, K(71) + 0.05), VO('x2', K(77) + 0.35, 1.0, 1.1),
             R(469, K(87) + 0.05, dur=1.5), VO('wq', K(96) + 0.3, 1.0, 1.3), R(347, K(96) + 6.4, gain=1.4)]
        cuts = [3, 9, 14, 17, 20, 23, 27, 32, 48, 51, 59, 64, 67, 71, 77, 82, 87, 91]; drops = [14, 46]; logo = K(96) + 4.2
        X = [(V2 + 'subdrop', 0.0, 0.3), ('cheer', K(48), 0.3), ('counter', K(51) + 0.05, 0.25), ('flap', K(54), 0.35), ('crash', K(57.5) - 0.05, 0.4), (V2 + 'shutter', K(64), 0.25), ('counter', K(67) + 1.25, 0.3),
             (V2 + 'swish', K(82), 0.25), (V2 + 'deepwhoosh', K(91) - 0.2, 0.3), (V2 + 'blips', K(14), 0.25)] + [('ping', K(59) + 0.05 + i * 0.17, 0.08) for i in range(12)]
    elif v == '5':
        A = [R('P0', 0.3, dur=1.5), R('T5', 2.3), R('T6', K(10) + 0.05), VO('wd', K(12) + 0.1), R('P11', K(19) + 0.05), VO('we', K(26) + 0.1), R('T7', K(35) + 0.05), VO('x3', K(43) + 0.05, 1.07),
             R('T8', K(50) + 0.05, dur=2.55), R(71, K(53) + 0.05), R(74, K(53) + 1.75), VO('x4', K(59) + 0.1, 1.0, 1.1), R('T0', K(63) + 0.05), R('T1', K(63) + 5.6, gain=1.2), R('T4', K(71) + 0.1, gain=1.3),
             R('T12', K(74) + 5.35, dur=0.62, gain=1.3), VO('wn', K(74) + 7.4, 1.0, 1.6)]
        cuts = [10, 12, 19, 22, 26, 29, 32, 35, 43, 50, 53, 59, 63, 71]; drops = [12]; logo = K(74) + 6.0
        X = [(V2 + 'deepwhoosh', K(29) - 0.2, 0.35), (V2 + 'engine', K(29), 0.2), (V2 + 'logosting', K(32), 0.3), ('counter', K(43) + 0.05, 0.25), ('flap', K(46), 0.3), ('crash', K(49.5), 0.35),
             (V2 + 'blips', K(63), 0.35), (V2 + 'blips', K(65), 0.3), (V2 + 'swish', K(22), 0.2)] + [('ping', K(12) + 0.25 + i * 0.22, 0.09) for i in range(12)] + [('chaching', K(22 + k), 0.2) for k in range(4)]
    elif v == '6':
        A = [R('E17', 0.3, gain=1.15), R('E18', K(9.5) + 0.05, gain=1.3), R('E19', K(12) + 0.05), R('E20', K(12) + 1.0, gain=1.2), VO('wf', K(16) + 0.1), R(474, K(21) + 0.05), VO('wg', K(27) + 0.1),
             R(469, K(33) + 0.3, dur=1.5), R(352, K(33) + 3.2), R('E21', K(46) + 0.2, gain=1.2), VO('j09', K(53) + 0.05, 1.1), VO('x5', K(58) + 0.05, 1.14), R(589, K(66) + 0.05, dur=1.25), R(321, K(66) + 1.5),
             VO('x6', K(72) + 0.5, 1.0, 1.1), R('E20', K(83) + 0.6, gain=1.35), VO('wo', K(83) + 5.4, 1.0, 1.5)]
        cuts = [9.5, 12, 16, 21, 27, 33, 46, 53, 58, 66, 72, 77]; drops = [51]; logo = K(83) + 5.0
        X = [('crash', K(1), 0.18), ('crash', K(3), 0.18), ('crash', K(5), 0.2), (V2 + 'blips', K(16), 0.3), ('cheer', K(46) + 1.6, 0.35), ('counter', K(58) + 0.05, 0.25), ('flap', K(61), 0.3),
             ('crash', K(64.5), 0.35), (V2 + 'deepwhoosh', K(77) - 0.2, 0.3)] + [('ping', K(53) + 0.05 + i * 0.17, 0.08) for i in range(12)]
    elif v == '7':
        A = [VO('wh', K(4) + 0.1), R(170, K(12) + 0.1), VO('wi', K(24) + 0.1), R(260, K(29) + 0.1), VO('x7', K(34) + 0.25, 1.0, 1.15), R(168, K(38) + 0.1), R(53, K(41) + 0.2),
             VO('wp', K(53) + 6.6, 1.0, 1.6), R(337, K(53) + 9.0, gain=1.3)]
        cuts = [6, 12, 18, 23, 29, 34, 38, 41, 44, 48]; drops = []; logo = K(53) + 6.0
        X = [(V2 + 'swish', K(c) - 0.1, 0.12) for c in cuts] + [(V2 + 'engine', K(38), 0.12), (V2 + 'deepwhoosh', K(44) - 0.2, 0.2)]
        cuts = []
    else:
        A = [VO('wj', K(8) + 0.2), VO('wk', K(14) + 0.1), VO('wl', K(22) + 0.1), VO('wm', K(37) + 0.05), R(589, K(45) + 0.05, dur=1.25), R(321, K(45) + 1.4), VO('j09', K(54) + 0.2, 1.1),
             R(345, K(63) + 0.05), R(346, K(63) + 1.15, gain=1.2), R(347, K(63) + 1.6, gain=1.2), VO('j08t', K(69) + 0.05, 1.08), R(348, K(81) + 0.05), R(112, K(81) + 0.9),
             VO('wn', K(111) + 5.2, 1.0, 1.6), R(347, K(111) + 8.0, gain=1.4)]
        cuts = [8, 14, 22, 33, 45, 54, 63, 69, 81, 95, 103]; drops = [37]; logo = K(111) + 4.8
        X = [(V2 + 'swish', K(14) - 0.1, 0.2), (V2 + 'swish', K(22) - 0.1, 0.2), ('counter', K(69) + 0.05, 0.25), ('flap', K(73), 0.3), ('crash', K(77.5), 0.35), ('cheer', K(63), 0.25)] + \
            [('chaching', K(87 + 2 * k), 0.22) for k in range(4)] + [('ping', K(54) + 0.05 + i * 0.17, 0.08) for i in range(12)] + [(V2 + 'blips', K(8), 0.2)]
    X += [('vhs', K(c) - 0.03, 0.2) for c in cuts]
    for d in drops: X += [(V2 + 'riser', K(d) - 3.0, 0.3), (V2 + 'revswell', K(d) - 1.5, 0.3), (V2 + 'subdrop', K(d), 0.7), (V2 + 'logosting', K(d), 0.3)]
    X += [(V2 + 'subdrop', logo, 0.6 if v != '7' else 0.35), (V2 + 'logosting', logo, 0.4 if v != '7' else 0.25)]
    return A, X
def build(v):
    cfg = B7[v]; DUR = cfg['dur']; A, X = spec(v)
    song = f"songs/{cfg['song']}.wav"
    inputs = ['-ss', str(cfg['start']), '-t', str(DUR + 0.3), '-i', song]
    SG = {'4': 1.35, '5': 1.35, '6': 1.9, '7': 1.9, '8': 1.15}[v]
    filt = [f'[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={SG},equalizer=f=60:t=q:w=1:g=2[mus]']
    vl = []
    for kind, ref, at, tempo, gain, trim, dur in A:
        if kind == 'roll': f = f'rolls/{ref}.wav' if isinstance(ref, str) else f'/home/claude/v6/rolls/L{ref}.wav'
        elif kind == 'vo': f = f'vo/{ref}.wav'
        else: f = ref
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
        ff = f if f.startswith('/') else SFX + f; ff = ff if ff.endswith('.mp3') else ff + '.mp3'
        inputs += ['-i', ff]; j = inputs.count('-i') - 1; d = int(max(0, t) * 1000)
        filt.append(f'[{j}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={vol},adelay={d}|{d}[s{j}]'); sl.append(f'[s{j}]')
    filt.append(''.join(sl) + f'amix=inputs={len(sl)}:normalize=0[sfxb]')
    filt.append(f'[musd][vo1][sfxb]amix=inputs=3:normalize=0,alimiter=limit=0.93,atrim=0:{DUR},afade=t=in:d=0.1,afade=t=out:st={DUR - 2.5}:d=2.5[out]')
    subprocess.run(['ffmpeg', '-y', '-v', 'error'] + inputs + ['-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', '-ac', '2', f'mix{v}.wav'], check=True)
    print('mix', v, DUR, len(A), len(X))
for v in (sys.argv[1:] or ['4', '5', '6', '7', '8']): build(v)
