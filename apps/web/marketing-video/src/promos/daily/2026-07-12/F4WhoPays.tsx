/**
 * F4 — "Who Pays?" · Pillar 10 objection-killer (where the money comes from).
 * "Sounds too good — so who pays?" Brands fund campaign pools upfront; every
 * view is verified before a cent moves; the pool pays per verified view.
 * Layout: question title → money-flow diagram (brand → verified checkpoint →
 * agents) w/ animated flow dots → dark no-views-no-payout card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist } from "./dk";

const AGENTS = [
  { n: "@nightclipper", v: "214K views", x: 320 },
  { n: "@studiofern", v: "96K views", x: 810 },
  { n: "@kwrapid", v: "158K views", x: 1300 },
];

/* a dot travelling down a vertical path */
const FlowDot: React.FC<{ x: number; y0: number; y1: number; period: number; phase: number; start: number }> =
  ({ x, y0, y1, period, phase, start }) => {
    const frame = useCurrentFrame();
    if (frame < start) return null;
    const t = ((frame - start + phase) % period) / period;
    const o = interpolate(t, [0, 0.12, 0.85, 1], [0, 1, 1, 0]);
    return (
      <div style={{
        position: "absolute", left: x - 7, top: y0 + (y1 - y0) * t,
        width: 14, height: 14, borderRadius: 99, background: D.limeBright,
        boxShadow: `0 0 16px ${D.limeBright}`, opacity: o,
      }} />
    );
  };

export const F4WhoPays: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gate = spring({ frame: frame - 300, fps, config: { damping: 20, stiffness: 130 } });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · THE QUESTION (0–150) ══ */}
      <Sect from={0} to={150} bg={`linear-gradient(180deg, ${D.paper2} 0%, ${D.paper} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>THE OBVIOUS QUESTION</Tag></Rise>
          <Line at={18} size={92} maxWidth={1550}
            words={[{ t: "“Get" }, { t: "paid" }, { t: "to" }, { t: "post”" }, { t: "sounds" }, { t: "too", serif: true }, { t: "good.", serif: true }]} />
          <Line at={62} size={92} maxWidth={1550}
            words={[{ t: "So" }, { t: "who" }, { t: "pays?", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · MONEY FLOW DIAGRAM (150–520) ══ */}
      <Sect from={150} to={520}>
        {/* brand pool (top) */}
        <Rise at={170} style={{ position: "absolute", top: 90, left: "50%", transform: "translateX(-50%)" }}>
          <Card style={{ padding: "24px 44px", width: 760, textAlign: "center" }}>
            <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 3, color: D.faint }}>BRANDS · CAMPAIGN POOL</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 44, color: D.ink, marginTop: 6 }}>
              Funded <span style={{ color: D.lime, fontStyle: "italic" }}>upfront</span>
            </div>
            <div style={{ fontFamily: geist, fontSize: 19, color: D.sub, marginTop: 4 }}>real budgets, deposited before a single clip is posted</div>
          </Card>
        </Rise>

        {/* verification checkpoint (middle) */}
        <div style={{
          position: "absolute", top: 400, left: "50%", transform: `translateX(-50%) scale(${0.8 + gate * 0.2})`,
          opacity: gate, zIndex: 3,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            fontFamily: mono, fontSize: 19, letterSpacing: 2, color: D.ink, fontWeight: 700,
            background: "#fff", border: `2px solid ${D.lime}`, borderRadius: 99, padding: "16px 34px",
            boxShadow: `0 14px 40px rgba(101,163,13,0.25)`,
          }}>
            <span style={{ width: 12, height: 12, borderRadius: 99, background: D.limeBright, boxShadow: `0 0 12px ${D.limeBright}` }} />
            EVERY VIEW VERIFIED — BEFORE A CENT MOVES
          </div>
        </div>

        {/* flow rails: brand → checkpoint → 3 agents */}
        <FlowDot x={960} y0={268} y1={400} period={54} phase={0} start={240} />
        <FlowDot x={960} y0={268} y1={400} period={54} phase={27} start={240} />
        {AGENTS.map((a, i) => (
          <React.Fragment key={i}>
            <FlowDot x={a.x + 150} y0={462} y1={640} period={60} phase={i * 17} start={330} />
            <FlowDot x={a.x + 150} y0={462} y1={640} period={60} phase={i * 17 + 30} start={330} />
          </React.Fragment>
        ))}

        {/* agent payout chips (bottom) */}
        {AGENTS.map((a, i) => {
          const s = spring({ frame: frame - (350 + i * 22), fps, config: { damping: 22, stiffness: 130 } });
          return (
            <div key={i} style={{ position: "absolute", top: 650, left: a.x, width: 300, opacity: s, transform: `translateY(${(1 - s) * 26}px)` }}>
              <Card style={{ padding: "20px 24px", textAlign: "center" }}>
                <div style={{ fontFamily: mono, fontSize: 15, color: D.sub }}>{a.n}</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 30, color: D.lime, marginTop: 6 }}>paid per view</div>
                <div style={{ fontFamily: mono, fontSize: 14, color: D.faint, marginTop: 4 }}>{a.v} · verified</div>
              </Card>
            </div>
          );
        })}

        <div style={{ position: "absolute", bottom: 74, width: "100%", textAlign: "center" }}>
          <Rise at={440}>
            <div style={{ fontFamily: geist, fontSize: 24, color: D.ink }}>
              Campaigns pay <b style={{ color: D.lime }}>$1–3 per 1,000 verified views</b> — from brand budgets, not thin air.
            </div>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · NO VIEWS, NO PAYOUT (520–690) ══ */}
      <Sect from={520} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={532} size={62} maxWidth={1560}
            words={[{ t: "That's" }, { t: "why" }, { t: "the" }, { t: "money" }, { t: "is" }, { t: "real.", c: D.lime, serif: true }]} />
          <Rise at={572}>
            <Card dark style={{ padding: "38px 56px", width: 920, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 18 }}>THE RULE</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 54, color: "#fff", lineHeight: 1.2 }}>
                Pay per <span style={{ color: D.limeBright, fontStyle: "italic" }}>verified view</span> —<br />not per post.
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>No views → no payout. Brands trust it. You get paid from it.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Receipts,", serif: true }, { t: "not", serif: true }, { t: "promises.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
