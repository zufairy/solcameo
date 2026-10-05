from kokoro_onnx import Kokoro
import soundfile as sf, numpy as np, json
k=Kokoro('/tmp/ks/kokoro-fp16.onnx','/tmp/ks/voices.bin')
# (id, text, speed, anchor_time or None, gap_before)
P=[
("a1","This is a nature documentary.",0.95,0.45,0),
("a2","About you.",0.85,None,0.25),
("b1","The human clipper.",1.02,5.0,0),
("b2","Four posts a day.",1.05,None,0.12),
("b3","By hand.",1.0,None,0.12),
("b4","It sleeps.",1.05,None,0.3),
("b5","It eats.",1.05,None,0.1),
("b6","It gets tired.",1.0,None,0.1),
("c1","But something new has learned to clip.",1.02,11.9,0),
("c2","It does not sleep.",1.1,None,0.2),
("c3","It reads the brief.",1.15,None,0.08),
("c4","It cuts.",1.15,None,0.06),
("c5","It posts.",1.15,None,0.06),
("c6","Sixty times a day.",1.1,None,0.1),
("d1","Editors.",1.05,20.5,0),
("d2","Gone.",1.0,None,0.1),
("d3","Social media managers.",1.1,None,0.2),
("d4","Gone.",1.0,None,0.1),
("d5","Copywriters.",1.05,None,0.2),
("d6","Gone.",1.0,None,0.1),
("d7","The habitat is shrinking.",0.98,None,0.35),
("e1","Our advice.",0.92,28.3,0),
("e2","Don't use Vello.",0.88,None,0.35),
("e3","Keep clipping by hand.",1.0,None,0.45),
("e4","Stay small.",1.0,None,0.2),
("e5","Stay tired.",1.0,None,0.15),
("e6","Stay quiet.",0.95,None,0.15),
("e7","They prefer you that way.",0.85,None,0.35),
("f1","Because Vello is an agent that works for you.",1.05,40.4,0),
("f2","It runs your clipping pages while you sleep.",1.1,None,0.2),
("f3","You keep the pages.",1.05,None,0.15),
("f4","You keep the payout.",1.05,None,0.1),
("g1","The agents are coming either way.",1.0,50.0,0),
("g2","The only question is,",1.0,None,0.2),
("g3","whose side are they on?",0.95,None,0.15),
("g4","Vello agents dot com.",0.95,None,0.35),
("g5","Before you're taken.",0.8,None,0.3),
]
tl=[];t=0
for pid,txt,sp,anc,gap in P:
    for tr in range(10):
        s,sr=k.create(txt,voice="bm_george",speed=min(1.3,sp*1.08)+0.01*tr,lang='en-gb')
        if len(s)>0 and not np.isnan(s).any(): break
    sf.write(f'vo/{pid}.wav',s,sr)
    d=len(s)/sr
    st=anc if anc is not None else t+gap
    if anc is not None and anc<t: print("WARN overlap",pid,anc,t)
    tl.append(dict(id=pid,text=txt,start=round(st,3),dur=round(d,3)))
    t=st+d
json.dump(tl,open('timeline.json','w'),indent=1)
for x in tl: print(x['id'],x['start'],round(x['start']+x['dur'],2),x['text'])
