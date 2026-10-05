/**
 * V1 — "The Overnight Shift" · Pillar 1 consumer hook (receipts, not promises).
 * You slept; the agent clipped, captioned, and posted 47× across platforms.
 * Layout: pre-dawn lock-screen → overnight log (dark card) → sunrise payout.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, EASE, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist } from "./dk";

/* a posted-clip row inside the overnight log */
const LogRow: React.FC<{ at: number; time: string; plat: string; y: number }> = ({ at, time, plat, y }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 24, stiffness: 130 } });
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, top: y, opacity: s,
      transform: `translateX(${(1 - s) * 34}px)`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 24px", borderRadius: 13, background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ width: 9, height: 9, borderRadius: 99, background: D.limeBright, boxShadow: `0 0 10px ${D.limeBright}` }} />
        <span style={{ fontFamily: mono, fontSize: 18, color: "rgba(255,255,255,0.55)", letterSpacing: 1 }}>{time}</span>
      </div>
      <span style={{ fontFamily: mono, fontSize: 18, color: "rgba(255,255,255,0.85)" }}>posted → {plat}</span>
    </div>
  );
};

export const V1Overnight: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · NIGHT HOOK (0–200) ══ pre-dawn */}
      <Sect from={0} to={200} bg={`linear-gradient(180deg, #1b2530 0%, #33414d 45%, ${D.paper} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag light>03:14 · OVERNIGHT</Tag></Rise>
          <Line at={18} size={92} maxWidth={1500} color="#fff"
            words={[{ t: "You" }, { t: "were" }, { t: "asleep.", serif: true, c: "#cfd7dc" }]} />
          <Line at={44} size={92} maxWidth={1500} color="#fff"
            words={[{ t: "Your" }, { t: "agent" }, { t: "wasn’t.", c: D.limeBright, serif: true }]} />
          <Rise at={96}>
            <div style={{ fontFamily: geist, fontSize: 27, color: "rgba(255,255,255,0.72)" }}>
              No posting. No night shift.
            </div>
          </Rise>
        </AbsoluteFill>
        {/* phone with lock-screen clip, lower-right */}
        <Rise at={70} style={{ position: "absolute", right: 210, top: 250 }}>
          <div style={{ width: 150, height: 300, borderRadius: 28, background: "#0c0f0a", padding: 8, boxShadow: "0 30px 60px rgba(0,0,0,0.5)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 22, overflow: "hidden", position: "relative" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted startFrom={60} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.35), transparent 40%)" }} />
              <div style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center", fontFamily: mono, fontSize: 13, color: "rgba(255,255,255,0.85)" }}>3:14 AM</div>
            </div>
          </div>
        </Rise>
      </Sect>

      {/* ══ S2 · THE OVERNIGHT LOG (200–470) ══ dark card, count to 47 */}
      <Sect from={200} to={470}>
        <div style={{ position: "absolute", top: 84, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Rise at={210}><Tag>WHILE YOU SLEPT · THE RECEIPT</Tag></Rise>
          <Line at={220} size={60} maxWidth={1500}
            words={[{ t: "It" }, { t: "clipped." }, { t: "It" }, { t: "posted.", c: D.lime }]} />
        </div>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Card dark style={{ padding: "38px 46px", width: 1080, marginTop: 60 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 3, color: "rgba(255,255,255,0.5)" }}>OVERNIGHT LOG · 11PM → 7AM</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: "#fff", marginTop: 6 }}>Clips posted, hands-free</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Count at={250} to={47} dur={90} style={{ fontFamily: display, fontWeight: 700, fontSize: 92, color: D.limeBright, letterSpacing: -3 }} />
                <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: "rgba(255,255,255,0.5)" }}>CLIPS · TIKTOK · REELS · SHORTS</div>
              </div>
            </div>
            <div style={{ position: "relative", height: 210 }}>
              <LogRow at={250} time="11:42 PM" plat="TikTok" y={0} />
              <LogRow at={286} time="01:07 AM" plat="Reels" y={58} />
              <LogRow at={322} time="03:14 AM" plat="Shorts" y={116} />
              <LogRow at={358} time="05:59 AM" plat="X" y={174} />
            </div>
          </Card>
        </AbsoluteFill>
      </Sect>

      {/* ══ S3 · SUNRISE PAYOUT (470–700) ══ */}
      <Sect from={470} to={700} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 60%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={480}><Tag>SUNRISE · THE PAYOUT LANDED</Tag></Rise>
          <Line at={492} size={70} maxWidth={1500}
            words={[{ t: "$1–3" }, { t: "per" }, { t: "1,000" }, { t: "verified", c: D.lime }, { t: "views.", c: D.lime, serif: true }]} />
          <Rise at={560}>
            <Card style={{ padding: "26px 40px", display: "flex", alignItems: "center", gap: 34 }}>
              <div style={{ fontFamily: geist, fontSize: 24, color: D.sub }}>Cash out to</div>
              <div style={{ display: "flex", gap: 14 }}>
                {["Stripe", "PayPal", "USDC"].map((r, i) => (
                  <div key={i} style={{ fontFamily: display, fontWeight: 700, fontSize: 24, color: D.ink, background: D.paper2, borderRadius: 12, padding: "10px 22px" }}>{r}</div>
                ))}
              </div>
            </Card>
          </Rise>
          <Rise at={610}>
            <div style={{ fontFamily: geist, fontSize: 26, color: D.sub }}>
              Get paid to post — <span style={{ color: D.lime, fontWeight: 600 }}>without posting.</span>
            </div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={694} headline={[{ t: "You" }, { t: "sleep." }, { t: "It", serif: true }, { t: "earns.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
