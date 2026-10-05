import React from 'react';
import {AbsoluteFill, Audio, Video, interpolate, staticFile, useCurrentFrame} from 'remotion';

const FPS = 30;
const C = {black:'#07090b', white:'#f6fff9', green:'#84ffb9', purple:'#9945ff'};
const clips = [
  'breakpoint/london-waterloo.webm',
  'stock/st_10374888.mp4','stock/st_3941990.mp4','stock/st_12043160.mp4',
  'stock/st_3602435.mp4','stock/st_11372816.mp4','stock/st_853794.mp4',
  'stock/st_19910709.mp4','stock/st_12421171.mp4','stock/st_7000589.mp4',
  'stock/st_7579943.mp4','breakpoint/party-dj.mp4','breakpoint/party-crowd.mp4','breakpoint/party-lights.mp4',
];
type Beat = {at:number; dur:number; line:string; sub?:string; clip:number; mode?:'terminal'|'blast'|'final'};
const beats:Beat[] = [
  {at:0,dur:24,line:'BREAKING',sub:'ALPHA HAS A LOCATION',clip:10,mode:'terminal'},
  {at:24,dur:21,line:'LONDON.',sub:'51.5° N / 0.1° W',clip:0,mode:'blast'},
  {at:45,dur:16,line:'THE',clip:1}, {at:61,dur:16,line:'BUILDERS',clip:2},
  {at:77,dur:16,line:'ARE',clip:3}, {at:93,dur:22,line:'COMING.',clip:12,mode:'blast'},
  {at:115,dur:14,line:'IDEAS',clip:5}, {at:129,dur:14,line:'→',clip:6},
  {at:143,dur:18,line:'REALITY',clip:7},
  {at:161,dur:15,line:'THE',clip:8}, {at:176,dur:18,line:'ROOM',clip:2},
  {at:194,dur:17,line:'MOVES',clip:3}, {at:211,dur:24,line:'FASTER.',clip:10,mode:'blast'},
  {at:235,dur:15,line:'TALKS',clip:1}, {at:250,dur:15,line:'TURNS',clip:4},
  {at:265,dur:20,line:'→ BUILDS',clip:5},
  {at:285,dur:16,line:'BUILDS',clip:6}, {at:301,dur:16,line:'TURN',clip:7},
  {at:317,dur:24,line:'→ CULTURE',clip:13,mode:'blast'},
  {at:341,dur:22,line:'ALL THE ENERGY',clip:11},
  {at:363,dur:24,line:'ONE CITY.',clip:0,mode:'blast'},
  {at:387,dur:20,line:'EVERY',clip:1}, {at:407,dur:20,line:'BUILDER.',clip:2},
  {at:427,dur:20,line:'EVERY',clip:10}, {at:447,dur:20,line:'DEGEN.',clip:12},
  {at:467,dur:20,line:'EVERY',clip:5}, {at:487,dur:24,line:'AFTERPARTY.',clip:11,mode:'blast'},
  {at:511,dur:30,line:'YOU CAN WATCH',sub:'THE TIMELINE',clip:7},
  {at:541,dur:30,line:'OR BE',sub:'THE TIMELINE',clip:13,mode:'blast'},
  {at:571,dur:33,line:'BREAKPOINT',sub:'LONDON 2026',clip:0,mode:'final'},
  {at:604,dur:66,line:'15—17 NOV',sub:'LONDON · SOLANA BREAKPOINT',clip:0,mode:'final'},
];
const hash=(n:number)=>((n*7919)%997)/997;
export const BreakpointLondon:React.FC=()=>{
  const f=useCurrentFrame();
  const b=beats.find(x=>f>=x.at&&f<x.at+x.dur)??beats[beats.length-1];
  const local=f-b.at;
  const punch=1.09+0.07*interpolate(local,[0,b.dur],[0,1]);
  const flash=local<2&&f>0;
  const large=b.line.length>12?92:b.line.length>9?113:Math.min(170,190-b.line.length*5);
  const textIn=interpolate(local,[0,3,Math.max(4,b.dur-3),b.dur],[1.2,1,1,0.94],{extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:C.black,color:C.white,fontFamily:'Arial, Helvetica, sans-serif',overflow:'hidden'}}>
    <Video key={b.clip+'-'+b.at} src={staticFile(clips[b.clip])} startFrom={b.clip===0?90:Math.floor(hash(b.at)*50)} muted style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${punch})`,filter:'saturate(0.72) contrast(1.3) brightness(0.54)'}} />
    <AbsoluteFill style={{background:'linear-gradient(180deg,rgba(3,8,7,.25),rgba(3,8,7,.05) 40%,rgba(3,8,7,.78))'}}/>
    <AbsoluteFill style={{background:'linear-gradient(125deg,rgba(153,69,255,.23),transparent 45%,rgba(20,255,160,.18))',mixBlendMode:'screen'}}/>
    {Array.from({length:15},(_,i)=><div key={i} style={{position:'absolute',top:0,bottom:0,left:`${i*7}%`,width:1,background:'rgba(132,255,185,.055)'}}/>)}
    <div style={{position:'absolute',top:120,left:70,right:70,display:'flex',justifyContent:'space-between',fontSize:23,fontWeight:900,letterSpacing:5,color:C.green}}><span>◎ SOLANA / LIVE</span><span>BP26 // LDN</span></div>
    <div style={{position:'absolute',top:195,left:70,right:70,height:2,background:C.green,opacity:.6}}/>
    <div style={{position:'absolute',top:'39%',left:42,right:42,textAlign:'center',transform:`translateY(-50%) scale(${textIn}) rotate(${local<2?-2:0}deg)`}}>
      <div style={{fontWeight:1000,fontSize:large,lineHeight:.88,letterSpacing:-large*.065,textShadow:'0 8px 0 #101510, 0 18px 60px #000',WebkitTextStroke:'2px rgba(255,255,255,.15)',color:b.mode==='blast'?C.green:C.white}}>{b.line}</div>
      {b.sub&&<div style={{marginTop:28,display:'inline-block',padding:'12px 24px',background:b.mode==='final'?C.green:C.purple,color:b.mode==='final'?C.black:C.white,fontSize:39,fontWeight:1000,letterSpacing:2,transform:'rotate(-2deg)'}}>{b.sub}</div>}
    </div>
    {b.mode==='terminal'&&<div style={{position:'absolute',top:'62%',left:72,right:72,color:C.green,fontSize:28,fontWeight:700,lineHeight:1.7,fontFamily:'monospace'}}>&gt; SCANNING GLOBAL NETWORK<br/>&gt; SIGNAL FOUND: 51.5072 N<br/>&gt; STATUS: EVERYONE IS COMING_</div>}
    {b.mode==='final'&&<><div style={{position:'absolute',top:'61%',left:100,right:100,border:'2px solid '+C.green,padding:'22px 16px',textAlign:'center',fontSize:29,fontWeight:900,letterSpacing:5,background:'rgba(0,0,0,.6)'}}>BUILDERS. CULTURE. ALL OF US.</div><div style={{position:'absolute',top:'67%',left:0,right:0,textAlign:'center',fontSize:25,letterSpacing:4,fontWeight:800}}>SOLANA.COM/BREAKPOINT</div></>}
    {flash&&<AbsoluteFill style={{background:f%2?C.green:C.white,opacity:.48}}/>}
    <div style={{position:'absolute',bottom:170,left:70,right:70,display:'flex',alignItems:'center',gap:14}}><div style={{width:20,height:20,borderRadius:'50%',background:C.green,boxShadow:'0 0 30px '+C.green}}/><span style={{fontSize:24,fontWeight:900,letterSpacing:4}}>THE NETWORK IS THE EVENT</span></div>
    <div style={{position:'absolute',bottom:134,left:70,right:70,height:3,background:'rgba(255,255,255,.25)'}}><div style={{height:3,width:`${f/670*100}%`,background:C.green}}/></div>
    <div style={{position:'absolute',bottom:78,left:70,right:70,display:'flex',justifyContent:'space-between',fontSize:21,fontFamily:'monospace',letterSpacing:2}}><span>LDN 15—17 NOV 2026</span><span>{String(Math.floor(f/FPS)).padStart(2,'0')}:{String(f%FPS).padStart(2,'0')}</span></div>
    <Audio src={staticFile('breakpoint/beat.wav')} volume={0.88}/>
  </AbsoluteFill>;
};
