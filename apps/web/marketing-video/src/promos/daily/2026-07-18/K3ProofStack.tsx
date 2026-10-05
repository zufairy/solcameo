/**
 * K3 — "The Proof Stack" · proof / case studies (pillar 4) · Daybreak Pro · 30s / 900f.
 * "This isn't a pitch. It already happened." Three real verified milestones
 * slide in as dashboard slabs with filling meters; dark aggregate footer.
 * Grounded: 10K users/7 days · 42K clips/mo · $30K/mo agency · $12K/30 days.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import {
  D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, Count, useIn,
  display, mono, geist,
} from "./dk";

const Slab: React.FC<{ at: number; big: string; toNum?: number; suffix?: string; cap: string; sub: string; meter: number }> =
  ({ at, big, toNum, suffix, cap, sub, meter }) => {
    const s = useIn(at, 24);
    const frame = useCurrentFrame();
    const fill = interpolate(frame, [at + 10, at + 80], [0, meter], CL);
    return (
      <div style={{ opacity: s, transform: `translateX(${(1 - s) * 120}px)` }}>
        <Card style={{ padding: "34px 46px", width: 1400, display: "flex", alignItems: "center", gap: 44 }}>
          <div style={{ width: 360, flexShrink: 0 }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 82, color: D.ink, letterSpacing: -3, lineHeight: 1 }}>
              {toNum !== undefined ? <Count at={at + 8} to={toNum} dur={70} suffix={suffix} /> : big}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: geist, fontSize: 30, fontWeight: 600, color: D.ink, lineHeight: 1.3 }}>{cap}</div>
            <div style={{ fontFamily: mono, fontSize: 17, color: D.faint, marginTop: 6, letterSpacing: 1 }}>{sub}</div>
            <div style={{ marginTop: 18, height: 12, borderRadius: 99, background: D.paper2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${fill * 100}%`, borderRadius: 99, background: `linear-gradient(90deg, ${D.lime}, ${D.limeBright})` }} />
            </div>
          </div>
          <div style={{ fontFamily: mono, fontSize: 15, color: D.lime, border: `1px solid ${D.lime}55`, borderRadius: 99, padding: "8px 14px", letterSpacing: 1, flexShrink: 0 }}>VERIFIED</div>
        </Card>
      </div>
    );
  };

export const K3ProofStack: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)` }}>

      {/* S1 · HOOK */}
      <Sect from={0} to={200}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 22 }}>
          <Rise at={8}><Tag>PROOF · RECEIPTS ON THE TABLE</Tag></Rise>
          <Line at={20} size={104} maxWidth={1500} words={[{ t: "This" }, { t: "isn't" }, { t: "a" }, { t: "pitch." }]} />
          <Line at={54} size={104} maxWidth={1500}
            words={[{ t: "It" }, { t: "already" }, { t: "happened.", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* S2 · THE STACK */}
      <Sect from={200} to={690}>
        <div style={{ position: "absolute", top: 150, left: 0, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
          <Slab at={220} big="" toNum={10000} cap="users signed up — with zero human creators" sub="IN 7 DAYS · BOUNTY-DRIVEN, 60+ POSTS A DAY" meter={1} />
          <Slab at={300} big="" toNum={42000} suffix="" cap="clips a month — one agency, zero editors" sub="$30,000 / MONTH IN REVENUE · 3 PEOPLE" meter={0.86} />
          <Slab at={380} big="$12K" cap="cashed out — her first thirty days on Vello" sub="ONE OPERATOR · ONE AGENT ROSTER" meter={0.62} />
          {/* aggregate footer */}
          <Rise at={470} style={{ marginTop: 12 }}>
            <Card dark style={{ padding: "26px 48px", width: 1400, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: display, fontWeight: 600, fontSize: 34, color: "#fff" }}>
                Every number is a payout that <span style={{ color: D.limeBright }}>already cleared.</span>
              </div>
              <div style={{ fontFamily: mono, fontSize: 16, color: "rgba(255,255,255,0.6)", letterSpacing: 2 }}>NOT A FORECAST</div>
            </Card>
          </Rise>
        </div>
      </Sect>

      <Vignette />
      <DayOutro at={690} headline={[{ t: "Your" }, { t: "turn" }, { t: "starts" }, { t: "free.", c: D.lime, serif: true }]} />
    </AbsoluteFill>
  );
};

const W = 1920;
