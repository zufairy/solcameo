import numpy as np, wave
sr=48000; dur=32; beat=.4; rng=np.random.default_rng(94); out=np.zeros((int(sr*dur),2),np.float64)
def add(x,t,g=1,pan=0):
 i=int(t*sr); n=min(len(x),len(out)-i)
 if n>0:
  out[i:i+n,0]+=x[:n]*g*(1-pan*.35); out[i:i+n,1]+=x[:n]*g*(1+pan*.35)
def kick(t,g=1):
 a=np.arange(int(.27*sr))/sr; freq=49+105*np.exp(-a*35); x=np.sin(2*np.pi*np.cumsum(freq)/sr)*np.exp(-a*18); x+=rng.normal(0,.16,len(a))*np.exp(-a*170); add(np.tanh(x*2),t,.6*g)
def snare(t,g=1):
 a=np.arange(int(.17*sr))/sr; n=rng.normal(0,1,len(a)); n=np.r_[0,np.diff(n)]*.5; x=n*np.exp(-a*24)+.4*np.sin(2*np.pi*185*a)*np.exp(-a*38); add(x,t,.27*g)
def hat(t,g=1,op=False):
 a=np.arange(int((.15 if op else .04)*sr))/sr; n=rng.normal(0,1,len(a)); x=np.r_[0,np.diff(n)]*np.exp(-a*(27 if op else 110)); add(x,t,.065*g, rng.uniform(-1,1))
def note(t,midi,length=.17,g=.15):
 a=np.arange(int(length*sr))/sr; hz=440*2**((midi-69)/12); x=sum(np.sin(2*np.pi*hz*k*a)/k**1.5 for k in range(1,9)); env=np.minimum(a*250,1)*np.exp(-a*10); add(x*env,t,g,-.3); add(x*env,t+.15,g*.17,.7)
for b in range(80):
 t=b*beat; bar=b//4; drop=8<=b<64 or b>=68; buildup= b<8
 if drop or b%2==0: kick(t,1 if drop else .75)
 if b%2==1: snare(t,1 if drop else .65)
 if drop:
  hat(t+.2,1.3,True); hat(t+.1,.65); hat(t+.3,.8)
  if b%8==7:
   for j in range(4): hat(t+.2+j*.05,.7)
 root=[29,29,32,27][(bar//2)%4]
 if drop:
  for off,ml in [(0,0),(.3,12)]:
   a=np.arange(int(.18*sr))/sr; hz=440*2**((root+ml-69)/12); x=np.tanh(2*(np.sin(2*np.pi*hz*a)+.3*np.sin(2*np.pi*hz*2*a))); env=np.minimum(a*100,1)*np.minimum((.18-a)*35,1); add(x*env,t+off,.22)
 if b>=8:
  pattern=[0,7,12,7,3,10,7,15]; note(t+.2,root+36+pattern[b%8],.22,.1 if b<64 else .14)
 if b%4==0 and b>=8:
  for k in [0,3,7]: note(t,root+36+k,.3,.085)
# transitions, reverse noise and sub impacts
for t in [3.2,6.4,12.8,19.2,25.6,27.2,28.8]:
 a=np.arange(int(.32*sr))/sr; n=rng.normal(0,1,len(a)); add(n*(a/.32)**3,t-.32,.12)
 a=np.arange(int(.55*sr))/sr; add(np.sin(2*np.pi*(43*a+20*(1-np.exp(-a*12))/12))*np.exp(-a*9),t,.36)
# brief pre-drop brake
out[int(3.05*sr):int(3.2*sr)]*=.05
out[int(26.9*sr):int(27.2*sr)]*=.06
out*=np.minimum(np.arange(len(out))/sr/.006,1)[:,None]
out*=np.clip((dur-np.arange(len(out))/sr)/.3,0,1)[:,None]
out=np.tanh(out*1.3); out/=max(1,np.max(np.abs(out))/.91)
with wave.open('apps/web/marketing-video/public/cliprush/cliprush-original.wav','wb') as w:
 w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((out*32767).astype('<i2').tobytes())
print('Original stereo instrumental: 150 BPM, 32s')
