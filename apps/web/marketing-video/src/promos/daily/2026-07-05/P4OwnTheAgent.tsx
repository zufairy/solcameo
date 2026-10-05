/**
 * P4 — "Own the Agent" · Pillar 8 market / investor angle.
 * A $40.5B→$152B market, AI creators at 3× engagement, and an on-chain track
 * record that makes an agent a priceable asset you can back.
 * Layout: TAM hook → proof stats → rising earnings chart + agent asset card.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, EASE, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const StatCard: React.FC<{ at: number; big: React.ReactNode; cap: string }> = ({ at, big, cap }) => (
  <Rise at={at}>
    <Card style={{ padding: "38px 40px", width: 470, minHeight: 250 }}>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 84, color: D.ink, letterSpacing: -3, lineHeight: 1 }}>{big}</div>
      <div style={{ width: 60, height: 4, background: D.limeBright, borderRadius: 4, margin: "18px 0 16px" }} />
      <div style={{ fontFamily: geist, fontSize: 23, color: D.sub, lineHeight: 1.35 }}>{cap}</div>
    </Card>
  </Rise>
);

export const P4OwnTheAgent: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* earnings area chart path */
  const pts = [0, 8, 14, 26, 30, 44, 52, 70, 82, 100];
  const CW = 640, CH = 260;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (pts.length - 1)) * CW} ${CH - (p / 100) * CH}`).join(" ");
  const draw = interpolate(frame, [540, 640], [1, 0], CL); // dashoffset fraction
  const reveal = interpolate(frame, [540, 650], [0, 1], { ...CL, easing: EASE });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TAM HOOK (0–190) ══ */}
      <Sect from={0} to={190} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>THE MARKET</Tag></Rise>
          <Rise at={30} style={{ display: "flex", alignItems: "baseline", gap: 30 }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 150, color: D.ink, letterSpacing: -6 }}>$<Count at={36} to={40} dur={50} />B</div>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 70, color: D.faint }}>→</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 150, color: D.lime, letterSpacing: -6 }}>$<Count at={70} to={152} dur={70} />B</div>
          </Rise>
          <Rise at={130}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub }}>Influencer marketing, 2026 → 2031. The AI slice grows fastest.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · WHY IT WINS (190–470) ══ */}
      <Sect from={190} to={470}>
        <div style={{ position: "absolute", top: 90, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Rise at={200}><Tag>THE SIGNAL IS ALREADY IN</Tag></Rise>
          <Line at={210} size={58} maxWidth={1500}
            words={[{ t: "The" }, { t: "chasm" }, { t: "is" }, { t: "already" }, { t: "crossed.", c: D.lime }]} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 360, display: "flex", justifyContent: "center", gap: 40 }}>
          <StatCard at={240} big="3×" cap="the engagement of human creators — 5.67% vs 1.89%" />
          <StatCard at={280} big="73%" cap="of brands already use virtual / AI creators" />
          <StatCard at={320} big={<>$380K→<span style={{ color: D.lime }}>~$0</span></>} cap="cost to launch a brand-ready AI influencer — now near-zero, in minutes" />
        </div>
      </Sect>

      {/* ══ S3 · THE ASSET (470–700) ══ */}
      <Sect from={470} to={700}>
        <div style={{ position: "absolute", top: 92, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Rise at={480}><Tag>OWNERSHIP</Tag></Rise>
          <Line at={490} size={58} maxWidth={1500}
            words={[{ t: "An" }, { t: "agent" }, { t: "is" }, { t: "an" }, { t: "asset", c: D.lime, serif: true }, { t: "you" }, { t: "can" }, { t: "own." }]} />
        </div>
        {/* dark chart card */}
        <Rise at={512} style={{ position: "absolute", left: 150, top: 340 }}>
          <Card dark style={{ padding: "36px 42px", width: 760 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: "rgba(255,255,255,0.5)" }}>AGENT EARNINGS · ON-CHAIN</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 30, color: "#fff", marginTop: 4 }}>~$1,200<span style={{ color: "rgba(255,255,255,0.6)", fontSize: 20 }}> gross / mo</span></div>
              </div>
              <div style={{ fontFamily: mono, fontSize: 16, color: D.limeBright, letterSpacing: 1 }}>▲ compounding</div>
            </div>
            <svg width={CW} height={CH} style={{ overflow: "visible" }}>
              <defs>
                <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={D.limeBright} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={D.limeBright} stopOpacity="0" />
                </linearGradient>
                <clipPath id="rev"><rect x="0" y="-20" width={CW * reveal} height={CH + 40} /></clipPath>
              </defs>
              <g clipPath="url(#rev)">
                <path d={`${path} L ${CW} ${CH} L 0 ${CH} Z`} fill="url(#ag)" />
                <path d={path} stroke={D.limeBright} strokeWidth="4" fill="none" />
              </g>
              <circle cx={CW * reveal} cy={CH - (pts[Math.min(pts.length - 1, Math.floor(reveal * (pts.length - 1)))] / 100) * CH} r="7" fill={D.limeBright} />
            </svg>
          </Card>
        </Rise>
        {/* asset card */}
        <Rise at={560} style={{ position: "absolute", right: 150, top: 340 }}>
          <Card style={{ padding: "34px 38px", width: 460 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 60, height: 60, borderRadius: 18, background: `linear-gradient(135deg, ${D.limeBright}, ${D.skyDeep})` }} />
              <div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 28, color: D.ink }}>Kaverro</div>
                <div style={{ fontFamily: mono, fontSize: 15, color: D.faint }}>@kaverro · verified track record</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26 }}>
              <div><div style={{ fontFamily: mono, fontSize: 13, color: D.faint, letterSpacing: 1 }}>FOLLOWERS</div><Count at={580} to={104} suffix="K" dur={70} style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: D.ink }} /></div>
              <div><div style={{ fontFamily: mono, fontSize: 13, color: D.faint, letterSpacing: 1 }}>CAMPAIGNS</div><Count at={590} to={38} dur={70} style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: D.ink }} /></div>
              <div><div style={{ fontFamily: mono, fontSize: 13, color: D.faint, letterSpacing: 1 }}>LIFETIME</div><Count at={600} to={48} prefix="$" suffix="K" dur={70} style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: D.lime }} /></div>
            </div>
            <div style={{ marginTop: 22, fontFamily: geist, fontSize: 18, color: D.sub, lineHeight: 1.4 }}>Followers, reputation, and earnings — provable on Solana. Back the ones that compound.</div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={694} headline={[{ t: "Back" }, { t: "the", serif: true }, { t: "agents.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
