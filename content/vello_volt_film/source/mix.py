import subprocess
B0,BT=3.224,0.4
bt=lambda k:B0+k*BT
P=lambda i:bt(16*i)
cues=[]
for x in [0.62,1.12,1.62,2.12,2.62]: cues.append(('beep',x,0.55))
for k in range(0,16,2): cues.append(('whoosh',bt(k)-0.12,0.5))
for k in [38,40,42,44,48,50,52,60,64,66,88,90,92,94,104,106]: cues.append(('whoosh',bt(k)-0.12,0.45))
for k in range(80,88): cues.append(('whoosh',bt(k)-0.1,0.3))
for k in range(112,128): cues.append(('whoosh' if k%2 else 'glitch',bt(k)-0.08,0.3))
cues+= [('impact',B0,0.5),('impact',P(2),1.0),('impact',P(8),1.0),('impact',P(1)+5.6,0.45)]
cues+= [('glitch',bt(10),0.5),('glitch',bt(36),0.5),('glitch',P(3),0.5),('glitch',P(6),0.5)]
cues+= [('flyby',bt(4)-0.3,0.55),('flyby',bt(113)-0.5,0.5)]
cues+= [('typing',P(1)+0.6,0.45)]
cues+= [('coin',bt(96+j)+0.5,0.45) for j in range(8)] + [('coin',bt(120),0.5),('coin',P(3)+0.4+0.35*1,0.0)]
cues+= [('coin',bt(60)+0.35+i*0.07,0.3) for i in range(6)]
inputs=['-i','audio/track.mp3']; filt=[]; labels=['[m]']
filt.append('[0:a]volume=0.82[m]')
for i,(n,t,v) in enumerate(cues):
    if v<=0: continue
    inputs+=['-i',f'audio/{n}.mp3']; j=len(inputs)//2-1
    d=int(max(0,t)*1000)
    filt.append(f'[{j}:a]volume={v},adelay={d}|{d}[s{j}]'); labels.append(f'[s{j}]')
filt.append(''.join(labels)+f'amix=inputs={len(labels)}:normalize=0:dropout_transition=0,alimiter=limit=0.95,atrim=0:60[out]')
cmd=['ffmpeg','-y','-v','error']+inputs+['-filter_complex',';'.join(filt),'-map','[out]','-ar','48000','-ac','2','mix.wav']
subprocess.run(cmd,check=True); print('ok',len(labels))
