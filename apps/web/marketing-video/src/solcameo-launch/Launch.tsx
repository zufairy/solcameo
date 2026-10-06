import React from 'react';
import {AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender} from 'remotion';
import {Audio} from '@remotion/media';

const INK='#17342b', CREAM='#fffdf2', LIME='#c8ff62', PINK='#ffb8d9', PURPLE='#c7b5ff';
const asset=(name:string)=>staticFile(`solcameo-launch/${name}`);
const fontHandle=delayRender('Loading brand fonts');
Promise.all([new FontFace('LaunchSans',`url(${staticFile('fonts/Inter.woff2')})`,{weight:'100 900'}).load(),new FontFace('LaunchDisplay',`url(${staticFile('fonts/SpaceGrotesk.woff2')})`,{weight:'100 900'}).load()]).then(fonts=>{fonts.forEach(font=>document.fonts.add(font));continueRender(fontHandle);}).catch(()=>continueRender(fontHandle));
const ease=(f:number,d=0)=>spring({frame:Math.max(0,f-d),fps:30,config:{damping:15,stiffness:190,mass:.9}});
const clamp=(f:number,a:number,b:number,x:number,y:number)=>interpolate(f,[a,b],[x,y],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
const beat=30*60/128;

function Spark({size=70,color=INK,style={}}:{size?:number;color?:string;style?:React.CSSProperties}){
 return <svg width={size} height={size} viewBox="0 0 100 100" style={style}><path d="M50 0C54 35 65 46 100 50C65 54 54 65 50 100C46 65 35 54 0 50C35 46 46 35 50 0Z" fill={color}/></svg>;
}
function Buddy({kind=0,size=240}:{kind?:number;size?:number}){
 if(kind===0)return <Img src={asset('mascot.png')} style={{width:size,height:size,objectFit:'contain',filter:'drop-shadow(0 10px 1px rgba(23,52,43,.06))'}}/>;
 const color=kind===1?PINK:kind===2?'#aee9d5':PURPLE;
 return <svg width={size} height={size} viewBox="0 0 240 240">
  <ellipse cx="120" cy="220" rx="75" ry="9" fill={INK} opacity=".08"/>
  {kind===1&&<><path d="M42 88L37 20L102 63M198 88L203 20L138 63" fill={color} stroke={INK} strokeWidth="5"/><path d="M48 60L46 35L77 64M192 60L194 35L163 64" fill="#ffdced"/></>}
  {kind===2&&<><circle cx="70" cy="66" r="34" fill={color} stroke={INK} strokeWidth="5"/><circle cx="170" cy="66" r="34" fill={color} stroke={INK} strokeWidth="5"/></>}
  {kind===3&&<><path d="M120 63L120 24" stroke={INK} strokeWidth="5"/><circle cx="120" cy="22" r="14" fill={LIME} stroke={INK} strokeWidth="5"/></>}
  <rect x="27" y="62" width="186" height="145" rx="67" fill={color} stroke={INK} strokeWidth="5"/>
  <ellipse cx="78" cy="126" rx="13" ry="20" fill={INK}/><ellipse cx="162" cy="126" rx="13" ry="20" fill={INK}/>
  <circle cx="81" cy="118" r="5" fill="white"/><circle cx="165" cy="118" r="5" fill="white"/>
  <ellipse cx="57" cy="151" rx="16" ry="8" fill="#ff77b4" opacity=".55"/><ellipse cx="183" cy="151" rx="16" ry="8" fill="#ff77b4" opacity=".55"/>
  <path d="M98 156Q120 179 142 156" stroke={INK} strokeWidth="6" fill="none" strokeLinecap="round"/>
 </svg>;
}
function Headline({lines,f,size=104,top=260}:{lines:string[];f:number;size?:number;top?:number}){
 return <div style={{position:'absolute',top,left:65,right:65,textAlign:'center',fontFamily:'LaunchDisplay',fontSize:size,fontWeight:700,lineHeight:.98,letterSpacing:-6}}>{lines.map((line,i)=><div key={line} style={{transform:`translateY(${(1-ease(f,i*4))*80}px) rotate(${(1-ease(f,i*4))*(i%2?3:-3)}deg)`,opacity:clamp(f,i*4,i*4+8,0,1),marginBottom:14}}>{line}</div>)}</div>;
}
function Label({children,style={}}:{children:React.ReactNode;style?:React.CSSProperties}){
 return <div style={{display:'inline-flex',alignItems:'center',gap:12,padding:'16px 25px',background:INK,color:CREAM,fontSize:24,fontWeight:750,letterSpacing:2,borderRadius:14,...style}}>{children}</div>;
}
function Scene({children,background,duration}:{children:React.ReactNode;background:string;duration:number}){
 const f=useCurrentFrame();const exit=clamp(f,duration-9,duration,0,1);
 return <AbsoluteFill style={{background,opacity:1-exit,transform:`translateY(${exit*-45}px)`}}>{children}</AbsoluteFill>;
}
function Intro(){const f=useCurrentFrame();return <Scene background={CREAM} duration={113}>
 <Label style={{position:'absolute',left:65,top:220,transform:`scale(${ease(f)})`}}>HEY, GROUP CHAT.</Label>
 <Headline lines={['MAIN','CHARACTER','ENERGY.']} f={f-6} size={133} top={370}/>
 <div style={{position:'absolute',top:880,left:325,transform:`translateY(${Math.sin(f/9)*15}px) rotate(${Math.sin(f/16)*8}deg) scale(${ease(f,12)})`}}><Buddy size={440}/></div>
 <div style={{position:'absolute',top:1030,left:60,transform:`rotate(-14deg) scale(${ease(f,20)})`}}><Buddy kind={1} size={265}/></div>
 <div style={{position:'absolute',top:1020,right:50,transform:`rotate(14deg) scale(${ease(f,25)})`}}><Buddy kind={2} size={270}/></div>
 <Spark color={PINK} size={115} style={{position:'absolute',right:85,top:275,transform:`rotate(${f*1.6}deg)`}}/>
 <div style={{position:'absolute',bottom:295,left:90,right:90,textAlign:'center',fontSize:35,fontWeight:550,opacity:clamp(f,38,50,0,1)}}>Someone in your chat is the next main character.</div>
 </Scene>}
function Tag(){const f=useCurrentFrame();const typed='@yourbestie'.slice(0,Math.floor(clamp(f,15,52,0,12)));return <Scene background='#ffe8f2' duration={168}>
 <Headline lines={['TAG','ANYONE.']} f={f} size={144} top={265}/>
 <div style={{position:'absolute',left:80,right:80,top:660,background:CREAM,border:`3px solid ${INK}`,borderRadius:24,padding:'36px 40px',boxShadow:`0 12px 0 ${INK}`,transform:`translateY(${(1-ease(f,9))*100}px) rotate(-2deg)`}}>
  <div style={{fontSize:23,fontWeight:700,letterSpacing:3,opacity:.5,marginBottom:22}}>YOUR NEXT CAMEO STARTS WITH</div>
  <div style={{fontFamily:'LaunchDisplay',fontSize:84,fontWeight:700,letterSpacing:-4}}>{typed}<span style={{opacity:Math.floor(f/10)%2?0:1,color:'#79ad31'}}>|</span></div>
  <div style={{marginTop:18,fontSize:28,opacity:.6}}>one @mention.</div>
 </div>
 {[{name:'@yourbestie',k:1,x:45,y:1070,r:-9},{name:'@yourcrush',k:3,x:365,y:1120,r:4},{name:'@yourgroupchat',k:2,x:685,y:1040,r:11}].map((p,i)=><div key={p.name} style={{position:'absolute',left:p.x,top:p.y,width:300,textAlign:'center',transform:`translateY(${(1-ease(f,55+i*8))*220+Math.sin(f/12+i)*10}px) rotate(${p.r}deg) scale(${ease(f,55+i*8)})`}}><Buddy kind={p.k} size={270}/><Label style={{fontSize:19,letterSpacing:0,padding:'14px 18px',background:CREAM,color:INK,border:`2px solid ${INK}`}}>{p.name}</Label></div>)}
 <Spark color={INK} size={80} style={{position:'absolute',right:70,top:525,transform:`rotate(${f}deg)`}}/>
 </Scene>}
function Video(){const f=useCurrentFrame();const progress=clamp(f,10,68,0,100);return <Scene background='#eef1ff' duration={169}>
 <Headline lines={['AI MAKES','THE VIDEO.']} f={f} size={112} top={265}/>
 <div style={{position:'absolute',left:280,top:660,width:520,height:810,border:`5px solid ${INK}`,borderRadius:42,background:LIME,boxShadow:`16px 20px 0 ${PURPLE}`,overflow:'hidden',transform:`translateY(${(1-ease(f,9))*120}px) rotate(${Math.sin(f/19)*2}deg)`}}>
  <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 30%,#f7ffcb,transparent 65%)'}}/>
  <div style={{position:'absolute',top:40,left:35}}><Label style={{fontSize:16,letterSpacing:2,padding:'12px 16px'}}>AI VIDEO</Label></div>
  <div style={{position:'absolute',left:60,top:200,transform:`translateY(${Math.sin(f/5)*25}px) rotate(${Math.sin(f/10)*12}deg) scale(${1+.04*Math.sin(f*Math.PI/beat)})`}}><Buddy size={400}/></div>
  <Spark size={75} color={PINK} style={{position:'absolute',left:25,top:300,transform:`rotate(${f*2}deg)`}}/><Spark size={60} color={PURPLE} style={{position:'absolute',right:30,top:185,transform:`rotate(${-f*2}deg)`}}/>
  <div style={{position:'absolute',bottom:125,left:28,right:28,textAlign:'center',fontSize:40,fontWeight:800,lineHeight:1.05}}>BESTIE ENTERED<br/>THE LORE.</div>
  <div style={{position:'absolute',bottom:38,left:35,right:35,height:9,background:'#17342b25',borderRadius:10}}><div style={{height:'100%',width:`${progress}%`,background:INK,borderRadius:10}}/></div>
 </div>
 <Label style={{position:'absolute',right:45,top:990,transform:`rotate(8deg) scale(${ease(f,73)})`,background:CREAM,color:INK,border:`3px solid ${INK}`,boxShadow:'0 8px 0 #17342b'}}>CAMEO CREATED ✦</Label>
 <div style={{position:'absolute',bottom:280,left:80,right:80,textAlign:'center',fontSize:34,fontWeight:600,opacity:clamp(f,78,90,0,1)}}>One tag. A whole new story.</div>
 </Scene>}
function Token(){const f=useCurrentFrame();return <Scene background='#e8ffd7' duration={169}>
 <Headline lines={['LAUNCH','THE TOKEN.']} f={f} size={125} top={275}/>
 <div style={{position:'absolute',left:220,top:790,width:640,height:640,borderRadius:'50%',background:'linear-gradient(135deg,#ecffb1,#b3f544 50%,#77c745)',border:`12px solid ${INK}`,boxShadow:'0 22px 0 #416c25,0 50px 80px #456e2522',display:'grid',placeItems:'center',transform:`translateY(${(1-ease(f,16))*260+Math.sin(f/14)*15}px) rotate(${Math.sin(f/20)*9}deg) scale(${ease(f,16)})`}}>
  <div style={{position:'absolute',inset:24,border:`3px dashed ${INK}55`,borderRadius:'50%'}}/><Buddy size={455}/>
  <div style={{position:'absolute',bottom:55,fontFamily:'LaunchDisplay',fontSize:40,fontWeight:700,letterSpacing:7}}>YOUR CAMEO</div>
 </div>
 <Label style={{position:'absolute',left:95,top:1375,transform:`rotate(-8deg) scale(${ease(f,45)})`,background:PINK,color:INK,border:`3px solid ${INK}`,fontSize:32}}>FROM INSIDE JOKE → TOKEN</Label>
 {Array.from({length:30},(_,i)=>{const t=clamp(f,40,125,0,1);const a=i*2.399;return <div key={i} style={{position:'absolute',left:540+Math.cos(a)*t*620,top:1130+Math.sin(a)*t*600+t*t*160,width:12+i%4*5,height:24,background:[PINK,PURPLE,INK,'#ffffff'][i%4],transform:`rotate(${i*30+f*4}deg)`,opacity:f<40?0:1-clamp(f,113,165,0,1)}}/>})}
 </Scene>}
function Wave(){const f=useCurrentFrame();return <Scene background='#fff0d9' duration={169}>
 <Headline lines={['BE THE ONE','WHO MADE IT.']} f={f} size={110} top={280}/>
 <div style={{position:'absolute',top:620,left:100,right:100,fontSize:32,fontWeight:550,textAlign:'center',opacity:clamp(f,13,23,0,1)}}>Before it takes over the group chat.</div>
 {[{x:70,y:900,k:1,r:-10},{x:395,y:1010,k:0,r:5},{x:720,y:860,k:2,r:12},{x:75,y:1330,k:3,r:5},{x:730,y:1280,k:1,r:-7}].map((p,i)=><div key={i} style={{position:'absolute',left:p.x,top:p.y,width:285,height:315,padding:20,border:`3px solid ${INK}`,borderRadius:23,background:[PINK,LIME,'#c8f2dc',PURPLE,CREAM][i],boxShadow:`0 9px 0 ${INK}`,transform:`translateY(${(1-ease(f,12+i*7))*300+Math.sin(f/15+i)*12}px) rotate(${p.r}deg) scale(${ease(f,12+i*7)})`}}><Buddy kind={p.k} size={240}/><div style={{textAlign:'center',fontSize:20,fontWeight:800}}>MAIN CHARACTER #{i+1}</div></div>)}
 <Spark color={INK} size={100} style={{position:'absolute',left:575,top:835,transform:`rotate(${f*1.7}deg)`}}/>
 </Scene>}
function End(){const f=useCurrentFrame();return <Scene background={CREAM} duration={112}>
 <div style={{position:'absolute',left:290,top:270,transform:`translateY(${Math.sin(f/12)*10}px) scale(${ease(f)})`}}><Buddy size={500}/></div>
 <Img src={asset('logo.png')} style={{position:'absolute',left:125,top:850,width:830,height:140,objectFit:'contain',transform:`scale(${ease(f,8)})`}}/>
 <div style={{position:'absolute',top:1070,left:70,right:70,textAlign:'center',fontFamily:'LaunchDisplay',fontSize:64,lineHeight:1.1,fontWeight:700,letterSpacing:-2,opacity:clamp(f,13,22,0,1)}}>TAG. CREATE. LAUNCH.</div>
 <div style={{position:'absolute',top:1200,left:100,right:100,textAlign:'center',fontSize:33,fontWeight:550,opacity:clamp(f,20,28,0,1)}}>Your first cameo starts with a tag.</div>
 <div style={{position:'absolute',left:175,right:175,top:1365,padding:'30px 20px',borderRadius:18,background:INK,color:LIME,textAlign:'center',fontSize:55,fontWeight:800,letterSpacing:-1,boxShadow:'0 10px 0 #baff53',transform:`scale(${ease(f,23)})`}}>solcameo.com <span style={{marginLeft:20}}>↗</span></div>
 <Spark color={PINK} size={90} style={{position:'absolute',left:80,top:665,transform:`rotate(${f}deg)`}}/><Spark color={PURPLE} size={100} style={{position:'absolute',right:100,top:370,transform:`rotate(${-f}deg)`}}/>
 </Scene>}

export function SolcameoLaunch(){const f=useCurrentFrame();const {width,height}=useVideoConfig();const sx=width/1080,sy=height/1920;return <AbsoluteFill style={{background:CREAM,color:INK,fontFamily:'LaunchSans',overflow:'hidden'}}>
 <div style={{position:'absolute',width:1080,height:1920,transformOrigin:'top left',transform:`scale(${sx},${sy})`}}>
  <Sequence from={0} durationInFrames={113}><Intro/></Sequence>
  <Sequence from={113} durationInFrames={168}><Tag/></Sequence>
  <Sequence from={281} durationInFrames={169}><Video/></Sequence>
  <Sequence from={450} durationInFrames={169}><Token/></Sequence>
  <Sequence from={619} durationInFrames={169}><Wave/></Sequence>
  <Sequence from={788} durationInFrames={112}><End/></Sequence>
  {f<788&&<><Img src={asset('logo.png')} style={{position:'absolute',top:80,left:65,width:310,height:58,objectFit:'contain'}}/><div style={{position:'absolute',right:65,top:95,fontSize:20,fontWeight:700,letterSpacing:3}}>THE CAMEO ERA</div></>}
  <div style={{position:'absolute',bottom:175,left:65,right:65,display:'flex',gap:10}}>{[0,113,281,450,619,788].map((start,i)=><div key={start} style={{height:5,flex:1,borderRadius:4,background:INK,opacity:f>=start?.75:.12}}/>)}</div>
  <div style={{position:'absolute',bottom:125,left:65,right:65,fontSize:18,fontWeight:600,letterSpacing:3,display:'flex',justifyContent:'space-between',opacity:.65}}><span>SOLCAMEO</span><span>TAG → CREATE → LAUNCH</span></div>
 </div>
 <Audio src={asset('score.wav')} volume={.9}/>
 </AbsoluteFill>}
