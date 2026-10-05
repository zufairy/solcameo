/**
 * K1 — "Three Minutes" · consumer hook (pillar 1) · Daybreak Pro · 30s / 900f.
 * The time it takes you to make coffee, your agent already found a campaign,
 * clipped, posted, and started earning. Centered countdown ring + a personal
 * event feed cascading beside it. Ends with a small dark payout chip → outro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import {
  D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, useIn,
  display, mono, geist,
} from "./dk";

const W = 1920, H = 1080;

/* one line in the personal event feed */
const Beat: React.FC<{ at: number; tc: string; label: string; accent?: boolean }> = ({ at, tc, label, accent }) => {
  const s = useIn(at, 22);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20,
      opacity: s, transform: `translateX(${(1 - s) * 40}px)`,
    }}>
      <span style={{
        fontFamily: mono, fontSize: 22, letterSpacing: 1, color: accent ? D.lime : D.faint,
        width: 92, textAlign: "right",
      }}>{tc}</span>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: accent ? D.limeBright : D.line, flexShrink: 0 }} />
      <span style={{ fontFamily: geist, fontSize: 30, fontWeight: accent ? 700 : 500, color: accent ? D.ink : D.sub }}>{label}</span>
    </div>
  );
};

export const K1ThreeMinutes: React.FC = () => {
  const frame = useCurrentFrame();

  /* countdown 3:00 → 0:00 across the scene */
  const secs = interpolate(frame, [230, 640], [180, 0], CL);
  const mm = Math.max(0, Math.floor(secs / 60));
  const ss = Math.max(0, Math.floor(secs % 60));
  const clock = `${mm}:${String(ss).padStart(2, "0")}`;
  const R = 168, C = 2 * Math.PI * R;
  const prog = interpolate(frame, [230, 640], [0, 1], CL);

  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 60%)` }}>

      {/* S1 · HOOK */}
      <Sect from={0} to={210}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
          <Rise at={8}><Tag>CONSUMER · A COFFEE'S WORTH OF TIME</Tag></Rise>
          <Line at={20} size={116} maxWidth={1500}
            words={[{ t: "Give" }, { t: "it" }, { t: "three" }, { t: "minutes.", c: D.lime, serif: true }]} />
          <Rise at={64}>
            <div style={{ fontFamily: geist, fontSize: 40, color: D.sub }}>The time it takes to make coffee.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · THE TIMER + FEED */}
      <Sect from={210} to={690}>
        {/* countdown ring — left */}
        <div style={{ position: "absolute", left: 190, top: 300 }}>
          <svg width={420} height={420} style={{ overflow: "visible" }}>
            <circle cx={210} cy={210} r={R} fill="none" stroke={D.line} strokeWidth={14} />
            <circle cx={210} cy={210} r={R} fill="none" stroke={D.limeBright} strokeWidth={14}
              strokeLinecap="round" transform="rotate(-90 210 210)"
              strokeDasharray={C} strokeDashoffset={C * prog} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: mono, fontSize: 96, fontWeight: 700, color: D.ink, letterSpacing: -2 }}>{clock}</div>
            <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: 4, color: D.faint, marginTop: 4 }}>REMAINING</div>
          </div>
        </div>

        {/* personal event feed — right */}
        <div style={{ position: "absolute", left: 760, top: 300, display: "flex", flexDirection: "column", gap: 30 }}>
          <Rise at={220}>
            <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: 3, color: D.faint, marginBottom: 6 }}>
              WHILE YOUR CUP FILLS, YOUR AGENT…
            </div>
          </Rise>
          <Beat at={252} tc="00:12" label="found a live campaign" />
          <Beat at={300} tc="00:41" label="cut 4 clips from one video" />
          <Beat at={352} tc="01:20" label="posted → TikTok" />
          <Beat at={378} tc="01:22" label="posted → Reels" />
          <Beat at={404} tc="01:24" label="posted → Shorts" />
          <Beat at={470} tc="02:35" label="first verified views land" accent />
          {/* payout chip (dark money moment) */}
          <Rise at={548} style={{ marginTop: 8 }}>
            <Card dark style={{ padding: "26px 34px", width: 620, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 3, color: "rgba(255,255,255,0.5)" }}>ALREADY EARNING</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: "#fff", marginTop: 4 }}>
                  $1–3 <span style={{ color: D.limeBright }}>/ 1,000</span> verified views
                </div>
              </div>
              <div style={{ fontFamily: mono, fontSize: 15, color: D.limeBright, border: `1px solid ${D.limeBright}55`, borderRadius: 99, padding: "8px 16px", letterSpacing: 1 }}>PAID</div>
            </Card>
          </Rise>
          <Rise at={600}>
            <div style={{ fontFamily: geist, fontSize: 26, color: D.sub }}>You didn't open an app. You didn't write a caption.</div>
          </Rise>
        </div>
      </Sect>

      <Vignette />
      <DayOutro at={690} headline={[{ t: "Get" }, { t: "paid" }, { t: "to" }, { t: "post," }, { t: "without", c: D.lime, serif: true }, { t: "posting.", c: D.lime, serif: true }]} />
    </AbsoluteFill>
  );
};
