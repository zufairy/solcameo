import React, {useEffect,useMemo} from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {Audio} from '@remotion/media';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';

const ink='#15392e',lime='#b9ff53',pink='#ffaed3',purple='#b9a7ff';
const font=delayRender('Loading launch typography');
Promise.all([new FontFace('FilmSans',`url(${staticFile('fonts/Inter.woff2')})`,{weight:'100 900'}).load(),new FontFace('FilmDisplay',`url(${staticFile('fonts/SpaceGrotesk.woff2')})`,{weight:'100 900'}).load()]).then(fs=>{fs.forEach(f=>document.fonts.add(f));continueRender(font)}).catch(()=>continueRender(font));
const cl=(f:number,a:number,b:number,x=0,y=1)=>interpolate(f,[a,b],[x,y],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
const smooth=(x:number)=>{x=Math.min(1,Math.max(0,x));return x*x*(3-2*x)};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const sp=(f:number,d=0)=>spring({frame:Math.max(0,f-d),fps:30,config:{damping:25,stiffness:115,mass:1.05}});
function gate(f:number,start:number,end:number){return smooth(cl(f,start,start+30))*(1-smooth(cl(f,end-20,end+20)))}
function rounded(w:number,h:number,r:number){const s=new THREE.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
function starShape(){const points=Array.from({length:10},(_,i)=>{const a=Math.PI/2+i*Math.PI/5;const r=i%2?.91:1.42;return new THREE.Vector2(Math.cos(a)*r,Math.sin(a)*r)});const shape=new THREE.Shape();const midpoint=(a:THREE.Vector2,b:THREE.Vector2)=>a.clone().lerp(b,.5);const p=midpoint(points[9],points[0]);shape.moveTo(p.x,p.y);for(let i=0;i<10;i++){const after=midpoint(points[i],points[(i+1)%10]);shape.quadraticCurveTo(points[i].x,points[i].y,after.x,after.y)}shape.closePath();return shape;}
function Environment(){const {gl,scene}=useThree();const env=useMemo(()=>{const p=new THREE.PMREMGenerator(gl);const room=new RoomEnvironment();const result=p.fromScene(room,.04);p.dispose();room.dispose();return result},[gl]);useEffect(()=>{scene.environment=env.texture;return()=>{scene.environment=null;env.dispose()}},[env,scene]);return null}
function CameraRig(){const f=useCurrentFrame();const {camera}=useThree();const zoom=cl(f,450,490,0,1)*(1-cl(f,600,650,0,1));useEffect(()=>{camera.position.set(.14*Math.sin(f/90),.22*Math.sin(f/100),11.8-zoom*.6);camera.lookAt(.16*Math.sin(f/120),.08,0);camera.updateProjectionMatrix()},[camera,f,zoom]);return null;}
function Star({color=lime,scale=1,eyes=true}:{color?:string;scale?:number;eyes?:boolean}){
 const shape=useMemo(starShape,[]);
 return <group scale={scale}>
  <mesh castShadow><extrudeGeometry args={[shape,{depth:.32,bevelEnabled:true,bevelThickness:.14,bevelSize:.14,bevelSegments:6,curveSegments:16}]}/><meshPhysicalMaterial color={color} roughness={.23} metalness={.05} clearcoat={1} clearcoatRoughness={.18}/></mesh>
  {eyes&&[-1,1].map((side)=><group key={side} position={[side*.39,.1,.46]} rotation={[0,0,side*.11]}><mesh scale={[.18,.29,.08]}><sphereGeometry args={[1,28,24]}/><meshPhysicalMaterial color={ink} roughness={.12} clearcoat={1}/></mesh><mesh position={[-.04,.09,.075]}><sphereGeometry args={[.06,16,12]}/><meshBasicMaterial color="#f0ffd0"/></mesh><mesh position={[.07,-.09,.07]}><sphereGeometry args={[.027,12,12]}/><meshBasicMaterial color="#dfffab"/></mesh></group>)}
  {eyes&&[-1,1].map(side=><mesh key={side} position={[side*.66,-.17,.42]} scale={[.11,.045,.024]}><sphereGeometry args={[1,16,12]}/><meshStandardMaterial color={pink} roughness={.6}/></mesh>)}
 </group>
}
function TextPlate({text,w=2.5,h=.48,dark=false,size=70}:{text:string;w?:number;h?:number;dark?:boolean;size?:number}){
 const texture=useMemo(()=>{const c=document.createElement('canvas');c.width=1024;c.height=240;const ctx=c.getContext('2d')!;ctx.fillStyle=dark?ink:'#faffef';ctx.fillRect(0,0,1024,240);ctx.fillStyle=dark?lime:ink;ctx.font=`700 ${size}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,125);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t},[text,dark,size]);
 return <mesh><planeGeometry args={[w,h]}/><meshBasicMaterial map={texture} transparent/></mesh>
}
function Card({handle='@yourbestie',color=pink,video=false}:{handle?:string;color?:string;video?:boolean}){
 const f=useCurrentFrame();const body=useMemo(()=>rounded(2.25,3.45,.22),[]);const face=useMemo(()=>rounded(2.1,3.3,.16),[]);
 return <group>
  <mesh castShadow><extrudeGeometry args={[body,{depth:.09,bevelEnabled:true,bevelThickness:.04,bevelSize:.03,bevelSegments:3}]}/><meshPhysicalMaterial color="#f8fff3" roughness={.23} clearcoat={1} metalness={.08}/></mesh>
  <mesh position={[0,0,.16]}><shapeGeometry args={[face]}/><meshStandardMaterial color={color} roughness={.3}/></mesh>
  <group position={[0,.22,.25]} rotation={[Math.sin(f/35)*.08,Math.sin(f/42)*.16,Math.sin(f/27)*.07]}><Star color={color===pink?'#ffd1e6':color} scale={.64}/></group>
  <group position={[0,1.36,.19]}><TextPlate text={video?'AI VIDEO':'CAMEO'} w={1.8} h={.24} size={52}/></group>
  <group position={[0,-1.25,.22]}><TextPlate text={handle} w={1.85} h={.34} size={68}/></group>
  {video&&Array.from({length:17},(_,i)=><mesh key={i} position={[-.85+i*.104,-.85,.23]} scale={[1,.4+Math.abs(Math.sin(f/6+i*.8)),1]}><boxGeometry args={[.047,.22,.018]}/><meshStandardMaterial color={ink}/></mesh>)}
 </group>
}
function Coin({scale=1,color=lime}:{scale?:number;color?:string}){
 return <group scale={scale}>
  <mesh castShadow rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[1.48,1.48,.26,64]}/><meshPhysicalMaterial color={color} metalness={.6} roughness={.2} clearcoat={1}/></mesh>
  {[-1,1].map(side=><mesh key={side} position={[0,0,side*.15]}><torusGeometry args={[1.34,.045,12,80]}/><meshPhysicalMaterial color="#efffa8" roughness={.18} metalness={.7}/></mesh>)}
  <group position={[0,0,.12]}><Star color={color} scale={.72}/></group>
  {Array.from({length:48},(_,i)=>{const a=i/48*Math.PI*2;return <mesh key={i} position={[Math.cos(a)*1.47,Math.sin(a)*1.47,0]} rotation={[0,0,a]}><boxGeometry args={[.024,.04,.22]}/><meshStandardMaterial color="#87c92e" roughness={.27} metalness={.4}/></mesh>})}
 </group>
}
function Hero(){const f=useCurrentFrame();const enter=sp(f,3);const exit=smooth(cl(f,94,155));return <group position={[mix(3.3,18,exit),.12+Math.sin(f/24)*.17,-exit*2]} rotation={[Math.sin(f/40)*.1,-.23+Math.sin(f/60)*.24,Math.sin(f/50)*.12]} scale={Math.max(.001,enter*1.65*(1-exit))}><Star/></group>}
function TagOrbit(){const f=useCurrentFrame();const g=gate(f,110,294);return <group scale={Math.max(.001,g)} position={[3.5,0,0]}>{Array.from({length:5},(_,i)=>{const a=i*1.25+f*.008;return <group key={i} position={[Math.cos(a)*2.45,Math.sin(a)*1.25,-1.4+Math.sin(a)*1.1]} rotation={[Math.sin(a)*.12,-.3+Math.cos(a)*.27,Math.sin(a)*.16]} scale={i===0?.76:.64}><Card handle={['@yourbestie','@yourcrush','@thegroupchat','@yourrival','@anyone'][i]} color={[pink,purple,lime,'#8fe9d2','#ffd78b'][i]}/></group>})}</group>}
function VideoHero(){const f=useCurrentFrame();const g=gate(f,276,462);return <group position={[3.35,Math.sin(f/30)*.14,.4]} rotation={[.02,Math.sin(f/58)*.21,-.065]} scale={Math.max(.001,g*1.32)}><Card handle="BESTIE ENTERED THE LORE" color="#c5b4ff" video/>{Array.from({length:6},(_,i)=>{const a=f*.014+i*Math.PI/3;return <group key={i} position={[Math.cos(a)*2.25,Math.sin(a)*1.95,-1]} rotation={[.2,a,.3]} scale={.15}><Star color={i%2?pink:lime} eyes={false}/></group>})}</group>}
function TokenHero(){const f=useCurrentFrame();const g=gate(f,443,639);const local=f-450;return <group position={[3.2,.1+Math.sin(local/25)*.16,0]} scale={Math.max(.001,g)}>
 <group rotation={[.09,Math.sin(local/38)*.65,.08+Math.sin(local/70)*.12]} scale={1.35}><Coin/></group>
 {Array.from({length:10},(_,i)=>{const a=i*.628+local*.016;const e=smooth(cl(local,20,70));return <group key={i} position={[Math.cos(a)*3.4*e,Math.sin(a)*2.1*e,-2+Math.cos(a)*.7]} rotation={[a*.2,a,.2]} scale={.16+.04*Math.sin(i)}><Coin color={i%3===0?pink:i%3===1?purple:lime}/></group>})}
 </group>}
function Swarm(){const f=useCurrentFrame();const start=gate(f,613,910);const ending=smooth(cl(f,776,830));return <group scale={Math.max(.001,start)}>{Array.from({length:18},(_,i)=>{const a=i*2.399+f*.006;const r=(i<8?4.3:6)+ending;return <group key={i} position={[Math.cos(a)*r+mix(2.7,0,ending),Math.sin(a)*2.6,-2.5-Math.cos(a)*1.8]} rotation={[.15*Math.sin(a),a*.35,Math.sin(a)*.14]} scale={i<8?.47:.31}><Card handle={['@yourbestie','@yourcrush','@yourcameo'][i%3]} color={[lime,pink,purple,'#a0ebd5'][i%4]}/></group>})}</group>}
function Satellites(){const f=useCurrentFrame();return <group>{Array.from({length:20},(_,i)=>{const a=i*2.399+f*.004;const r=6.5+i%3;return <group key={i} position={[4.2+Math.cos(a)*3.2,Math.sin(a)*3.3,-4-i%4]} rotation={[f*.01+i,f*.015,-f*.007]} scale={.11+(i%3)*.04}><Star color={[lime,pink,purple][i%3]} eyes={false}/></group>})}</group>}
function World(){return <><Environment/><CameraRig/><ambientLight intensity={.65}/><directionalLight position={[3,7,7]} intensity={3.2} color="#fff8e9"/><directionalLight position={[-6,3,2]} intensity={2.1} color="#cbbfff"/><directionalLight position={[5,-2,-5]} intensity={3} color="#d9ffad"/><Hero/><TagOrbit/><VideoHero/><TokenHero/><Swarm/><Satellites/></>}

const scenes=[{start:0,end:113,kicker:'THE CAMEO ERA',lines:['YOUR NEXT','MAIN CHARACTER.'],sub:'Could already be in your group chat.',accent:1},{start:113,end:281,kicker:'01 / ONE @MENTION',lines:['TAG','ANYONE.'],sub:'Your bestie. Your crush. Your whole group chat.',accent:0},{start:281,end:450,kicker:'02 / AI DOES THE MAGIC',lines:['MAKE IT','A VIDEO.'],sub:'One tag becomes a whole new story.',accent:0},{start:450,end:619,kicker:'03 / FROM CONTENT TO TOKEN',lines:['LAUNCH','THE TOKEN.'],sub:'Give your cameo its own token.',accent:0},{start:619,end:788,kicker:'MAIN-CHARACTER ENERGY',lines:['BE THE ONE','WHO MADE IT.'],sub:'Before everyone else is sharing it.',accent:1}];
function TypeScene({start,end,kicker,lines,sub,accent}:{start:number;end:number;kicker:string;lines:string[];sub:string;accent:number}){const f=useCurrentFrame()-start;const exit=smooth(cl(f,end-start-13,end-start));return <div style={{position:'absolute',left:100,top:248,width:860,opacity:1-exit,transform:`translateX(${-exit*80}px)`}}>
 <div style={{overflow:'hidden',marginBottom:34}}><div style={{fontSize:21,fontWeight:750,letterSpacing:4,color:ink,transform:`translateY(${(1-sp(f))*50}px)`}}><span style={{display:'inline-block',width:11,height:11,background:ink,borderRadius:'50%',marginRight:15}}/>{kicker}</div></div>
 {lines.map((line,i)=><div key={line} style={{overflow:'hidden',paddingBottom:16,marginBottom:-8}}><div style={{fontFamily:'FilmDisplay',fontWeight:700,fontSize:105,lineHeight:1.03,letterSpacing:-6,transform:`translateY(${(1-sp(f,5+i*5))*145}px) rotate(${(1-sp(f,5+i*5))*3}deg)`,color:ink}}>{line}{accent===i&&<span style={{display:'block',height:13,width:cl(f,17+i*5,42+i*5,0,630),background:lime,borderRadius:12,marginTop:-5}}/>}</div></div>)}
 <div style={{fontSize:28,fontWeight:500,lineHeight:1.45,maxWidth:680,marginTop:32,opacity:cl(f,23,40),transform:`translateY(${(1-sp(f,23))*28}px)`}}>{sub}</div>
 {start===113&&<div style={{marginTop:47,display:'inline-block',padding:'18px 30px',border:'1px solid #15392e22',borderRadius:18,background:'#ffffffa6',boxShadow:'0 14px 50px #22332c0a',fontSize:36,fontWeight:750,letterSpacing:-1,opacity:cl(f,42,54)}}>{'@yourbestie'.slice(0,Math.floor(cl(f,43,72,0,11)))}<span style={{opacity:Math.floor(f/10)%2?0:1,color:'#7db62e'}}>|</span></div>}
 </div>}
export function Film(){const f=useCurrentFrame();const {width,height}=useVideoConfig();const end=smooth(cl(f,780,820));const bg= f<113?'#f3f5ee':f<281?'#fff0f5':f<450?'#eeedf8':f<619?'#edf8e1':'#f5f6f0';return <AbsoluteFill style={{background:bg,fontFamily:'FilmSans',color:ink}}>
 <AbsoluteFill style={{background:'radial-gradient(ellipse at 74% 65%,#e5ff9a66 0%,transparent 48%),radial-gradient(ellipse at 67% 25%,#d7c9ff66 0%,transparent 45%)'}}/>
 <ThreeCanvas width={width} height={height} shadows={false} camera={{fov:37,position:[0,0,11.8],near:.1,far:100}} gl={{antialias:true,alpha:true,powerPreference:'high-performance'}}><World/></ThreeCanvas>
 <AbsoluteFill style={{background:'linear-gradient(90deg,#f7f8f0dd 0%,#f7f8f080 35%,transparent 58%)',pointerEvents:'none'}}/>
 {scenes.map(s=>f>=s.start&&f<s.end?<TypeScene key={s.start} {...s}/>:null)}
 <Img src={staticFile('solcameo-launch/logo.png')} style={{position:'absolute',left:100,top:63,width:330,height:58,objectFit:'contain',opacity:1-end}}/>
 <div style={{position:'absolute',right:100,top:82,fontSize:18,fontWeight:650,letterSpacing:3,opacity:(1-end)*.6}}>TAG. CREATE. LAUNCH.</div>
 {f>=788&&<AbsoluteFill style={{alignItems:'center',justifyContent:'center',background:`rgba(247,248,240,${end*.67})`}}>
  <div style={{fontSize:22,fontWeight:750,letterSpacing:5,marginBottom:34,opacity:cl(f,794,810)}}>THE NEXT MAIN CHARACTER COULD BE YOURS.</div>
  <Img src={staticFile('solcameo-launch/logo.png')} style={{width:860,height:160,objectFit:'contain',transform:`translateY(${(1-sp(f-788))*60}px) scale(${mix(.92,1,sp(f-788))})`}}/>
  <div style={{fontFamily:'FilmDisplay',fontSize:46,fontWeight:650,letterSpacing:-1,marginTop:28,opacity:cl(f,800,820)}}>Tag anyone. Create the video. Launch the token.</div>
  <div style={{marginTop:52,padding:'22px 48px',background:ink,color:lime,borderRadius:14,fontSize:40,fontWeight:700,letterSpacing:-1,boxShadow:'0 8px 0 #b9ff53',transform:`translateY(${(1-sp(f-788,20))*55}px)`,opacity:cl(f,810,829)}}>solcameo.com ↗</div>
 </AbsoluteFill>}
 <div style={{position:'absolute',bottom:58,left:100,right:100,display:'flex',justifyContent:'space-between',fontSize:15,letterSpacing:3,fontWeight:600,opacity:.55}}><span>SOLCAMEO / THE CAMEO ERA</span><span>{f<788?`${String(scenes.findIndex(s=>f>=s.start&&f<s.end)+1).padStart(2,'0')} / 05`:'YOUR FIRST CAMEO STARTS HERE'}</span></div>
 <div style={{position:'absolute',bottom:37,left:100,height:3,width:cl(f,0,900,0,1720),background:ink,opacity:.25}}/>
 <Audio src={staticFile('solcameo-launch/score.wav')} volume={.9}/>
 </AbsoluteFill>}
