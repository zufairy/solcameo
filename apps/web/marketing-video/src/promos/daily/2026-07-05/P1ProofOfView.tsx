/**
 * P1 — "Proof of View" · Pillar 3 feature deep-dive.
 * The payout rail: post → oracle verifies views on-chain → USDC streams to wallet.
 * Layout: live ledger world. Dark data cards for the money/chain moments.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, Loop, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, EASE, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist } from "./dk";

/* a settling ledger row (verified view attestation) */
const TxRow: React.FC<{ at: number; hash: string; views: string; usdc: string; y: number }> =
  ({ at, hash, views, usdc, y }) => {
    const frame = useCurrentFrame();
    const s = spring({ frame: frame - at, fps: 30, config: { damping: 24, stiffness: 130 } });
    return (
      <div style={{
        position: "absolute", left: 0, right: 0, top: y,
        opacity: s, transform: `translateX(${(1 - s) * 40}px)`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 26px", borderRadius: 14, background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: D.limeBright, boxShadow: `0 0 10px ${D.limeBright}` }} />
          <span style={{ fontFamily: mono, fontSize: 18, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>{hash}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <span style={{ fontFamily: mono, fontSize: 19, color: "rgba(255,255,255,0.82)" }}>{views} views</span>
          <span style={{ fontFamily: display, fontWeight: 700, fontSize: 22, color: D.limeBright, width: 120, textAlign: "right" }}>{usdc}</span>
        </div>
      </div>
    );
  };

const Stage: React.FC<{ at: number; n: string; t: string; s: string; x: number }> = ({ at, n, t, s, x }) => (
  <Rise at={at} style={{ position: "absolute", left: x, top: 0 }}>
    <Card style={{ padding: "26px 30px", width: 300 }}>
      <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>{n}</div>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: D.ink, margin: "8px 0 6px" }}>{t}</div>
      <div style={{ fontFamily: geist, fontSize: 18, color: D.sub, lineHeight: 1.35 }}>{s}</div>
    </Card>
  </Rise>
);

export const P1ProofOfView: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · HOOK — the counter (0–180) ══ */}
      <Sect from={0} to={180}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>ON-CHAIN · VERIFIED VIEWS</Tag></Rise>
          <Line at={18} size={92} maxWidth={1500}
            words={[{ t: "Every" }, { t: "view" }, { t: "gets" }, { t: "counted.", c: D.lime, serif: true }]} />
          <Rise at={60} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: 4, color: D.faint }}>VERIFIED THIS WEEK</div>
            <Count at={64} to={412880} dur={96} style={{ fontFamily: display, fontWeight: 700, fontSize: 128, color: D.ink, letterSpacing: -4 }} />
          </Rise>
          <Rise at={120}>
            <div style={{ fontFamily: geist, fontSize: 26, color: D.sub }}>Not estimated. <span style={{ color: D.lime, fontWeight: 600 }}>Counted.</span></div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · THE MECHANIC (180–470) ══ */}
      <Sect from={180} to={470}>
        <div style={{ position: "absolute", top: 88, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <Rise at={190}><Tag>THE RAIL</Tag></Rise>
          <Line at={200} size={64} maxWidth={1500}
            words={[{ t: "Post." }, { t: "Verify." }, { t: "Get" }, { t: "paid.", c: D.lime }]} />
        </div>
        <div style={{ position: "absolute", left: 210, top: 360, width: 1500, height: 200 }}>
          <Stage at={224} n="01" t="Post" s="Your agent posts the clip to every platform." x={0} />
          <Stage at={268} n="02" t="Verify" s="An oracle attests the real views on-chain." x={600} />
          <Stage at={312} n="03" t="Payout" s="USDC streams from the pool to your wallet." x={1200} />
          <svg width="1500" height="200" style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
            <path d="M 300 60 L 600 60" stroke={D.lime} strokeWidth="3" fill="none" strokeDasharray="300" strokeDashoffset={interpolate(frame, [292, 322], [300, 0], CL)} />
            <path d="M 900 60 L 1200 60" stroke={D.lime} strokeWidth="3" fill="none" strokeDasharray="300" strokeDashoffset={interpolate(frame, [336, 366], [300, 0], CL)} />
          </svg>
        </div>
        <Rise at={360} style={{ position: "absolute", left: 210, top: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: mono, fontSize: 19, color: D.sub, letterSpacing: 2 }}>
            <span style={{ color: D.lime, fontSize: 22 }}>✓</span> ORACLE-VERIFIED BEFORE A SINGLE DOLLAR MOVES
          </div>
        </Rise>
      </Sect>

      {/* ══ S3 · THE LEDGER (470–700) ══ dark money moment */}
      <Sect from={470} to={700}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Card dark style={{ padding: "44px 50px", width: 1160 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26 }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: "rgba(255,255,255,0.5)" }}>SETTLEMENT LEDGER · SOLANA</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: "#fff", marginTop: 6 }}>
                  $1–3 <span style={{ color: D.limeBright }}>/ 1,000 verified views</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 2, color: "rgba(255,255,255,0.5)" }}>PAID TO WALLET</div>
                <Count at={560} to={1247} prefix="$" dur={80} style={{ fontFamily: display, fontWeight: 700, fontSize: 56, color: D.limeBright }} />
              </div>
            </div>
            <div style={{ position: "relative", height: 260 }}>
              <TxRow at={500} hash="tx 8fK…a20" views="61,400" usdc="+$122" y={0} />
              <TxRow at={534} hash="tx 3mQ…7c9" views="48,900" usdc="+$97" y={64} />
              <TxRow at={568} hash="tx b1D…f4e" views="72,100" usdc="+$144" y={128} />
              <TxRow at={602} hash="tx 9zR…8a1" views="38,600" usdc="+$77" y={192} />
            </div>
            <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 12, fontFamily: mono, fontSize: 17, color: "rgba(255,255,255,0.7)", letterSpacing: 1 }}>
              <span style={{ color: "#22D3EE" }}>◎</span> STRAIGHT TO YOUR WALLET · NO INVOICES · NO WAITING
            </div>
          </Card>
        </AbsoluteFill>
      </Sect>

      {/* tiny live proof clip, upper-right through the mechanic */}
      {frame > 190 && frame < 460 && (
        <Rise at={200} style={{ position: "absolute", right: 150, top: 150 }}>
          <div style={{ width: 128, height: 232, borderRadius: 22, background: D.ink, padding: 7, boxShadow: "0 20px 40px rgba(32,38,28,0.25)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 16, overflow: "hidden" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted startFrom={40} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </div>
        </Rise>
      )}

      {/* ══ OUTRO (700–900) ══ */}
      <DayOutro at={694} headline={[{ t: "Views" }, { t: "in." }, { t: "Payouts", c: D.lime, serif: true }, { t: "out.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
