/**
 * L4 · "The Stack" — Pillar 5 (the math), roster-economics angle.
 * One agent covers its own rent; then you stack a roster. Distinct from the
 * rate-card (D3) and volume (G5) math films: this is the multiplication angle.
 * Explicitly labelled MODEL · BASE CASE — grounded in ~$1,200/mo gross, $50 rent,
 * break-even ~25K views @ $2/1K (vello-cmo economics). Not a testimonial.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useIn } from "./_kit";

const AgentCol: React.FC<{ at: number; n: string; x: number; grow: number }> = ({ at, n, x, grow }) => {
  const s = useIn(at, 22);
  const maxH = 360;
  const h = maxH * grow;
  const rentH = maxH * (50 / 1200);
  return (
    <div style={{ position: "absolute", left: x, bottom: 0, width: 150, opacity: s }}>
      {/* bar */}
      <div style={{ position: "relative", width: 130, height: maxH, margin: "0 auto", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        <div style={{ height: h, borderRadius: "12px 12px 0 0", background: `linear-gradient(180deg, ${D.limeBright}, ${D.lime})`, position: "relative", overflow: "hidden" }}>
          {/* rent notch at bottom */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: rentH * (h / maxH ? 1 : 1), background: "rgba(32,38,28,0.22)" }} />
        </div>
      </div>
      <div style={{ textAlign: "center", marginTop: 14, fontFamily: mono, fontSize: 14, letterSpacing: 2, color: D.faint }}>{n}</div>
      <div style={{ textAlign: "center", fontFamily: display, fontWeight: 700, fontSize: 26, color: D.ink }}>$1,150</div>
      <div style={{ textAlign: "center", fontFamily: mono, fontSize: 12, color: D.faint }}>net /mo</div>
    </div>
  );
};

export const L4TheStack: React.FC = () => {
  const frame = useCurrentFrame();
  useVideoConfig();

  // portfolio total climbs as agents land (agents at 452,496,540)
  const netTotal = interpolate(frame, [452, 470, 496, 514, 540, 566], [0, 1150, 1150, 2300, 2300, 3450], CL);
  const barGrow = (landAt: number) => interpolate(frame, [landAt, landAt + 26], [0, 1], { ...CL, easing: (x) => 1 - Math.pow(1 - x, 3) });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK (0–140) */}
      <Sect from={0} to={140}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>THE MATH · THE MODEL</Tag></Rise>
          <Line at={20} size={116} maxWidth={1400}
            words={[{ t: "Let's" }, { t: "do" }, { t: "the" }, { t: "math.", c: D.lime, serif: true }]} />
          <Rise at={70}><div style={{ fontFamily: geist, fontSize: 32, color: D.sub }}>One agent first. Then a roster.</div></Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · ONE AGENT (140–430) */}
      <Sect from={140} to={430}>
        <div style={{ position: "absolute", top: 78, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Rise at={150}><Tag>ONE AGENT · PER MONTH</Tag></Rise>
          <Line at={160} size={58} maxWidth={1500}
            words={[{ t: "It" }, { t: "covers" }, { t: "its" }, { t: "own" }, { t: "rent", c: D.lime, serif: true }, { t: "—" }, { t: "and" }, { t: "then" }, { t: "some." }]} />
        </div>
        <Rise at={210} style={{ position: "absolute", left: "50%", top: 320, transform: "translateX(-50%)" }}>
          <Card style={{ width: 940, padding: "44px 54px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              {[{ k: "GROSS", v: "$1,200", c: D.ink, sign: "" }, { k: "RENT", v: "−$50", c: "#E07A5F", sign: "" }, { k: "NET", v: "$1,150", c: D.lime, sign: "" }].map((r, i) => (
                <React.Fragment key={i}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>{r.k}</div>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 78, color: r.c, letterSpacing: -2 }}>{r.v}</div>
                  </div>
                  {i < 2 && <div style={{ fontFamily: display, fontSize: 50, color: D.faint }}>{i === 0 ? "−" : "="}</div>}
                </React.Fragment>
              ))}
            </div>
            <div style={{ marginTop: 30, background: D.paper2, borderRadius: 14, padding: "16px 22px", display: "flex", alignItems: "center", gap: 16, fontFamily: geist, fontSize: 21, color: D.sub }}>
              <span style={{ fontFamily: mono, fontSize: 14, letterSpacing: 2, color: D.lime }}>BREAK-EVEN</span>
              ~25,000 views at $2 / 1K · 40+ posts a week — week-one numbers for a working clipper.
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* S3 · THE STACK (430–720) */}
      <Sect from={430} to={720}>
        <div style={{ position: "absolute", top: 74, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <Rise at={440}><Tag light={false}>NOW STACK THE ROSTER</Tag></Rise>
          <Line at={448} size={62} maxWidth={1500}
            words={[{ t: "You're" }, { t: "not" }, { t: "clipping" }, { t: "harder." }, { t: "You're" }, { t: "running" }, { t: "a" }, { t: "roster.", c: D.lime, serif: true }]} />
        </div>

        {/* bars */}
        <div style={{ position: "absolute", left: 220, bottom: 210, width: 620, height: 360 }}>
          <AgentCol at={452} n="AGENT 01" x={20} grow={barGrow(452)} />
          <AgentCol at={496} n="AGENT 02" x={210} grow={barGrow(496)} />
          <AgentCol at={540} n="AGENT 03" x={400} grow={barGrow(540)} />
        </div>

        {/* portfolio total (dark, right) */}
        <Rise at={470} style={{ position: "absolute", right: 200, top: 360 }}>
          <Card dark style={{ width: 560, padding: "40px 48px" }}>
            <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>PORTFOLIO · NET / MONTH</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 108, color: D.limeBright, margin: "6px 0", letterSpacing: -3 }}>
              ${Math.round(netTotal).toLocaleString()}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: mono, fontSize: 16, color: "rgba(255,255,255,0.75)", letterSpacing: 1 }}>
              <span style={{ color: D.limeBright }}>▲</span> 3 agents · each pays its own rent first
            </div>
            <div style={{ marginTop: 18, fontFamily: mono, fontSize: 13, letterSpacing: 2, color: "rgba(255,255,255,0.4)" }}>MODEL · BASE CASE — NOT A GUARANTEE</div>
          </Card>
        </Rise>
      </Sect>

      {/* S4 · CTA (720–900) */}
      <Sect from={720} to={900}>
        <EndCard at={732} kicker={[{ t: "The" }, { t: "model,", serif: true }, { t: "not" }, { t: "a" }, { t: "promise.", c: D.lime, serif: true }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
