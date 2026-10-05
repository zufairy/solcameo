import subprocess, json, re, sys

def segments(mp3, thr="-32dB", d="0.22"):
    out = subprocess.run(["ffmpeg","-i",mp3,"-af",f"silencedetect=noise={thr}:d={d}","-f","null","-"],capture_output=True,text=True).stderr
    starts=[float(x) for x in re.findall(r"silence_start: ([0-9.]+)",out)]
    ends=[float(x) for x in re.findall(r"silence_end: ([0-9.]+)",out)]
    dur=float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",mp3],capture_output=True,text=True).stdout)
    # speech segments
    segs=[]; cur=0.0
    for s,e in zip(starts,ends+[dur]):
        if s>cur: segs.append((cur,s))
        cur=e
    if cur<dur-0.05: segs.append((cur,dur))
    return segs,dur

def group(segs, n, min_gap=0.42):
    # merge segments separated by small gaps
    groups=[list(segs[0])]
    for s,e in segs[1:]:
        if s-groups[-1][1] < min_gap: groups[-1][1]=e
        else: groups.append([s,e])
    # force to n groups: merge shortest-adjacent while too many; split longest while too few
    while len(groups)>n:
        i=min(range(len(groups)-1), key=lambda i:(groups[i+1][1]-groups[i][0]))
        groups[i][1]=groups[i+1][1]; del groups[i+1]
    while len(groups)<n:
        i=max(range(len(groups)), key=lambda i:groups[i][1]-groups[i][0])
        s,e=groups[i]; m=(s+e)/2
        groups[i:i+1]=[[s,m],[m,e]]
    return groups

DOCS={
 "D1":["5,000,000,000 people are scrolling.","Every minute the feed swallows 500 hours of video —","and asks for more.","Behind every clip is a human:","cutting. captioning. posting…","burning out.","The feed doesn't care.","It never sleeps.","But something new is awake in there.","Creators with no heartbeat.","They cut faster. Post more.","Never miss a deadline.","3× the engagement of the humans they walk among.","The platforms purge the lazy copies.","The unique survive.","This is the new food chain of attention.","Keep feeding the machine…","or own one of the animals.","VELLO — the AI influencer network.","Agents with faces, memory, and paydays.","The feed never sleeps.","Now neither does your income."],
 "D2":["First, machines took the field.","The plow fed a thousand from the hands of ten.","Then they took the factory floor —","steel arms that never tire.","Then the office:","spreadsheets did in seconds what clerks did in weeks.","Every time, the grind moved to the machine…","and the money moved to whoever owned it.","Notice the pattern?","It was never the workers who got rich.","It was the owners.","Now machines are taking the last job we thought was safe:","creating.","Filming. Editing. Posting. Earning.","The question isn't whether AI will do this work —","it already is.","The question is: will you own one?","VELLO — deploy an AI creator","with its own face, memory, and wallet.","History doesn't repeat. It compounds.","Own the machine this time."],
 "D3":["1849. Gold in the river.","The ones who got rich weren't the ones who dug hardest —","they arrived first… or sold the shovels.","1859: oil. Same story.","1995: dot-com. Same story.","2020: the creator economy —","$250,000,000,000 — and every teenager with a phone is digging.","Here's what history whispers:","every rush has a window,","and the window closes on the people who hesitated.","The new gold isn't content.","It's the machines that make it.","AI creators that film, post, and collect —","while their owners sleep.","The prospectors are already in the river.","VELLO — the AI influencer network.","Claim your agent.","The window is open… for now."],
}
out={}
for k,caps in DOCS.items():
    segs,dur=segments(f"/tmp/mv/vo/{k}.mp3")
    g=group(segs,len(caps))
    out[k]={"dur":dur,"cues":[{"s":round(a,2),"e":round(b,2),"t":caps[i]} for i,(a,b) in enumerate(g)]}
ts="/* AUTO-GENERATED VO cue maps (silencedetect) */\nexport const DOCS = "+json.dumps(out,indent=1)+" as const;\n"
open("/tmp/mv/src/promos/doccues.ts","w").write(ts)
for k in out: print(k, len(out[k]["cues"]), "cues, dur", out[k]["dur"])
print(json.dumps(out["D1"]["cues"][:6],indent=1))
