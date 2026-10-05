/**
 * X3 — "The Window" · Pillar 8 market/investor angle.
 * Layout: editorial market brief — sky gradient, stroke-draw growth chart,
 * engagement bars, cost-collapse strip. 30s · 900 frames · Daybreak Pro.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { D, CL, EASE, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

export const X3Window: React.FC = () => {
  const frame = useCurrentFrame();

  /* chart stroke draw */
  const dash = interpolate(frame, [250, 350], [1400, 0], { ...CL, easing: EASE });
  const dotO = interpolate(frame, [345, 360], [0, 1], CL);

  /* engagement bars */
  const bh = (at: number, max: number) => interpolate(frame, [at, at + 40], [0, max], { ...CL, easing: EASE });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK (0–200) — sky moment */}
      <Sect from={0} to={200} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 80%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36 }}>
          <Rise at={8}><Tag>THE MARKET · 2026</Tag></Rise>
          <Line at={20} size={110} maxWidth={1500}
            words={[{ t: "The" }, { t: "window", c: D.lime, serif: true }, { t: "is" }, { t: "open." }]} />
          <Line at={62} size={38} color={D.sub} maxWidth={1250} weight={500} stagger={3}
            words={[{ t: "Influencer" }, { t: "marketing" }, { t: "crossed" }, { t: "the" }, { t: "chasm." }, { t: "Nobody" }, { t: "owns" }, { t: "the" }, { t: "platform", serif: true }, { t: "yet.", serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* S2 · GROWTH CHART (200–450) */}
      <Sect from={200} to={450}>
        <div style={{ position: "absolute", top: 84, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <Rise at={210}><Tag>MARKET SIZE</Tag></Rise>
          <Line at={220} size={64} maxWidth={1560}
            words={[{ t: "$40.5B" }, { t: "today." }, { t: "$152B", c: D.lime }, { t: "by" }, { t: "2031." }]} />
        </div>
        <div style={{ position: "absolute", left: 260, top: 330, width: 1400, height: 520 }}>
          <svg width="1400" height="520">
            {/* gridlines */}
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1="0" y1={80 + i * 120} x2="1400" y2={80 + i * 120} stroke={D.line} strokeWidth="1" />
            ))}
            {/* growth curve */}
            <path d="M 60 440 C 400 420, 700 360, 950 250 S 1280 90, 1340 70"
              stroke={D.lime} strokeWidth="5" fill="none" strokeLinecap="round"
              strokeDasharray="1400" strokeDashoffset={dash} />
            <circle cx="1340" cy="70" r="12" fill={D.limeBright} opacity={dotO} />
            <circle cx="60" cy="440" r="9" fill={D.ink} opacity={interpolate(frame, [252, 262], [0, 1], CL)} />
          </svg>
          <div style={{ position: "absolute", left: 20, top: 460, fontFamily: mono, fontSize: 18, color: D.sub, letterSpacing: 2 }}>2026 · $40.5B</div>
          <div style={{ position: "absolute", right: 0, top: 0, fontFamily: mono, fontSize: 18, color: D.lime, letterSpacing: 2, opacity: dotO }}>2031 · $152B</div>
          <Rise at={370} style={{ position: "absolute", left: 560, top: 130 }}>
            <Card style={{ padding: "20px 32px" }}>
              <span style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: D.ink }}>30% CAGR</span>
              <span style={{ fontFamily: geist, fontSize: 22, color: D.sub, marginLeft: 16 }}>AI slice compounding 41%/yr</span>
            </Card>
          </Rise>
        </div>
      </Sect>

      {/* S3 · ENGAGEMENT + ADOPTION (450–650) */}
      <Sect from={450} to={650}>
        <div style={{ position: "absolute", top: 84, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <Rise at={460}><Tag>WHY BRANDS MOVE</Tag></Rise>
          <Line at={470} size={64} maxWidth={1500}
            words={[{ t: "3×", c: D.lime }, { t: "the" }, { t: "engagement.", serif: true }]} />
        </div>
        {/* bars */}
        <div style={{ position: "absolute", left: 320, top: 340, display: "flex", alignItems: "flex-end", gap: 90, height: 420 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 190, height: bh(496, 130), background: D.paper2, border: `1.5px solid ${D.line}`, borderRadius: "14px 14px 0 0" }} />
            <div style={{ fontFamily: mono, fontSize: 17, color: D.sub, marginTop: 14, letterSpacing: 1.5 }}>HUMAN · 1.89%</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 190, height: bh(516, 390), background: `linear-gradient(180deg, ${D.limeBright}, ${D.lime})`, borderRadius: "14px 14px 0 0", boxShadow: `0 12px 40px ${D.limeBright}44` }} />
            <div style={{ fontFamily: mono, fontSize: 17, color: D.ink, marginTop: 14, letterSpacing: 1.5, fontWeight: 700 }}>VIRTUAL · 5.67%</div>
          </div>
        </div>
        <Rise at={560} style={{ position: "absolute", right: 300, top: 400 }}>
          <Card dark style={{ padding: "44px 54px", width: 520 }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 110, color: D.limeBright, letterSpacing: -4 }}>
              <Count at={566} to={73} suffix="%" dur={45} />
            </div>
            <div style={{ fontFamily: geist, fontSize: 25, color: "rgba(255,255,255,0.85)", marginTop: 6, lineHeight: 1.4 }}>
              of brands already use virtual influencers
            </div>
            <div style={{ fontFamily: mono, fontSize: 15, color: "rgba(255,255,255,0.5)", marginTop: 14, letterSpacing: 2 }}>
              CMOs MOVING UP TO 30% OF BUDGETS
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* S4 · COST COLLAPSE (650–770) */}
      <Sect from={650} to={770}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 60 }}>
          <Line at={660} size={58} maxWidth={1500}
            words={[{ t: "The" }, { t: "cost" }, { t: "floor" }, { t: "collapsed.", serif: true, c: D.lime }]} />
          <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
            {[
              { at: 686, v: "$380K", y: "2022", strike: true },
              { at: 706, v: "$28K", y: "EARLY 2026", strike: true },
            ].map((c, i) => (
              <React.Fragment key={i}>
                <Rise at={c.at}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 72, color: D.faint, textDecoration: "line-through", textDecorationColor: `${D.ink}55`, letterSpacing: -2 }}>{c.v}</div>
                    <div style={{ fontFamily: mono, fontSize: 16, color: D.faint, letterSpacing: 2, marginTop: 6 }}>{c.y}</div>
                  </div>
                </Rise>
                <Rise at={c.at + 8}><div style={{ fontFamily: display, fontSize: 50, color: D.faint }}>→</div></Rise>
              </React.Fragment>
            ))}
            <Rise at={730}>
              <Card dark style={{ padding: "30px 46px", textAlign: "center" }}>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 74, color: D.limeBright, letterSpacing: -2 }}>near-zero</div>
                <div style={{ fontFamily: mono, fontSize: 16, color: "rgba(255,255,255,0.65)", letterSpacing: 2, marginTop: 6 }}>ON VELLO · IN MINUTES</div>
              </Card>
            </Rise>
          </div>
        </AbsoluteFill>
      </Sect>

      {/* S5 · OUTRO (770–900) */}
      <DayOutro at={766} headline={[{ t: "Own" }, { t: "the" }, { t: "gap.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
