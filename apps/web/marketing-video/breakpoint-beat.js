const fs=require('fs');
const rate=44100, seconds=670/30, n=Math.ceil(rate*seconds);
const audio=new Float32Array(n);
const bpm=150, quarter=60/bpm;
function add(at,duration,fn,gain=1){const start=Math.floor(at*rate),len=Math.floor(duration*rate);for(let i=0;i<len&&start+i<n;i++)audio[start+i]+=fn(i/rate,i)*gain;}
const noise=i=>{let x=(i*1664525+1013904223)>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/2147483648-1};
for(let k=0;k<Math.ceil(seconds/quarter);k++){
 const t=k*quarter;
 add(t,.22,(s)=>Math.sin(2*Math.PI*(56*s+135*s*Math.exp(-s*30)))*Math.exp(-s*24),.96);
 if(k%2===1)add(t,.16,(s,i)=>noise(i)*Math.exp(-s*35)+.25*Math.sin(2*Math.PI*185*s)*Math.exp(-s*25),.35);
 for(let h=0;h<2;h++)add(t+h*quarter/2,.055,(s,i)=>noise(i)*Math.exp(-s*80),.13);
 const notes=[55,65.41,73.42,49];let hz=notes[Math.floor(k/2)%4];
 add(t,.32,(s)=>Math.sin(2*Math.PI*hz*s)*(1+.2*Math.sin(2*Math.PI*hz*2*s))*Math.exp(-s*6),.22);
}
for(let k=0;k<seconds/3.2;k++)add(k*3.2,.26,(s,i)=>noise(i)*Math.exp(-s*14),.25);
let peak=0;for(const v of audio)peak=Math.max(peak,Math.abs(v));
const out=Buffer.alloc(44+n*2);out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(n*2,40);
for(let i=0;i<n;i++)out.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(audio[i]/peak*29000))),44+i*2);
fs.writeFileSync('public/breakpoint/beat.wav',out);
