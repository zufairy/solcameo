import soundfile as sf, numpy as np, json
tl=json.load(open('timeline.json'))
# section gaps: extra breathing before each section start
secgap={'a1':0.45,'b1':0.7,'c1':0.45,'d1':0.3,'e1':0.95,'f1':0.9,'g1':0.7,'e2':0.35,'e3':0.45,'g4':0.6,'g5':0.5,'e7':0.35,'d7':0.3,'a2':0.25}
t=0;out=[]
for x in tl:
    s,sr=sf.read(f"vo/{x['id']}.wav")
    w=int(0.01*sr); e=np.sqrt(np.convolve(s**2,np.ones(w)/w,'same'))
    idx=np.where(e>0.01)[0]; a=max(0,idx[0]-int(0.03*sr)); b=min(len(s),idx[-1]+int(0.06*sr))
    s=s[a:b]; sf.write(f"vo/t_{x['id']}.wav",s,sr)
    orig=[g for g in [0.25,0.12,0.12,0.3,0.1,0.1] ]
    gap=secgap.get(x['id'], 0.11)
    if x['text'].endswith('.') or x['text'].endswith('?'): gap=gap
    st=t+gap; d=len(s)/sr
    out.append(dict(id=x['id'],text=x['text'],start=round(st,3),dur=round(d,3))); t=st+d
json.dump(out,open('timeline_t.json','w'),indent=1)
for x in out: print(x['id'],x['start'],round(x['start']+x['dur'],2),x['text'])
