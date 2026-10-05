/**
 * L2 · "Mission Control" — Pillar 2 (product walkthrough).
 * The whole product on one screen: a browser frame with a 2×2 live dashboard —
 * Build, Studio, Campaigns, Earn — all ticking at once. Distinct from the
 * sequential tab-tour (J2): everything runs simultaneously; you oversee.
 */
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useCount, useIn } from "./_kit";

const Dot: React.FC<{ c: string }> = ({ c }) => <span style={{ width: 13, height: 13, borderRadius: 99, background: c, display: "inline-block" }} />;

const Panel: React.FC<{ at: number; tag: string; children: React.ReactNode; x: number; y: number }> = ({ at, tag, children, x, y }) => {
  const s = useIn(at, 24);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 660, height: 300, opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
      <Card style={{ width: "100%", height: "100%", padding: "22px 26px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.lime }}>{tag}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, fontFamily: mono, fontSize: 12, letterSpacing: 2, color: D.faint }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: D.limeBright }} /> LIVE
          </span>
        </div>
        {children}
      </Card>
    </div>
  );
};

export const L2MissionControl: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const mintClock = Math.max(0, Math.ceil(interpolate(frame, [250, 340], [15, 0], CL)));
  const clips = useCount(300, 260, 42);
  const balance = interpolate(frame, [360, 560], [0, 184.30], { ...CL, easing: (x) => 1 - Math.pow(1 - x, 3) });
  const pulse = 0.5 + 0.5 * Math.sin(frame / 9);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK (0–140) */}
      <Sect from={0} to={140}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>PRODUCT · MISSION CONTROL</Tag></Rise>
          <Line at={20} size={108} maxWidth={1500}
            words={[{ t: "The" }, { t: "whole" }, { t: "thing." }, { t: "One", c: D.lime, serif: true }, { t: "screen.", c: D.lime, serif: true }]} />
          <Rise at={72}><div style={{ fontFamily: geist, fontSize: 32, color: D.sub }}>Build. Studio. Campaigns. Earn — running at once.</div></Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · DASHBOARD (140–720) */}
      <Sect from={140} to={720}>
        <Rise at={150} style={{ position: "absolute", left: 260, top: 96 }}>
          <div style={{ width: 1400, height: 900, borderRadius: 26, background: D.paper2, border: `1.5px solid ${D.line}`, boxShadow: "0 40px 90px rgba(32,38,28,0.18)", overflow: "hidden" }}>
            {/* browser chrome */}
            <div style={{ height: 62, background: D.card, borderBottom: `1px solid ${D.line}`, display: "flex", alignItems: "center", gap: 12, padding: "0 24px" }}>
              <Dot c="#F87171" /><Dot c="#FBBF24" /><Dot c="#34D399" />
              <div style={{ marginLeft: 18, flex: 1, maxWidth: 520, height: 34, borderRadius: 99, background: D.paper2, border: `1px solid ${D.line}`, display: "flex", alignItems: "center", padding: "0 18px", fontFamily: mono, fontSize: 16, color: D.sub }}>
                <span style={{ color: D.lime, marginRight: 8 }}>▲</span> vello.gg / dashboard
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 20, fontFamily: mono, fontSize: 15, letterSpacing: 1.5, color: D.faint }}>
                <span>BUILD</span><span>STUDIO</span><span>CAMPAIGNS</span><span>EARN</span>
              </div>
            </div>

            {/* 2x2 grid */}
            <div style={{ position: "relative", width: "100%", height: 838 }}>
              {/* BUILD */}
              <Panel at={196} tag="01 · BUILD" x={30} y={26}>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <div style={{ width: 62, height: 62, borderRadius: 99, background: `linear-gradient(135deg, ${D.limeBright}, ${D.skyDeep})` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 30, color: D.ink }}>Kaverro</div>
                    <div style={{ fontFamily: mono, fontSize: 15, color: D.faint }}>@kaverro.coffee · EN / MS</div>
                  </div>
                  <span style={{ fontFamily: mono, fontSize: 14, color: D.lime, background: `${D.limeBright}2c`, borderRadius: 99, padding: "8px 16px", letterSpacing: 1 }}>✓ MINTED</span>
                </div>
                <div style={{ marginTop: 22, fontFamily: mono, fontSize: 16, color: D.sub, letterSpacing: 1.5 }}>MINTED IN</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 56, color: D.ink }}>{String(mintClock).padStart(2, "0")}:00 <span style={{ fontFamily: mono, fontSize: 22, color: D.faint }}>min</span></div>
              </Panel>

              {/* STUDIO */}
              <Panel at={244} tag="02 · STUDIO" x={710} y={26}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 30, color: D.ink }}>Clip engine</div>
                  <div style={{ fontFamily: mono, fontSize: 18, color: D.lime }}>{clips}/wk</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 9, marginTop: 20 }}>
                  {Array.from({ length: 24 }).map((_, i) => {
                    const cs = spring({ frame: frame - (300 + i * 6), fps, config: { damping: 16, stiffness: 160 } });
                    return <div key={i} style={{ height: 44, borderRadius: 8, background: i % 5 === 0 ? D.limeBright : D.paper2, border: `1px solid ${D.line}`, transform: `scale(${cs})`, opacity: cs }} />;
                  })}
                </div>
                <div style={{ marginTop: 16, fontFamily: mono, fontSize: 14, color: D.faint, letterSpacing: 1.5 }}>EVERY CLIP DIFFERENT · QUALITY-GATED</div>
              </Panel>

              {/* CAMPAIGNS */}
              <Panel at={292} tag="03 · CAMPAIGNS" x={30} y={352}>
                {[{ n: "Vello", r: "$3.00", live: true }, { n: "Mach City", r: "$2.00", live: true }, { n: "Bloom Skincare", r: "$1.50", live: false }].map((b, i) => {
                  const claimed = i === 0 && frame > 420;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderRadius: 12, marginBottom: 8, background: claimed ? `${D.limeBright}22` : D.paper2, border: `1px solid ${claimed ? D.lime + "66" : D.line}` }}>
                      <span style={{ width: 9, height: 9, borderRadius: 99, background: b.live ? D.limeBright : D.faint, opacity: b.live ? pulse : 1 }} />
                      <span style={{ fontFamily: display, fontWeight: 700, fontSize: 22, color: D.ink }}>{b.n}</span>
                      <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 18, color: D.ink }}>{b.r}<span style={{ color: D.faint, fontSize: 13 }}> /1K</span></span>
                      {claimed && <span style={{ fontFamily: mono, fontSize: 12, color: D.lime, letterSpacing: 1 }}>CLAIMED</span>}
                    </div>
                  );
                })}
              </Panel>

              {/* EARN */}
              <Panel at={340} tag="04 · EARN" x={710} y={352}>
                <div style={{ background: D.dark, borderRadius: 16, padding: "22px 26px", height: "100%" }}>
                  <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>BALANCE</div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 64, color: D.limeBright, margin: "4px 0 10px" }}>${balance.toFixed(2)}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {["Stripe", "PayPal", "USDC"].map((p) => (
                      <span key={p} style={{ fontFamily: mono, fontSize: 13, color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 99, padding: "6px 12px" }}>{p}</span>
                    ))}
                    <span style={{ marginLeft: "auto", fontFamily: display, fontWeight: 700, fontSize: 17, color: "#0A0C08", background: D.limeBright, borderRadius: 99, padding: "9px 20px" }}>Withdraw</span>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </Rise>
      </Sect>

      {/* S3 · STATEMENT (720–790) */}
      <Sect from={720} to={790}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Line at={730} size={92} maxWidth={1500}
            words={[{ t: "You" }, { t: "approve." }, { t: "You" }, { t: "withdraw.", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* S4 · CTA (790–900) */}
      <Sect from={790} to={900}>
        <EndCard at={800} kicker={[{ t: "Start" }, { t: "free", c: D.lime, serif: true }, { t: "·" }, { t: "no" }, { t: "card." }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
