import React from "react";
import {AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {display, mono, ui} from "../lib/fonts.local";

const BG = "#07130f";
const PANEL = "#12241d";
const WHITE = "#f5f7ed";
const LIME = "#b9f757";
const ORANGE = "#ff9a54";
const MUTED = "#b5c2b9";
const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
const sec = (n: number) => Math.round(n * 30);

const Label: React.FC<{children: React.ReactNode; color?: string}> = ({children, color = LIME}) => <div style={{fontFamily: mono, color, fontSize: 24, letterSpacing: 3, textTransform: "uppercase"}}>{children}</div>;
const Title: React.FC<{children: React.ReactNode; size?: number}> = ({children, size = 88}) => <div style={{fontFamily: display, fontWeight: 700, color: WHITE, fontSize: size, letterSpacing: -4, lineHeight: 1.02}}>{children}</div>;
const Body: React.FC<{children: React.ReactNode; size?: number}> = ({children, size = 36}) => <div style={{fontFamily: ui, color: MUTED, fontSize: size, lineHeight: 1.25}}>{children}</div>;

const In: React.FC<{delay?: number; children: React.ReactNode; style?: React.CSSProperties}> = ({delay = 0, children, style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const v = spring({frame: frame - delay, fps, config: {damping: 200, stiffness: 140}});
  return <div style={{opacity: v, transform: `translateY(${(1 - v) * 38}px)`, ...style}}>{children}</div>;
};

const Grid: React.FC = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: BG, overflow: "hidden"}}>
    <div style={{position: "absolute", inset: -200, opacity: .22, background: "radial-gradient(ellipse at 50% 35%,#2b5a35 0%,transparent 58%)", transform: `translateY(${Math.sin(frame / 55) * 35}px)`}} />
    <div style={{position: "absolute", inset: 0, opacity: .11, backgroundImage: "linear-gradient(#92bd9b 1px,transparent 1px),linear-gradient(90deg,#92bd9b 1px,transparent 1px)", backgroundSize: "80px 80px", transform: `translateY(${frame % 80}px)`}} />
    <div style={{position: "absolute", inset: 0, background: "linear-gradient(180deg,transparent 65%,#07130f 100%)"}} />
  </AbsoluteFill>;
};

const Shell: React.FC<{num: string; children: React.ReactNode}> = ({num, children}) => <AbsoluteFill style={{padding: "105px 74px 130px", justifyContent: "space-between"}}>
  <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}><Label>Malaysia / a tokenization idea</Label><Label color={MUTED}>{num} / 06</Label></div>
  {children}
  <div style={{borderTop: "1px solid #4b6956", paddingTop: 20, display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 20, color: "#90aa98"}}><span>FRESH FRUIT BUNCHES → VERIFIED CLAIMS</span><span>SUPERTEAM</span></div>
</AbsoluteFill>;

const Photo: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, sec(8)], [1.02, 1.12], clamp);
  return <AbsoluteFill style={{overflow: "hidden"}}>
    <Img src={staticFile("bounty/palm-harvest.png")} style={{width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`}} />
    <AbsoluteFill style={{background: "linear-gradient(180deg,rgba(4,17,11,.4),rgba(4,17,11,.08) 40%,rgba(4,17,11,.96) 100%)"}} />
  </AbsoluteFill>;
};

const Hook: React.FC = () => <AbsoluteFill><Photo/><Shell num="01"><div style={{marginTop: "auto", marginBottom: 100}}><In><Label color={ORANGE}>Not the land. Not the fruit.</Label></In><In delay={9}><Title size={108}>TOKENIZE<br/>THE <span style={{color: LIME}}>RECEIPT.</span></Title></In><In delay={22}><Body>The payment claim created after a palm harvest is accepted.</Body></In></div></Shell></AbsoluteFill>;

const Market: React.FC = () => {
  const frame = useCurrentFrame();
  const amount = Math.round(interpolate(frame, [10, 90], [0, 818678], clamp)).toLocaleString("en-US");
  return <AbsoluteFill><Grid/><Shell num="02"><div><In><Title>THE MARKET<br/>IS ALREADY HERE.</Title></In><In delay={12} style={{marginTop: 70, border: "1px solid #3a6140", borderRadius: 32, background: "linear-gradient(140deg,#183b27,#0b1d16)", padding: 56}}><div style={{fontFamily: display, fontWeight: 700, letterSpacing: -6, fontSize: 110, color: LIME}}>{amount}</div><Body>hectares farmed by independent Malaysian oil-palm smallholders in 2024</Body></In><In delay={27} style={{marginTop: 28}}><Label color={MUTED}>Source: Malaysian Palm Oil Board</Label></In></div><In delay={35}><div style={{height: 240, display: "flex", gap: 12, alignItems: "end"}}>{Array.from({length: 14}, (_, i) => <div key={i} style={{flex: 1, height: `${35 + ((i * 37) % 60)}%`, borderRadius: "18px 18px 4px 4px", background: i < 4 ? LIME : "#30543a", boxShadow: i < 4 ? "0 0 35px #a5e94a55" : undefined}}/>)}</div></In></Shell></AbsoluteFill>;
};

const Step: React.FC<{n: string; title: string; note: string; active?: boolean}> = ({n, title, note, active}) => <div style={{background: active ? "#d5ff94" : PANEL, color: active ? BG : WHITE, padding: "29px 32px", borderRadius: 28, border: `1px solid ${active ? LIME : "#365747"}`, boxShadow: active ? "0 18px 55px #9ef55e28" : undefined}}><div style={{fontFamily: mono, fontSize: 19, marginBottom: 9, opacity: .7}}>{n}</div><div style={{fontFamily: display, fontSize: 48, fontWeight: 700}}>{title}</div><div style={{fontFamily: ui, fontSize: 26, marginTop: 7, opacity: .78}}>{note}</div></div>;

const Current: React.FC = () => <AbsoluteFill><Grid/><Shell num="03"><div><In><Title>HOW IT WORKS<br/><span style={{color: LIME}}>TODAY.</span></Title></In><div style={{marginTop: 68, display: "grid", gap: 17}}><In delay={8}><Step n="01" title="Farm" note="Fresh fruit bunches harvested"/></In><In delay={20}><Step n="02" title="Dealer or mill" note="Transport, weighbridge, grading"/></In><In delay={32}><Step n="03" title="Sale" note="OER reference ≠ final sale price" active/></In></div><In delay={47} style={{marginTop: 43}}><Body size={33}>MPOB publishes a price reference. Buyer and seller agree the actual price.</Body></In></div></Shell></AbsoluteFill>;

const Gap: React.FC = () => <AbsoluteFill><Grid/><Shell num="04"><div><In><Title>THE CASH<br/><span style={{color: ORANGE}}>MISMATCH.</span></Title></In><In delay={12} style={{marginTop: 64}}><Body>Inputs, labour and transport need funding while each sale moves through the chain.</Body></In><div style={{marginTop: 110, position: "relative"}}><div style={{height: 8, background: "#49614b", borderRadius: 20}}/><div style={{display: "flex", justifyContent: "space-between", marginTop: 36}}><In delay={22}><Step n="TODAY" title="Costs" note="Cash needed" active/></In><In delay={38}><Step n="AFTER SALE" title="Buyer pays" note="Claim settles"/></In></div></div><In delay={54} style={{marginTop: 105, background: "#293821", borderLeft: `7px solid ${LIME}`, padding: 27, borderRadius: 17}}><Body size={31}>Malaysia already runs agricultural-input financing programs for smallholders.</Body></In></div></Shell></AbsoluteFill>;

const Receipt: React.FC = () => {
  const frame = useCurrentFrame();
  const scan = interpolate(frame % 55, [0, 55], [15, 385]);
  return <div style={{width: 700, height: 450, margin: "40px auto", position: "relative", transform: "rotate(-3deg)", borderRadius: 30, background: "#edf5e9", boxShadow: "0 35px 90px #0008", padding: 45, color: BG, overflow: "hidden"}}><div style={{fontFamily: mono, fontSize: 22, color: "#496e53"}}>MILL-ACCEPTED DELIVERY / DEMO</div><div style={{fontFamily: display, fontSize: 60, fontWeight: 700, marginTop: 20}}>VERIFIED<br/>RECEIPT</div><div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 17, marginTop: 28, fontFamily: mono, fontSize: 21}}><div>WEIGHT<br/><strong>confirmed</strong></div><div>GRADE / OER<br/><strong>recorded</strong></div><div>BUYER<br/><strong>accepted</strong></div><div>CLAIM<br/><strong>assignable*</strong></div></div><div style={{position: "absolute", top: scan, left: 0, right: 0, height: 4, background: LIME, boxShadow: "0 0 28px 11px #b9f7577b"}}/></div>;
};

const Mechanism: React.FC = () => <AbsoluteFill><Grid/><Shell num="05"><div><In><Title size={83}>VERIFY FIRST.<br/><span style={{color: LIME}}>TOKENIZE SECOND.</span></Title></In><In delay={10}><Receipt/></In><In delay={20}><div style={{display: "flex", gap: 12, alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 25, color: LIME}}><span>CO-OP RECEIPT</span><span>→</span><span>FRACTIONAL CLAIMS</span><span>→</span><span>ADVANCE</span></div></In><In delay={36} style={{marginTop: 54}}><Body size={33}>A cooperative can advance growers' cash. Eligible investors hold small digital claims. Compliant resale may be possible, never guaranteed.</Body></In><In delay={48} style={{marginTop: 30}}><Label color={MUTED}>*Only if validly assigned under applicable law</Label></In></div></Shell></AbsoluteFill>;

const Reality: React.FC = () => <AbsoluteFill><Grid/><Shell num="06"><div><In><Title>THE TOKEN IS<br/><span style={{color: ORANGE}}>NOT THE TRUST.</span></Title></In><div style={{display: "grid", gap: 16, marginTop: 75}}>{["Audited weighbridge data", "Buyer credit checks", "Legal assignment of claims", "Investor protection + SC compliance"].map((item, i) => <In key={item} delay={10+i*8}><div style={{background: PANEL, border: "1px solid #41614a", borderRadius: 22, padding: 30, display: "flex", gap: 22, alignItems: "center", fontFamily: ui, fontSize: 33, color: WHITE}}><span style={{color: LIME, fontFamily: mono}}>0{i+1}</span>{item}</div></In>)}</div><In delay={46} style={{marginTop: 55}}><Body size={31}>No token can erase fraud, default risk or illiquidity.</Body></In></div></Shell></AbsoluteFill>;

const End: React.FC = () => <AbsoluteFill><Photo/><AbsoluteFill style={{background: "rgba(3,15,8,.65)"}}/><Shell num="06"><div style={{marginTop: "auto", marginBottom: 170}}><In><Label color={ORANGE}>Malaysia's overlooked real-world asset</Label></In><In delay={10}><Title size={105}>NOT THE<br/>PALM TREE.</Title></In><In delay={23}><Title size={105}><span style={{color: LIME}}>THE PROOF<br/>IT WAS SOLD.</span></Title></In><In delay={38} style={{marginTop: 40}}><Body>Tokenize the verified payment claim, not the harvest itself.</Body></In></div></Shell></AbsoluteFill>;

export const TokenizedHarvest: React.FC = () => <AbsoluteFill style={{background: BG}}>
  <Sequence from={0} durationInFrames={sec(8)} premountFor={30}><Hook/></Sequence>
  <Sequence from={sec(8)} durationInFrames={sec(9)} premountFor={30}><Market/></Sequence>
  <Sequence from={sec(17)} durationInFrames={sec(10)} premountFor={30}><Current/></Sequence>
  <Sequence from={sec(27)} durationInFrames={sec(9)} premountFor={30}><Gap/></Sequence>
  <Sequence from={sec(36)} durationInFrames={sec(12)} premountFor={30}><Mechanism/></Sequence>
  <Sequence from={sec(48)} durationInFrames={sec(10)} premountFor={30}><Reality/></Sequence>
  <Sequence from={sec(58)} durationInFrames={sec(8)} premountFor={30}><End/></Sequence>
  <Audio src={staticFile("bounty/narration.wav")} volume={1}/>
  <Audio src={staticFile("bounty/music.mp3")} volume={0.12} loop/>
</AbsoluteFill>;
