"""Original 128 BPM launch score and synchronized sound design. No samples."""
import numpy as np, wave, pathlib
SR=48000; D=30; beat=60/128
rng=np.random.default_rng(42); music=np.zeros((int(SR*D),2),dtype=np.float64)
def add(x,start,pan=0,vol=1):
    i=int(start*SR); n=min(len(x),len(music)-i)
    if n<=0 or i<0:return
    music[i:i+n,0]+=x[:n]*vol*np.sqrt((1-pan)/2)
    music[i:i+n,1]+=x[:n]*vol*np.sqrt((1+pan)/2)
def tone(note,dur,kind='pluck'):
    t=np.arange(int(SR*dur))/SR; hz=440*2**((note-69)/12)
    if kind=='bass':
        x=np.sin(2*np.pi*hz*t)+.3*np.sin(4*np.pi*hz*t)
        env=(1-np.exp(-t*100))*np.exp(-t*5)
    else:
        x=np.sin(2*np.pi*hz*t)+.35*np.sin(2*np.pi*hz*2*t)+.12*np.sin(2*np.pi*hz*3*t)
        env=(1-np.exp(-t*300))*np.exp(-t*8)
    return x*env
chords=[[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,67]]
mel=[76,79,83,79,76,74,72,74,76,79,84,83,79,76,74,72]
for b in range(64):
    start=b*beat
    if start>=D:break
    active=start>=3.75 and start<26.25
    t=np.arange(int(.38*SR))/SR
    freq=45+115*np.exp(-t*40); phase=2*np.pi*np.cumsum(freq)/SR
    kick=np.sin(phase)*np.exp(-t*13)+rng.normal(0,1,len(t))*np.exp(-t*350)*.06
    if active or b%4==0:add(kick,start,vol=.62 if active else .4)
    if active and b%2==1:
        t=np.arange(int(.17*SR))/SR; n=rng.normal(0,1,len(t)); n=n-np.roll(n,1)
        add(n*np.exp(-t*25)*(.65+.35*np.cos(2*np.pi*70*t)),start,vol=.10)
    if active:
        for off in [0,.5]:
            t=np.arange(int(.085*SR))/SR; n=rng.normal(0,1,len(t)); n=n-np.roll(n,1)
            add(n*np.exp(-t*75),start+beat*off,pan=(-.4 if off==0 else .4),vol=.032 if off==0 else .052)
    chord=chords[(b//8)%4]
    if active:
        add(tone(chord[0]-24,.35,'bass'),start,vol=.31)
        add(tone(chord[0]-12,.25,'bass'),start+beat*.75,vol=.11)
    for off in [0,.5]:
        note=chord[(b*2+int(off*2))%4]+12
        x=tone(note,.65)
        add(x,start+beat*off,pan=np.sin(b)*.45,vol=.13 if active else .12)
        add(x,start+beat*off+beat*.75,pan=-np.sin(b)*.7,vol=.035)
    if b%2==0:
        x=tone(mel[(b//2)%len(mel)],.6)
        add(x,start,pan=.12,vol=.21 if start>=9.375 else .14)
    if b%8==0:
        t=np.arange(int(beat*8*SR))/SR
        pad=sum(np.sin(2*np.pi*(440*2**((n-69)/12))*t) for n in chord)/4
        env=np.minimum(t*3,1)*np.minimum((beat*8-t)*2,1)*.055
        add(pad*env,start,pan=-.25)
for cut in [0,3.75,9.375,15,20.625,26.25]:
    # Sparkly three-note UI pop.
    for k,n in enumerate([84,88,91]):add(tone(n,.35),cut+k*.055,pan=(k-1)*.4,vol=.2)
    if cut>0:
        t=np.arange(int(.5*SR))/SR; noise=rng.normal(0,1,len(t)); noise=np.convolve(noise,np.ones(13)/13,mode='same')
        env=(t/.5)**2*np.sin(np.pi*t/.5)
        add(noise*env,cut-.5,pan=-.2,vol=.28)
    if cut==15:
        t=np.arange(int(1.3*SR))/SR
        add(np.sin(2*np.pi*(140*t-38*t*t))*np.exp(-t*6),cut,vol=.5)
# Closing brand signature: major ninth arpeggio + gentle audio resolve.
for k,n in enumerate([72,76,79,83,84]):add(tone(n,1.1),26.25+k*.15,pan=(k-2)*.2,vol=.24)
fade=np.minimum(np.arange(len(music))/SR/.025,1)*np.minimum((D-np.arange(len(music))/SR)/.7,1)
music=np.tanh(music*1.5)*fade[:,None]
music*=.89/max(np.max(np.abs(music)),.001)
out=pathlib.Path(__file__).resolve().parents[2]/'public/solcameo-launch/score.wav'
with wave.open(str(out),'wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((music*32767).astype('<i2').tobytes())
print(out)
