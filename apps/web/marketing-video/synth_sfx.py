import numpy as np, scipy.io.wavfile as wav

sr=44100; DUR=12.10
N=int(sr*DUR); buf=np.zeros(N)
FPB=60*60/126.0

def place(t, sig):
    i=int(t*sr); j=min(N, i+len(sig))
    if i<N: buf[i:j]+=sig[:j-i]

def boom(f0,f1,dur,gain):
    t=np.linspace(0,dur,int(sr*dur),False)
    freq=f0*(f1/f0)**(t/dur)
    ph=2*np.pi*np.cumsum(freq)/sr
    env=np.exp(-t/(dur*0.32))
    s=np.tanh(1.6*np.sin(ph))*env*gain
    return s

def click(gain,dur=0.018):
    t=np.linspace(0,dur,int(sr*dur),False)
    return (np.random.randn(len(t)))*np.exp(-t/(dur*0.3))*gain

def riser(dur,gain):
    n=int(sr*dur); t=np.linspace(0,1,n,False)
    noise=np.random.randn(n)
    # emphasize highs by differencing, rising env
    hp=np.diff(noise, prepend=noise[0])
    env=t**2.2
    # add rising tone
    freq=200*(6**t)
    ph=2*np.pi*np.cumsum(freq)/sr
    tone=0.4*np.sin(ph)
    return (hp*0.7+tone)*env*gain

def whoosh(dur,gain):
    n=int(sr*dur); t=np.linspace(0,1,n,False)
    noise=np.random.randn(n)
    env=np.sin(np.pi*t)
    return noise*env*gain*0.5

def rnd(fr): return round(fr*FPB)

# slam impacts
for k,b in enumerate(range(1,9)):
    t=rnd(b)/60.0; lead=(b==1)
    place(t, boom(72,44,0.30, 0.95 if lead else 0.62))
    place(t, click(0.5 if lead else 0.34))
for b in range(14,18):
    t=rnd(b)/60.0
    place(t, boom(76,48,0.26,0.7)); place(t, click(0.34))

# TV on boom
place(0.0, boom(58,38,0.42,0.85))
# riser into first drop
place(max(0.0, rnd(1)/60.0-0.46), riser(0.46,0.55))
# riser + static whoosh into channel switch
place(5.717-0.5, riser(0.5,0.6))
place(5.717, whoosh(0.55,0.7))
# riser into weekly drop (beat14)
place(rnd(14)/60.0-0.46, riser(0.46,0.55))
# TV off descending boom
place(11.517, boom(60,30,0.6,0.8))

# soft limit
buf=np.tanh(1.15*buf)
buf=buf/ (np.max(np.abs(buf))+1e-9) * 0.95
stereo=np.stack([buf,buf],axis=1)
wav.write('sfx.wav', sr, (stereo*32767).astype(np.int16))
print('sfx.wav written', DUR,'s')
