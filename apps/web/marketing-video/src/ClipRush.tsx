import React from 'react';
import {AbsoluteFill,Audio,Composition,Img,OffthreadVideo,Sequence,interpolate,registerRoot,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
const L='#d7ff3f', W='#f6f4ec';
// Beats at 150 BPM. All cuts are on the 24-frame grid (half-beat inserts: 12f).
type Shot={b:number;d:number;type:string;title?:string;sub?:string;src?:string;offset?:number;light?:boolean};
const shots:Shot[]=[
{b:0,d:2,type:'film',src:'10374888',title:'STILL SCROLLING?',sub:'POV: YOU LIVE ON THE FEED'},
{b:2,d:1,type:'film',src:'7606057',title:'BRO.'},
{b:3,d:1,type:'type',title:'LOCK IN.',light:true},
{b:4,d:1,type:'film',src:'7579945',title:'THE EDGE'},
{b:5,d:1,type:'film',src:'17512949',title:'IS IN'},
{b:6,d:1,type:'film',src:'6109926',title:'THE CUT.'},
{b:7,d:1,type:'type',title:'SEND IT.'},
{b:8,d:4,type:'brand',title:'vello',sub:'FOR THE CLIPPERS.'},
{b:12,d:4,type:'web',src:'home.png',title:'YOUR NEXT MOVE.',sub:'REAL PRODUCT. OPEN IT. USE IT.'},
{b:16,d:2,type:'film',src:'3941990',title:'THE FEED',sub:'NEVER CLOCKS OUT.'},
{b:18,d:2,type:'film',src:'14367163',title:'NEITHER DO WE.'},
{b:20,d:4,type:'web',src:'clipping.png',title:'DROP THE LINK.',sub:'LONG VIDEO → SHORTS'},
{b:24,d:4,type:'editor',title:'FIND THE MOMENT.',sub:'CUT IT. CAPTION IT.'},
{b:28,d:1,type:'type',title:'HOOK.',light:true},
{b:29,d:1,type:'type',title:'CUT.'},
{b:30,d:1,type:'type',title:'CAPTION.',light:true},
{b:31,d:1,type:'type',title:'AGAIN.'},
{b:32,d:4,type:'clips',title:'ONE VIDEO.',sub:'MORE WAYS TO HIT THE FEED.'},
{b:36,d:4,type:'social',title:'POST EVERYWHERE.',sub:'TIKTOK / REELS / SHORTS / X'},
{b:40,d:2,type:'film',src:'8086497',title:'“ONE MORE EXPORT”',sub:'THE OLD YOU, 3:47 AM'},
{b:42,d:2,type:'type',title:'WE MOVED ON.',light:true},
{b:44,d:4,type:'campaign',title:'FIND A CAMPAIGN.',sub:'CLIP CONTENT. EARN PER VERIFIED VIEW.'},
{b:48,d:2,type:'film',src:'6266288',title:'MAKE IT COUNT.',sub:'ATTENTION IS THE WORK.'},
{b:50,d:2,type:'film',src:'6574256',title:'REAL PEOPLE.',sub:'REAL FEEDS. REAL ATTENTION.'},
{b:52,d:4,type:'solana',title:'EARN IN USDC.',sub:'PAYOUTS ON SOLANA'},
{b:56,d:2,type:'film',src:'6109923',title:'PERMISSIONLESS',sub:'ENERGY.'},
{b:58,d:2,type:'film',src:'11372816',title:'MOVE FAST.',sub:'MAKE SOMETHING WORTH WATCHING.'},
{b:60,d:1,type:'type',title:'CLIP.',light:true},
{b:61,d:1,type:'film',src:'17512949',title:'POST.'},
{b:62,d:1,type:'type',title:'EARN.',light:true},
{b:63,d:1,type:'film',src:'6109926',title:'REPEAT.'},
{b:64,d:4,type:'type',title:'YOUR FEED.\nYOUR MOVE.',sub:'YOU ALREADY KNOW WHAT HITS.'},
{b:68,d:1,type:'film',src:'7579945',title:'LOCKED.'},
{b:69,d:1,type:'film',src:'14367163',title:'IN.'},
{b:70,d:2,type:'type',title:'LET’S COOK.',light:true},
{b:72,d:8,type:'end',title:'vello',sub:'CLIP. POST. EARN.'},
];
const Video=({src,style={},start=0}:{src:string;style?:React.CSSProperties;start?:number})=><OffthreadVideo muted src={staticFile(src)} startFrom={start} style={{width:'100%',height:'100%',objectFit:'cover',...style}}/>;
function ShotView({s}:{s:Shot}){
 const f=useCurrentFrame(),{width,height}=useVideoConfig(); const vert=height>width;
 const punch=interpolate(f,[0,5,24*s.d],[1.065,1,1.025],{extrapolateRight:'clamp'});
 const ink=s.light?'#121310':W; const sz=vert?Math.min(108,1500/Math.max(...(s.title||" ").split("\n").map(x=>x.length))):154;
 const title=(s.title||'').split('\n');
 const cap=<div style={{position:'absolute',left:vert?60:88,bottom:vert?185:102,right:60,zIndex:5}}><div style={{fontFamily:'mono',fontSize:vert?24:22,letterSpacing:3,marginBottom:23,color:s.light?'#30352a':L}}>{s.sub}</div><div style={{fontWeight:950,fontSize:sz,lineHeight:.91,letterSpacing:-6,textShadow:s.type==='film'?'0 3px 28px #0008':undefined,transform:`translateY(${Math.max(0,1-f/6)*24}px)`}}>{title.map((t,i)=><div key={i}>{t}</div>)}</div></div>;
 return <AbsoluteFill style={{background:s.light?L:'#11120f',color:ink,overflow:'hidden'}}>
 {s.type==='film'&&<><AbsoluteFill style={{transform:`scale(${punch})`}}><Video src={`stock/st_${s.src}.mp4`} start={s.offset||30}/></AbsoluteFill><AbsoluteFill style={{background:'linear-gradient(0deg,rgba(0,0,0,.8),rgba(0,0,0,.03) 85%)'}}/>{cap}</>}
 {s.type==='type'&&<><div style={{position:'absolute',top:'18%',left:-20,fontSize:vert?220:390,fontWeight:900,whiteSpace:'nowrap',color:s.light?'#00000009':'#ffffff06',transform:`translateX(${-f*5}px)`}}>CLIPPERS CLIPPERS</div><AbsoluteFill style={{justifyContent:'center',padding:vert?60:88}}><div style={{fontWeight:950,fontSize:vert?126:s.title!.length>15?165:230,lineHeight:.9,letterSpacing:-9,transform:`scale(${punch})`,transformOrigin:'left center'}}>{title.map((t,i)=><div key={i}>{t}</div>)}</div><div style={{fontFamily:'mono',fontSize:24,marginTop:38,color:s.light?'#242922':L}}>{s.sub}</div></AbsoluteFill></>}
 {(s.type==='brand'||s.type==='end')&&<><div style={{position:'absolute',inset:0,background:`radial-gradient(ellipse at ${40+f*.1}% 110%,#5b6a10 0%,#14170b 40%,#10110e 70%)`}}/><div style={{position:'absolute',left:'-8%',top:'17%',fontSize:vert?280:560,fontWeight:900,letterSpacing:-35,color:'#d7ff3f0b',transform:`translateX(${-f*1.2}px)`}}>vello</div><AbsoluteFill style={{alignItems:'center',justifyContent:'center'}}><div style={{fontSize:vert?240:330,fontWeight:900,letterSpacing:-24,lineHeight:1,transform:`scale(${punch})`}}>vello<span style={{color:L}}>.</span></div><div style={{fontFamily:'mono',fontSize:vert?30:35,letterSpacing:5,marginTop:38,color:L}}>{s.sub}</div>{s.type==='end'&&<><div style={{fontSize:vert?36:40,marginTop:74}}>velloagents.com</div><div style={{fontFamily:'mono',fontSize:20,color:'#acb29d',marginTop:23}}>FIRST 3 CLIPS FREE</div></>}</AbsoluteFill></>}
 {s.type==='web'&&<><AbsoluteFill style={{background:W}}/><Img src={staticFile(`cliprush/${s.src}`)} style={{position:'absolute',width:vert?1550:1770,maxWidth:'none',left:vert?-235:75,top:vert?260:15,transform:`scale(${1+f*.0007})`,boxShadow:'0 35px 70px #0004',border:'1px solid #7773'}}/><div style={{position:'absolute',inset:0,background:'linear-gradient(0deg,#10120f 0%,transparent 48%)'}}/>{cap}</>}
 {s.type==='editor'&&<><Img src={staticFile('cliprush/editor.png')} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${1.03+f*.001})`}}/><AbsoluteFill style={{background:'linear-gradient(0deg,#000e,transparent 75%)'}}/>{cap}</>}
 {s.type==='clips'&&<><div style={{display:'flex',gap:vert?18:34,position:'absolute',top:vert?260:58,left:vert?-140:250,transform:`rotate(-5deg) translateX(${-f*.6}px)`}}>{['10374888','3941990','14367163'].map((v,i)=><div key={v} style={{width:vert?430:430,height:760,borderRadius:26,overflow:'hidden',border:'3px solid #ffffff44',position:'relative',marginTop:i===1?-35:30}}><Video src={`stock/st_${v}.mp4`} start={60+i*20}/><div style={{position:'absolute',top:'55%',left:0,right:0,textAlign:'center',fontSize:43,fontWeight:900,textShadow:'3px 3px #000',color:i===1?L:W}}>{['THIS IS','THE MOMENT','CUT IT.'][i]}</div></div>)}</div><AbsoluteFill style={{background:'linear-gradient(0deg,#11120f,transparent 70%)'}}/>{cap}</>}
 {s.type==='social'&&<><div style={{position:'absolute',top:vert?390:210,left:0,right:0,display:'flex',justifyContent:'center',gap:vert?28:80}}>{['tiktok','instagram','youtube','x'].map((v,i)=><div key={v} style={{height:vert?170:240,width:vert?170:240,background:W,borderRadius:46,display:'flex',alignItems:'center',justifyContent:'center',transform:`translateY(${Math.sin((f-i*6)/15)*16}px) rotate(${i%2?5:-5}deg)`}}><Img src={staticFile(`platforms/${v}.svg`)} style={{width:'56%',height:'56%',filter:'brightness(0)'}}/></div>)}</div><div style={{position:'absolute',top:vert?680:530,width:'100%',textAlign:'center',fontFamily:'mono',fontSize:25,letterSpacing:8,color:L}}>CONNECTED → CUT → DISTRIBUTE</div>{cap}</>}
 {s.type==='campaign'&&<><AbsoluteFill style={{transform:`scale(${1.3+f*.001})`,transformOrigin:'center 32%'}}><Img src={staticFile('cliprush/campaign.png')} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:vert?'74% center':'center'}}/></AbsoluteFill><AbsoluteFill style={{background:'linear-gradient(0deg,#10120f 5%,#10120f55 65%)'}}/>{cap}<div style={{position:'absolute',top:125,right:90,background:L,color:'#111',padding:'16px 25px',fontFamily:'mono',fontSize:20,transform:'rotate(5deg)'}}>FIND YOUR NEXT BRIEF ↗</div></>}
 {s.type==='solana'&&<><div style={{position:'absolute',top:vert?430:170,left:'50%',transform:`translateX(-50%) rotate(-12deg) scale(${punch})`}}>{[0,1,2].map((i)=><div key={i} style={{width:vert?570:660,height:90,marginBottom:40,transform:`skewX(${i===1?25:-25}deg)`,background:'linear-gradient(110deg,#9945ff,#14f195)'}}/>)}</div>{cap}<div style={{position:'absolute',bottom:38,left:vert?60:88,fontSize:19,color:'#a5ac9a',fontFamily:'mono'}}>Campaign rewards depend on verified views and campaign terms.</div></>}
 <div style={{position:'absolute',display:s.type==='web'?'none':'flex',top:38,left:vert?55:70,right:vert?55:70,justifyContent:'space-between',fontFamily:'mono',fontSize:18,letterSpacing:2,color:s.light?'#1e2619':'#ffffffbd'}}><span>VELLO / CLIPPERS</span><span>{String(Math.floor(s.b/4)+1).padStart(2,'0')} — SOLANA</span></div>
 <div style={{position:'absolute',bottom:0,left:0,height:5,width:`${(s.b+f/24)/80*100}%`,background:s.light?'#111':L}}/>
 <AbsoluteFill style={{pointerEvents:'none',opacity:.08,backgroundImage:`url(${staticFile('cliprush/grain.png')})`}}/>
 </AbsoluteFill>;
}
const Film=()=> <AbsoluteFill style={{fontFamily:'display, Arial, sans-serif'}}><style>{`@font-face{font-family:display;src:url('${staticFile('fonts/Geist.woff2')}')}@font-face{font-family:mono;src:url('${staticFile('fonts/GeistMono.woff2')}')}`}</style><Audio src={staticFile('cliprush/cliprush-original.wav')}/>{shots.map((s,i)=><Sequence key={i} from={s.b*24} durationInFrames={s.d*24} premountFor={12}><ShotView s={s}/></Sequence>)}</AbsoluteFill>;
const Root=()=> <><Composition id='ClipRush' component={Film} width={1920} height={1080} fps={60} durationInFrames={1920}/><Composition id='ClipRushVertical' component={Film} width={1080} height={1920} fps={60} durationInFrames={1920}/></>;
registerRoot(Root);
