/**
 * J2 — "Four Tabs" · Pillar 2 product walkthrough (Build/Studio/Campaigns/Earn).
 * The whole product as one browser frame whose tab bar switches through the
 * four surfaces, each a mini-UI vignette. Distinct layout: single centered
 * browser chrome with an animated active-tab pill; cofounder-bg footage in the
 * Build tab hero. 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, Count, display, mono, geist } from "./dk";

const TABS = ["Build", "Studio", "Campaigns", "Earn"];
/* tab k is active during [START + k*SPAN, START + (k+1)*SPAN) */
const START = 210, SPAN = 118;

const TabPane: React.FC<{ k: number; children: React.ReactNode }> = ({ k, children }) => {
  const frame = useCurrentFrame();
  const from = START + k * SPAN, to = START + (k + 1) * SPAN;
  if (frame < from - 10 || frame > to + 10) return null;
  const o = interpolate(frame, [from - 6, from + 8, to - 8, to + 6], [0, 1, 1, 0], CL);
  return <div style={{ position: "absolute", inset: 0, opacity: o, padding: "34px 44px" }}>{children}</div>;
};

const Row: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 24, stiffness: 140, mass: 0.85 } });
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * 22}px)` }}>{children}</div>;
};

export const J2FourTabs: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = Math.min(3, Math.max(0, Math.floor((frame - START) / SPAN)));

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–190) ══ */}
      <Sect from={0} to={190} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>THE WHOLE PRODUCT</Tag></Rise>
          <Line at={18} size={100} maxWidth={1560}
            words={[{ t: "Four" }, { t: "tabs.", serif: true }, { t: "One" }, { t: "paycheck.", c: D.lime, serif: true }]} />
          <Line at={62} size={52} maxWidth={1500} color={D.sub} weight={500}
            words={[{ t: "Build" }, { t: "·" }, { t: "Studio" }, { t: "·" }, { t: "Campaigns" }, { t: "·" }, { t: "Earn" }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · BROWSER TOUR (190–690) ══ */}
      <Sect from={190} to={690}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Card style={{ width: 1460, height: 850, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {/* chrome bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px 30px", borderBottom: `1.5px solid ${D.line}`, background: D.paper2 }}>
              <div style={{ display: "flex", gap: 8 }}>
                {["#E8837B", "#EFC26B", "#9ED47F"].map((c) => <span key={c} style={{ width: 14, height: 14, borderRadius: 99, background: c }} />)}
              </div>
              <div style={{ fontFamily: mono, fontSize: 17, color: D.sub, background: "#fff", border: `1.5px solid ${D.line}`, borderRadius: 999, padding: "8px 24px" }}>vello.gg</div>
              {/* tab pills */}
              <div style={{ display: "flex", gap: 10, marginLeft: 24 }}>
                {TABS.map((t, i) => {
                  const on = i === active && frame >= START;
                  return (
                    <div key={t} style={{
                      fontFamily: display, fontWeight: 650, fontSize: 21, padding: "10px 26px", borderRadius: 999,
                      background: on ? D.ink : "transparent", color: on ? D.limeBright : D.sub,
                      border: `1.5px solid ${on ? D.ink : D.line}`,
                      transform: `scale(${on ? 1.04 : 1})`,
                    }}>{i + 1} · {t}</div>
                  );
                })}
              </div>
            </div>

            {/* panes */}
            <div style={{ position: "relative", flex: 1 }}>
              {/* BUILD */}
              <TabPane k={0}>
                <div style={{ display: "flex", gap: 40, height: "100%" }}>
                  <div style={{ flex: 1 }}>
                    <Row at={START + 8}><div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>DESCRIBE YOUR INFLUENCER</div></Row>
                    <Row at={START + 16}>
                      <div style={{ fontFamily: display, fontWeight: 650, fontSize: 44, color: D.ink, marginTop: 14, lineHeight: 1.2 }}>
                        "streetwear-savvy tech reviewer, dry humor"
                      </div>
                    </Row>
                    <Row at={START + 34}>
                      <div style={{ display: "flex", gap: 12, marginTop: 30, flexWrap: "wrap" }}>
                        {["voice ✓", "face ✓", "tone ✓", "niche ✓"].map((c) => (
                          <span key={c} style={{ fontFamily: mono, fontSize: 17, color: D.lime, background: `${D.lime}14`, border: `1.5px solid ${D.lime}44`, borderRadius: 999, padding: "10px 22px" }}>{c}</span>
                        ))}
                      </div>
                    </Row>
                    <Row at={START + 54}>
                      <div style={{ marginTop: 36, fontFamily: display, fontWeight: 700, fontSize: 34, color: D.ink }}>
                        Minted in <span style={{ color: D.lime, fontStyle: "italic" }}>15 minutes</span>
                      </div>
                    </Row>
                  </div>
                  <div style={{ width: 560, borderRadius: 20, overflow: "hidden", border: `1.5px solid ${D.line}` }}>
                    <OffthreadVideo src={staticFile("site/cofounder-bg.mp4")} muted
                      style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.05 + Math.min(0.08, (frame - START) * 0.0007)})` }} />
                  </div>
                </div>
              </TabPane>

              {/* STUDIO */}
              <TabPane k={1}>
                <Row at={START + SPAN + 8}><div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>STUDIO · THIS WEEK</div></Row>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16, marginTop: 22 }}>
                  {Array.from({ length: 12 }).map((_, i) => {
                    const s = spring({ frame: frame - (START + SPAN + 14 + i * 5), fps, config: { damping: 22, stiffness: 150 } });
                    return (
                      <div key={i} style={{
                        opacity: s, transform: `scale(${0.85 + s * 0.15})`,
                        height: 150, borderRadius: 16, border: `1.5px solid ${D.line}`,
                        background: i % 3 === 0 ? D.ink : D.paper2, position: "relative", overflow: "hidden",
                      }}>
                        <span style={{ position: "absolute", left: 12, bottom: 10, fontFamily: mono, fontSize: 12, color: i % 3 === 0 ? D.limeBright : D.sub }}>clip_{String(i + 1).padStart(2, "0")}</span>
                        <span style={{ position: "absolute", right: 10, top: 8, fontFamily: mono, fontSize: 11, color: i % 3 === 0 ? "rgba(255,255,255,0.6)" : D.faint }}>▶</span>
                      </div>
                    );
                  })}
                </div>
                <Row at={START + SPAN + 74}>
                  <div style={{ marginTop: 28, fontFamily: display, fontWeight: 700, fontSize: 38, color: D.ink }}>
                    <Count at={START + SPAN + 76} to={40} dur={30} style={{ color: D.lime }} />+ posts a week — <span style={{ fontStyle: "italic" }}>every one different</span>
                  </div>
                </Row>
              </TabPane>

              {/* CAMPAIGNS */}
              <TabPane k={2}>
                <Row at={START + SPAN * 2 + 8}><div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>OPEN BRIEFS · CLAIM TO EARN</div></Row>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
                  {[
                    { b: "Consumer fintech app", r: "$2.00 / 1K", pool: "$12,000 pool" },
                    { b: "Indie game launch", r: "$3.00 / 1K", pool: "$8,500 pool", hot: true },
                    { b: "Creator hardware brand", r: "$1.50 / 1K", pool: "$20,000 pool" },
                    { b: "Podcast network", r: "$2.50 / 1K", pool: "$6,000 pool" },
                  ].map((c, i) => {
                    const s = spring({ frame: frame - (START + SPAN * 2 + 16 + i * 12), fps, config: { damping: 23, stiffness: 140 } });
                    return (
                      <div key={i} style={{ opacity: s, transform: `translateX(${(1 - s) * 34}px)` }}>
                        <Card style={{ padding: "20px 30px", display: "flex", alignItems: "center", gap: 24, background: c.hot ? D.ink : "#fff" }}>
                          <span style={{ fontFamily: display, fontWeight: 650, fontSize: 27, color: c.hot ? "#fff" : D.ink, flex: 1 }}>{c.b}</span>
                          <span style={{ fontFamily: mono, fontSize: 21, fontWeight: 700, color: c.hot ? D.limeBright : D.lime }}>{c.r}</span>
                          <span style={{ fontFamily: mono, fontSize: 16, color: c.hot ? "rgba(255,255,255,0.6)" : D.sub }}>{c.pool}</span>
                          <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: c.hot ? "#0A0C08" : D.lime, background: c.hot ? D.limeBright : `${D.lime}14`, border: c.hot ? "none" : `1.5px solid ${D.lime}44`, borderRadius: 999, padding: "8px 20px" }}>
                            {c.hot ? "CLAIMED ✓" : "CLAIM"}
                          </span>
                        </Card>
                      </div>
                    );
                  })}
                </div>
                <Row at={START + SPAN * 2 + 78}>
                  <div style={{ marginTop: 24, fontFamily: display, fontWeight: 700, fontSize: 34, color: D.ink }}>
                    Paying <span style={{ color: D.lime }}>$1–3 per 1,000</span> <span style={{ fontStyle: "italic" }}>verified</span> views
                  </div>
                </Row>
              </TabPane>

              {/* EARN */}
              <TabPane k={3}>
                <Row at={START + SPAN * 3 + 8}><div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>EARNINGS · THIS MONTH</div></Row>
                <div style={{ display: "flex", gap: 36, marginTop: 22, alignItems: "stretch" }}>
                  <Card dark style={{ padding: "34px 44px", flex: 1 }}>
                    <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 3, color: "rgba(255,255,255,0.5)" }}>BALANCE</div>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 92, color: D.limeBright, lineHeight: 1.15 }}>
                      $<Count at={START + SPAN * 3 + 18} to={184} dur={56} />.30
                    </div>
                    <div style={{ fontFamily: geist, fontSize: 20, color: "rgba(255,255,255,0.85)", marginTop: 6 }}>92,150 verified views · $2.00 / 1K</div>
                    <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
                      {["Stripe", "PayPal", "USDC"].map((r) => (
                        <span key={r} style={{ fontFamily: mono, fontSize: 16, color: "#fff", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 999, padding: "9px 22px" }}>{r}</span>
                      ))}
                      <span style={{ marginLeft: "auto", fontFamily: display, fontWeight: 700, fontSize: 20, color: "#0A0C08", background: D.limeBright, borderRadius: 999, padding: "10px 30px" }}>Withdraw →</span>
                    </div>
                  </Card>
                  <div style={{ width: 420, display: "flex", flexDirection: "column", gap: 12 }}>
                    {[["Mon", "$31.40"], ["Wed", "$28.90"], ["Fri", "$46.10"], ["Sun", "$39.20"]].map(([d, v], i) => {
                      const s = spring({ frame: frame - (START + SPAN * 3 + 30 + i * 10), fps, config: { damping: 23, stiffness: 140 } });
                      return (
                        <div key={d} style={{ opacity: s, transform: `translateX(${(1 - s) * 30}px)` }}>
                          <Card style={{ padding: "16px 26px", display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontFamily: mono, fontSize: 17, color: D.sub }}>{d} · payout</span>
                            <span style={{ fontFamily: mono, fontSize: 19, fontWeight: 700, color: D.lime }}>{v}</span>
                          </Card>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </TabPane>
            </div>
          </Card>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "You", serif: true }, { t: "manage.", serif: true }, { t: "It", serif: true }, { t: "earns.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
