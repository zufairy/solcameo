/**
 * L1 · "Around the Clock" — Pillar 6 (swarm / always-on scale).
 * A 24-hour radial dial: the agent's day, every hour covered. A sweep hand
 * rotates through the day, event chips pop as it passes, a center readout
 * counts posts climbing to 47. Angle: no night shift — because there's no shift.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useCount, useIn } from "./_kit";

const CX = 700, CY = 560, R = 300;
const ang = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2;
const px = (h: number, r: number) => CX + Math.cos(ang(h)) * r;
const py = (h: number, r: number) => CY + Math.sin(ang(h)) * r;

/* dial section runs 150→620; sweep maps hour 0..24 over 175..600 */
const SWEEP_A = 175, SWEEP_B = 600;
const hourAtFrame = (f: number) => interpolate(f, [SWEEP_A, SWEEP_B], [0, 24], CL);
const frameAtHour = (h: number) => interpolate(h, [0, 24], [SWEEP_A, SWEEP_B]);

const EVENTS = [
  { h: 2, label: "Cutting 6 clips", sub: "02:00 · Studio" },
  { h: 6, label: "Posting · TikTok / Reels / Shorts", sub: "06:00 · Auto-post" },
  { h: 9, label: "Claimed a $2 / 1K brief", sub: "09:00 · Campaigns" },
  { h: 13, label: "12,400 views verified → paid", sub: "13:00 · Oracle" },
  { h: 18, label: "Tonight's batch queued", sub: "18:00 · Studio" },
  { h: 23, label: "Still posting", sub: "23:00 · Never idle" },
];

const EventChip: React.FC<{ h: number; label: string; sub: string; side: "l" | "r" }> = ({ h, label, sub, side }) => {
  const at = frameAtHour(h) - 4;
  const s = useIn(at, 20);
  const ex = px(h, R + 6), ey = py(h, R + 6);
  const cardW = 340;
  const cardX = side === "r" ? ex + 34 : ex - 34 - cardW;
  return (
    <>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <line x1={ex} y1={ey} x2={side === "r" ? ex + 30 : ex - 30} y2={ey} stroke={D.lime} strokeWidth={2} opacity={s * 0.7} />
        <circle cx={ex} cy={ey} r={7} fill={D.limeBright} opacity={s} />
      </svg>
      <div style={{
        position: "absolute", left: cardX, top: ey - 34, width: cardW, opacity: s,
        transform: `translateX(${(1 - s) * (side === "r" ? -16 : 16)}px)`,
      }}>
        <Card style={{ padding: "14px 20px" }}>
          <div style={{ fontFamily: geist, fontWeight: 700, fontSize: 21, color: D.ink, lineHeight: 1.2 }}>{label}</div>
          <div style={{ fontFamily: mono, fontSize: 13, color: D.faint, letterSpacing: 1.5, marginTop: 4 }}>{sub}</div>
        </Card>
      </div>
    </>
  );
};

export const L1AroundTheClock: React.FC = () => {
  const frame = useCurrentFrame();
  useVideoConfig();

  const hourNow = hourAtFrame(frame);
  const sweepDeg = (hourNow / 24) * 360;
  const posts = useCount(190, 400, 47);

  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 60%)` }}>

      {/* S1 · HOOK (0–150) */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
          <Rise at={8}><Tag>SWARM · ALWAYS ON</Tag></Rise>
          <Line at={20} size={104} maxWidth={1500}
            words={[{ t: "Nine" }, { t: "to" }, { t: "five" }, { t: "was" }, { t: "a" }, { t: "human" }, { t: "problem.", c: D.lime, serif: true }]} />
          <Rise at={70}>
            <div style={{ fontFamily: geist, fontSize: 34, color: D.sub }}>Your agent doesn't clock in.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · THE DIAL (150–620) */}
      <Sect from={150} to={620}>
        {/* header */}
        <div style={{ position: "absolute", top: 70, width: "100%", display: "flex", justifyContent: "center" }}>
          <Rise at={162}><Tag>ONE AGENT · 24 HOURS</Tag></Rise>
        </div>

        {/* dial */}
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          {/* night arc (20:00 → 06:00) shaded band */}
          <path
            d={`M ${px(20, R)} ${py(20, R)} A ${R} ${R} 0 0 1 ${px(30, R)} ${py(30, R)}`}
            stroke="rgba(32,38,28,0.10)" strokeWidth={26} fill="none" strokeLinecap="round"
          />
          {/* base ring */}
          <circle cx={CX} cy={CY} r={R} stroke={D.line} strokeWidth={2} fill="none" />
          {/* progress ring draws with sweep */}
          <circle cx={CX} cy={CY} r={R} stroke={D.lime} strokeWidth={5} fill="none"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * R}
            strokeDashoffset={2 * Math.PI * R * (1 - Math.min(hourNow, 24) / 24)}
            transform={`rotate(-90 ${CX} ${CY})`}
            opacity={frame > SWEEP_A ? 1 : 0}
          />
          {/* hour ticks */}
          {Array.from({ length: 24 }).map((_, h) => {
            const major = h % 6 === 0;
            const r1 = R - (major ? 22 : 12), r2 = R;
            return <line key={h} x1={px(h, r1)} y1={py(h, r1)} x2={px(h, r2)} y2={py(h, r2)} stroke={major ? D.ink : D.faint} strokeWidth={major ? 3 : 1.5} opacity={major ? 0.8 : 0.4} />;
          })}
          {/* sweep hand */}
          <g transform={`rotate(${sweepDeg - 90} ${CX} ${CY})`} opacity={frame > SWEEP_A ? 1 : 0}>
            <line x1={CX} y1={CY} x2={CX + R - 30} y2={CY} stroke={D.lime} strokeWidth={3} />
            <circle cx={CX + R - 30} cy={CY} r={9} fill={D.limeBright} stroke={D.card} strokeWidth={3} />
          </g>
          <circle cx={CX} cy={CY} r={7} fill={D.ink} />
        </svg>

        {/* hour labels at 12 / 6 / 18 / 0 */}
        {[{ h: 0, t: "24:00" }, { h: 6, t: "06:00" }, { h: 12, t: "12:00" }, { h: 18, t: "18:00" }].map(({ h, t }) => (
          <div key={t} style={{ position: "absolute", left: px(h, R + 52) - 40, top: py(h, R + 52) - 12, width: 80, textAlign: "center", fontFamily: mono, fontSize: 16, letterSpacing: 2, color: D.faint }}>{t}</div>
        ))}

        {/* center readout */}
        <div style={{ position: "absolute", left: CX - 150, top: CY - 92, width: 300, textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>POSTS TODAY</div>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 130, color: D.ink, lineHeight: 1, letterSpacing: -4 }}>{posts}</div>
          <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 2, color: D.lime }}>24 / 24 HOURS COVERED</div>
        </div>

        {/* event chips */}
        <EventChip h={2} label={EVENTS[0].label} sub={EVENTS[0].sub} side="l" />
        <EventChip h={6} label={EVENTS[1].label} sub={EVENTS[1].sub} side="l" />
        <EventChip h={9} label={EVENTS[2].label} sub={EVENTS[2].sub} side="l" />
        <EventChip h={13} label={EVENTS[3].label} sub={EVENTS[3].sub} side="r" />
        <EventChip h={18} label={EVENTS[4].label} sub={EVENTS[4].sub} side="r" />
        <EventChip h={23} label={EVENTS[5].label} sub={EVENTS[5].sub} side="r" />

        {/* right-side statement */}
        <div style={{ position: "absolute", right: 90, top: 150, width: 360 }}>
          <Rise at={520}>
            <Line at={520} size={54} align="left" maxWidth={360}
              words={[{ t: "No" }, { t: "night" }, { t: "shift." }, { t: "No" }, { t: "shift", c: D.lime, serif: true }, { t: "at" }, { t: "all.", c: D.lime, serif: true }]} />
          </Rise>
        </div>
      </Sect>

      {/* S3 · PAYOFF (620–770) */}
      <Sect from={620} to={770}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
          <Line at={632} size={74} maxWidth={1500}
            words={[{ t: "40+" }, { t: "posts" }, { t: "a" }, { t: "week." }, { t: "Every" }, { t: "hour", c: D.lime }, { t: "covered." }]} />
          <Rise at={676}>
            <Card dark style={{ padding: "38px 54px", display: "flex", alignItems: "center", gap: 48 }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>YOU WAKE UP TO</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 48, color: "#fff", marginTop: 6 }}>Receipts, not a to-do list.</div>
              </div>
              <div style={{ width: 1, height: 80, background: "rgba(255,255,255,0.15)" }} />
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 72, color: D.limeBright }}>$1–3<span style={{ fontFamily: mono, fontSize: 22, color: "rgba(255,255,255,0.6)" }}> /1K verified</span></div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S4 · CTA (770–900) */}
      <Sect from={770} to={900}>
        <EndCard at={782} kicker={[{ t: "Get" }, { t: "paid" }, { t: "to" }, { t: "post" }, { t: "—" }, { t: "without" }, { t: "posting.", c: D.lime, serif: true }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
