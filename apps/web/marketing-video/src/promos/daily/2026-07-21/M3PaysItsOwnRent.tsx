/**
 * M3 · "Pays Its Own Rent" — Pillar 5 (the math).
 * A rent-receipt framing: $50/mo cost line, an income meter filling to cover it
 * at view #25,000 (@ $2/1K), surplus flowing to the owner. Distinct from the
 * rate-card calculator (D3) and the 160-tile volume grid (G5): this is a single
 * break-even receipt — the agent literally paying its own subscription.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useCount, useIn } from "./_kit";

export const M3PaysItsOwnRent: React.FC = () => {
  const frame = useCurrentFrame();

  // fill meter: 0 → 25,000 views covers the $50 rent, then keeps going to 40,000
  const viewsCount = useCount(210, 300, 40000);
  const earned = viewsCount * 0.002; // $2 per 1,000
  const coverPct = Math.min(1, earned / 50);
  const surplus = Math.max(0, earned - 50);
  const meterFill = interpolate(frame, [210, 510], [0, 40000 / 25000], CL); // relative to break-even = 1.0 at 25k

  return (
    <AbsoluteFill style={{ background: D.paper }}>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.sky}44 0%, ${D.paper} 40%)` }} />

      {/* S1 · HOOK (0–150) */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
          <Rise at={8}><Tag>THE MATH · BREAK-EVEN</Tag></Rise>
          <Line at={20} size={110} maxWidth={1580}
            words={[{ t: "It" }, { t: "pays" }, { t: "its" }, { t: "own", c: D.lime, serif: true }, { t: "rent.", c: D.lime, serif: true }]} />
          <Rise at={78}><div style={{ fontFamily: geist, fontSize: 32, color: D.sub }}>The math nobody bothers to show you.</div></Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · THE RECEIPT (150–720) */}
      <Sect from={150} to={720}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Rise at={162}>
            <Card style={{ width: 1180, padding: 48 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
                <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: 3, color: D.lime }}>AGENT · MONTHLY P&amp;L</div>
                <div style={{ fontFamily: mono, fontSize: 15, color: D.faint }}>@ $2 / 1,000 verified views</div>
              </div>

              {/* cost line */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 0", borderBottom: `1px solid ${D.line}` }}>
                <span style={{ fontFamily: geist, fontSize: 30, color: D.sub }}>Vello subscription</span>
                <span style={{ fontFamily: display, fontWeight: 700, fontSize: 42, color: D.ink }}>−$50.00</span>
              </div>

              {/* meter */}
              <div style={{ margin: "34px 0 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 16, color: D.faint, marginBottom: 10 }}>
                  <span>VIEWS EARNED THIS MONTH</span>
                  <span style={{ color: D.ink }}>{viewsCount.toLocaleString()}</span>
                </div>
                <div style={{ position: "relative", height: 40, borderRadius: 12, background: D.paper2, border: `1px solid ${D.line}`, overflow: "hidden" }}>
                  {/* break-even marker at 25k of the 40k scale => 62.5% */}
                  <div style={{ position: "absolute", left: `${(25000 / 40000) * 100}%`, top: 0, bottom: 0, width: 2, background: D.ink, zIndex: 3 }} />
                  <div style={{ position: "absolute", left: `${(25000 / 40000) * 100}%`, top: -26, transform: "translateX(-50%)", fontFamily: mono, fontSize: 13, color: D.ink, whiteSpace: "nowrap" }}>break-even · 25K</div>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, (viewsCount / 40000) * 100)}%`, background: viewsCount >= 25000 ? D.limeBright : D.skyDeep, transition: "width 0.1s" }} />
                </div>
              </div>

              {/* earned + surplus rows */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "18px 0 6px" }}>
                <span style={{ fontFamily: geist, fontSize: 30, color: D.sub }}>Earned</span>
                <span style={{ fontFamily: display, fontWeight: 700, fontSize: 42, color: D.ink }}>+${earned.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 22px", borderRadius: 14, background: surplus > 0 ? `${D.limeBright}22` : "transparent", border: `1.5px solid ${surplus > 0 ? D.lime + "55" : "transparent"}` }}>
                <span style={{ fontFamily: display, fontWeight: 700, fontSize: 32, color: D.ink }}>Surplus to you</span>
                <span style={{ fontFamily: display, fontWeight: 700, fontSize: 52, color: D.lime }}>+${surplus.toFixed(2)}</span>
              </div>
              <div style={{ marginTop: 20, fontFamily: geist, fontSize: 22, color: D.sub }}>
                Rent covered at view 25,000 — and it posts <span style={{ color: D.ink, fontWeight: 600 }}>40+ clips a week.</span>
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S3 · MONEY STATEMENT (720–800) */}
      <Sect from={720} to={800}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Rise at={728}>
            <Card dark style={{ padding: "40px 56px", maxWidth: 1180 }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 56, color: "#fff", lineHeight: 1.1, textAlign: "center" }}>
                Everything after break-even <span style={{ color: D.limeBright }}>is yours.</span>
              </div>
              <div style={{ marginTop: 16, fontFamily: mono, fontSize: 19, letterSpacing: 2, color: "rgba(255,255,255,0.6)", textAlign: "center" }}>~$1,200 / MONTH BLENDED PER AGENT</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S4 · CTA (800–900) */}
      <Sect from={800} to={900}>
        <EndCard at={808} kicker={[{ t: "Free" }, { t: "30" }, { t: "days.", c: D.lime, serif: true }, { t: "No" }, { t: "card." }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
