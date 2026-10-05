/**
 * V4 — "The Math" · proof & economics film (30s, 16:9).
 * Angle: dry, confident, numbers-first. The agent pays its own rent.
 * Visual: terminal-ledger aesthetic, receipts, breakeven bar.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { SwarmBackground } from "../swarm/SwarmBackground";
import { CountUp } from "../components/CountUp";
import {
  SW, swTextGlow, CLAMP, SPRING_POP, display, mono,
  KineticText, Plate, Pop, Chip, VoltLine, Outro, Finish,
} from "./kit";

const LEDGER = [
  { at: 190, time: "02:14", desc: "bounty payout · gaming clip", amt: "+$18.40" },
  { at: 232, time: "03:51", desc: "bounty payout · podcast moment", amt: "+$9.12" },
  { at: 274, time: "05:22", desc: "verified views · 12,407", amt: "+$24.81" },
  { at: 316, time: "06:48", desc: "bounty payout · reaction edit", amt: "+$31.65" },
  { at: 358, time: "07:00", desc: "week one, day one", amt: "+$84.98" },
];

const Row: React.FC<{ r: (typeof LEDGER)[number]; i: number }> = ({ r, i }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - r.at, fps, config: { damping: 15 }, from: 0, to: 1 });
  const last = i === LEDGER.length - 1;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 34,
        padding: "24px 38px",
        borderBottom: last ? "none" : `1px solid ${SW.border}`,
        background: last ? `${SW.volt}10` : "transparent",
        opacity: s, transform: `translateX(${(1 - s) * 60}px)`,
        fontFamily: mono,
      }}
    >
      <span style={{ fontSize: 22, color: SW.faint, width: 88 }}>{r.time}</span>
      <span style={{ fontSize: 24, color: last ? SW.white : SW.sub, flex: 1 }}>{r.desc}</span>
      <span style={{ fontSize: 30, fontWeight: 700, color: SW.volt, textShadow: swTextGlow(SW.volt, 14) }}>{r.amt}</span>
    </div>
  );
};

export const V4TheMath: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hookOut = interpolate(frame, [150, 170], [1, 0], CLAMP);
  const ledgerIn = interpolate(frame, [166, 184], [0, 1], CLAMP);
  const ledgerOut = interpolate(frame, [436, 458], [1, 0], CLAMP);
  const rentIn = interpolate(frame, [452, 470], [0, 1], CLAMP);
  const rentOut = interpolate(frame, [700, 724], [1, 0], CLAMP);

  /* breakeven bar: rent $50 vs earnings fill */
  const earnT = interpolate(frame, [540, 640], [0, 1], {
    ...CLAMP, easing: (t) => 1 - Math.pow(1 - t, 2.2),
  });
  const BAR_W = 1150;
  const earnW = BAR_W * earnT * 1.0; // full = $170
  const rentX = (50 / 170) * BAR_W;

  return (
    <AbsoluteFill style={{ background: SW.bg }}>
      <SwarmBackground intensity={0.34} />

      {/* ── HOOK ── */}
      {frame < 172 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 46, opacity: hookOut }}>
          <Pop at={4}><Chip size={22}>THE MATH</Chip></Pop>
          <KineticText
            start={16} stagger={5} size={100} weight={700} maxWidth={1600}
            words={[
              { t: "$1–3", color: SW.volt }, { t: "per" }, { t: "1,000" }, { t: "verified" }, { t: "views." },
            ]}
          />
          <KineticText
            start={78} stagger={5} size={56} weight={500} maxWidth={1400}
            words={[
              { t: "Real" }, { t: "bounties." }, { t: "Real" }, { t: "payouts." },
              { t: "Counted" }, { t: "on-chain.", color: SW.emerald },
            ]}
          />
        </AbsoluteFill>
      )}

      {/* ── LEDGER ── */}
      {frame >= 166 && frame < 460 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: Math.min(ledgerIn, ledgerOut) }}>
          <div style={{ width: 1240, display: "flex", flexDirection: "column", gap: 30 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Chip size={20} color={SW.emerald}>AGENT · EARNINGS FEED · LIVE</Chip>
              <span style={{ fontFamily: mono, fontSize: 20, color: SW.faint, letterSpacing: 3 }}>OVERNIGHT SESSION</span>
            </div>
            <Plate glowColor={SW.volt} style={{ overflow: "hidden" }}>
              {LEDGER.map((r, i) => <Row key={i} r={r} i={i} />)}
            </Plate>
            <Pop at={392}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Chip size={20} color={SW.sub}>EVERY PAYOUT IS A SCREENSHOT · EVERY SCREENSHOT IS AN AD</Chip>
              </div>
            </Pop>
          </div>
        </AbsoluteFill>
      )}

      {/* ── RENT ── */}
      {frame >= 452 && frame < 730 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 52, opacity: Math.min(rentIn, rentOut) }}>
          <KineticText
            start={460} stagger={5} size={88} weight={700} maxWidth={1500}
            words={[
              { t: "Your" }, { t: "agent" }, { t: "pays" }, { t: "its" }, { t: "own" }, { t: "rent.", color: SW.volt },
            ]}
          />
          {/* breakeven bar */}
          <div style={{ width: BAR_W, display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ position: "relative", height: 74, borderRadius: 18, background: SW.card, border: `1.5px solid ${SW.border}`, overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, width: earnW, background: `linear-gradient(90deg, ${SW.voltDeep}, ${SW.volt})`, boxShadow: `0 0 40px ${SW.volt}66` }} />
              {/* rent marker */}
              <div style={{ position: "absolute", left: rentX, top: 0, bottom: 0, width: 3, background: SW.white, opacity: 0.85 }} />
              <div style={{ position: "absolute", left: rentX + 14, top: 12, fontFamily: mono, fontSize: 19, color: SW.white, letterSpacing: 2 }}>
                RENT · $50/MO
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 21, color: SW.sub }}>
              <span>MONTH ONE</span>
              <span style={{ color: SW.volt, fontWeight: 700, fontSize: 26 }}>
                <CountUp value={170} prefix="$" start={540} duration={100} /> EARNED
              </span>
            </div>
          </div>
          <KineticText
            start={600} stagger={4} size={52} weight={500} maxWidth={1500}
            words={[
              { t: "Breaks" }, { t: "even" }, { t: "at" }, { t: "25K", color: SW.volt }, { t: "views" },
              { t: "—" }, { t: "week-one" }, { t: "numbers." },
            ]}
          />
          <Pop at={648}>
            <Chip size={20} color={SW.emerald}>NO CARD TO START · CANCEL IN ONE CLICK · DEDUCTED FROM EARNINGS FIRST</Chip>
          </Pop>
        </AbsoluteFill>
      )}

      <Outro at={734} cta="Run the math yourself — free for 30 days" />
      <Finish />
    </AbsoluteFill>
  );
};
