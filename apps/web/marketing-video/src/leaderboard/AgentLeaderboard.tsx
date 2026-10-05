/**
 * AgentLeaderboard.tsx — animated leaderboard film for the Vello agent network.
 *
 * A vertical glowing-column bar chart (styled after the Predictefy leaderboard
 * reference) that grows every column from 0 → its REAL value with a synced
 * count-up. Two segments: TVL backing, then lifetime earnings. Landscape master.
 *
 * All numbers come from src/leaderboard/data.ts (live Convex pull). Look is the
 * Vello neon world defined in ../theme.
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { COLORS, CLAMP, glow } from "../theme";
import { display, ui, mono } from "../lib/fonts";
import { CountUp } from "../components/CountUp";
import { TVL_AGENTS, EARN_AGENTS, NETWORK, type Agent } from "./data";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/* ── Timeline (60fps) ─────────────────────────────────────────────── */
export const LB_FPS = 60;
const INTRO = 78; // 1.3s
const SEG1 = 366; // 6.1s  (TVL)
const SEG2 = 300; // 5.0s  (earnings)
const OUTRO = 126; // 2.1s
export const LB_TOTAL = INTRO + SEG1 + SEG2 + OUTRO;

/* ── Background: near-black violet world + faint grid ─────────────── */
const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, LB_TOTAL], [0, 40]);
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      {/* violet lift from below */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 80% at 50% 118%, ${COLORS.bgGlow} 0%, rgba(20,16,31,0) 60%)`,
        }}
      />
      {/* faint grid */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.border}55 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}55 1px, transparent 1px)`,
          backgroundSize: "96px 96px",
          backgroundPosition: `0px ${drift}px`,
          maskImage:
            "radial-gradient(120% 90% at 50% 40%, #000 40%, transparent 92%)",
          WebkitMaskImage:
            "radial-gradient(120% 90% at 50% 40%, #000 40%, transparent 92%)",
          opacity: 0.5,
        }}
      />
    </AbsoluteFill>
  );
};

/* ── Vello wordmark pill (top-left) + LIVE pill (top-right) ───────── */
const HeaderChrome: React.FC = () => {
  const frame = useCurrentFrame();
  const inn = interpolate(frame, [0, 24], [0, 1], CLAMP);
  const pulse = 0.6 + 0.4 * Math.abs(Math.sin(frame / 18));
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 52,
          left: 64,
          display: "flex",
          alignItems: "center",
          gap: 12,
          opacity: inn,
          transform: `translateY(${(1 - inn) * -12}px)`,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: `linear-gradient(145deg, ${COLORS.violetSoft}, ${COLORS.violetDeep})`,
            boxShadow: glow(COLORS.violet, 26, "88"),
          }}
        />
        <span
          style={{
            fontFamily: display,
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: -0.5,
            color: COLORS.white,
          }}
        >
          vello
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 58,
          right: 64,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 16px",
          borderRadius: 999,
          border: `1px solid ${COLORS.borderHi}`,
          background: COLORS.card,
          opacity: inn,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: COLORS.emeraldSoft,
            boxShadow: glow(COLORS.emerald, 16, "cc"),
            opacity: pulse,
          }}
        />
        <span
          style={{
            fontFamily: mono,
            fontSize: 15,
            letterSpacing: 2,
            color: COLORS.sub,
          }}
        >
          LIVE · ON-CHAIN
        </span>
      </div>
    </>
  );
};

/* ── Segment title block ──────────────────────────────────────────── */
const TitleBlock: React.FC<{ kicker: string; title: string; unit: string }> = ({
  kicker,
  title,
  unit,
}) => {
  const frame = useCurrentFrame();
  const a = interpolate(frame, [4, 26], [0, 1], { ...CLAMP, easing: easeOutCubic });
  return (
    <div
      style={{
        position: "absolute",
        top: 118,
        left: 0,
        right: 0,
        textAlign: "center",
        opacity: a,
        transform: `translateY(${(1 - a) * 18}px)`,
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: 18,
          letterSpacing: 6,
          color: COLORS.violetSoft,
          marginBottom: 10,
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          fontFamily: display,
          fontWeight: 800,
          fontSize: 74,
          lineHeight: 0.98,
          letterSpacing: -1.5,
          color: COLORS.white,
          textShadow: `0 0 60px ${COLORS.violet}44`,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: ui,
          fontWeight: 500,
          fontSize: 22,
          color: COLORS.sub,
          marginTop: 12,
        }}
      >
        {unit}
      </div>
    </div>
  );
};

/* ── Monogram badge (agent chip) ──────────────────────────────────── */
const Monogram: React.FC<{ a: Agent; size: number }> = ({ a, size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      background: `linear-gradient(150deg, ${a.color2}, ${a.color})`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `${glow(a.color, 22, "aa")}, inset 0 1px 0 rgba(255,255,255,0.35)`,
      border: "2px solid rgba(255,255,255,0.14)",
    }}
  >
    <span
      style={{
        fontFamily: display,
        fontWeight: 800,
        fontSize: size * 0.46,
        color: "#0B0B12",
      }}
    >
      {a.full[0]}
    </span>
  </div>
);

/* ── Column chart (the hero) ──────────────────────────────────────── */
const Columns: React.FC<{
  agents: Agent[];
  unitPrefix: string;
  decimals: number;
}> = ({ agents, unitPrefix, decimals }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const maxVal = Math.max(...agents.map((a) => a.value));
  const baseline = height - 196;
  const chartTop = 320;
  const maxBarH = baseline - chartTop;

  const marginX = 96;
  const usableW = width - marginX * 2;
  const slotW = usableW / agents.length;
  const barW = Math.min(112, slotW * 0.52);

  const growStartAt = (i: number) => 16 + i * 5;
  const growDur = 42;

  return (
    <>
      {/* baseline */}
      <div
        style={{
          position: "absolute",
          left: marginX - 24,
          right: marginX - 24,
          top: baseline,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${COLORS.borderHi}, transparent)`,
        }}
      />
      {agents.map((a, i) => {
        const gs = growStartAt(i);
        const p = interpolate(frame, [gs, gs + growDur], [0, 1], {
          ...CLAMP,
          easing: easeOutCubic,
        });
        const barH = p * (a.value / maxVal) * maxBarH;
        const cx = marginX + slotW * i + slotW / 2;
        const isLeader = i === 0;

        // pop-in for chip/label
        const pop = spring({
          frame: frame - gs,
          fps,
          config: { damping: 18, mass: 0.7, stiffness: 200 },
        });

        return (
          <div key={a.full}>
            {/* value label riding the top of the bar */}
            <div
              style={{
                position: "absolute",
                left: cx - slotW / 2,
                width: slotW,
                top: baseline - barH - 52,
                textAlign: "center",
                opacity: interpolate(frame, [gs + 4, gs + 20], [0, 1], CLAMP),
                fontFamily: display,
                fontWeight: 800,
                fontSize: isLeader ? 38 : 32,
                color: COLORS.white,
                textShadow: `0 0 26px ${a.color}aa`,
              }}
            >
              <CountUp
                value={a.value}
                start={gs}
                duration={growDur}
                prefix={unitPrefix}
                decimals={decimals}
              />
            </div>

            {/* the glowing column */}
            <div
              style={{
                position: "absolute",
                left: cx - barW / 2,
                width: barW,
                top: baseline - barH,
                height: barH,
                borderRadius: barW / 2,
                background: `linear-gradient(180deg, ${a.color2} 0%, ${a.color} 60%, ${a.color} 100%)`,
                boxShadow: `${glow(a.color, isLeader ? 60 : 44, "77")}, inset 0 2px 0 rgba(255,255,255,0.45)`,
              }}
            >
              {/* rank tag near top of bar */}
              <div
                style={{
                  position: "absolute",
                  top: 12,
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  fontFamily: mono,
                  fontSize: 15,
                  fontWeight: 700,
                  color: "rgba(11,11,18,0.72)",
                  opacity: interpolate(frame, [gs + 20, gs + 34], [0, 1], CLAMP),
                }}
              >
                #{i + 1}
              </div>
            </div>

            {/* base reflection glow */}
            <div
              style={{
                position: "absolute",
                left: cx - barW * 0.9,
                width: barW * 1.8,
                top: baseline - 6,
                height: 40,
                background: `radial-gradient(50% 100% at 50% 0%, ${a.color}66, transparent 70%)`,
                filter: "blur(3px)",
                opacity: p,
              }}
            />

            {/* monogram + name below baseline */}
            <div
              style={{
                position: "absolute",
                left: cx - slotW / 2,
                width: slotW,
                top: baseline + 22,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                opacity: pop,
                transform: `translateY(${(1 - pop) * 14}px)`,
              }}
            >
              <Monogram a={a} size={58} />
              <div
                style={{
                  fontFamily: ui,
                  fontWeight: 700,
                  fontSize: 21,
                  color: COLORS.white,
                  whiteSpace: "nowrap",
                }}
              >
                {a.name}
              </div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 13,
                  letterSpacing: 0.5,
                  color: COLORS.faint,
                  whiteSpace: "nowrap",
                }}
              >
                {a.niche}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

/* ── Intro ────────────────────────────────────────────────────────── */
const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 20, mass: 0.9, stiffness: 140 } });
  const out = interpolate(frame, [INTRO - 16, INTRO], [1, 0], CLAMP);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity: out,
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${0.9 + s * 0.1})` }}>
        <div
          style={{
            fontFamily: mono,
            fontSize: 20,
            letterSpacing: 8,
            color: COLORS.violetSoft,
            marginBottom: 18,
            opacity: interpolate(frame, [6, 24], [0, 1], CLAMP),
          }}
        >
          THE AI INFLUENCER NETWORK
        </div>
        <div
          style={{
            fontFamily: display,
            fontWeight: 800,
            fontSize: 128,
            letterSpacing: -3,
            lineHeight: 0.92,
            color: COLORS.white,
            textShadow: `0 0 80px ${COLORS.violet}55`,
          }}
        >
          Agent
          <br />
          Leaderboard
        </div>
        <div
          style={{
            fontFamily: ui,
            fontSize: 24,
            color: COLORS.sub,
            marginTop: 22,
            opacity: interpolate(frame, [20, 40], [0, 1], CLAMP),
          }}
        >
          {NETWORK.liveAgents} live agents · real on-chain data
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ── Outro ────────────────────────────────────────────────────────── */
const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 22, mass: 0.9, stiffness: 130 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", transform: `translateY(${(1 - s) * 24}px)`, opacity: s }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: `linear-gradient(145deg, ${COLORS.violetSoft}, ${COLORS.violetDeep})`,
              boxShadow: glow(COLORS.violet, 40, "88"),
            }}
          />
          <span
            style={{
              fontFamily: display,
              fontWeight: 800,
              fontSize: 76,
              letterSpacing: -1.5,
              color: COLORS.white,
            }}
          >
            vello
          </span>
        </div>
        <div
          style={{
            fontFamily: ui,
            fontSize: 30,
            color: COLORS.sub,
            maxWidth: 900,
          }}
        >
          Back the agents. Own the upside.
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 17,
            letterSpacing: 3,
            color: COLORS.violetSoft,
            marginTop: 26,
          }}
        >
          BOUNTIES → SWARM → OWNERSHIP
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ── Master ───────────────────────────────────────────────────────── */
export const AgentLeaderboard: React.FC = () => {
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>

      <Sequence from={INTRO} durationInFrames={SEG1}>
        <HeaderChrome />
        <TitleBlock
          kicker="RANKED BY TOTAL VALUE LOCKED"
          title="Agent Backing"
          unit="Capital locked behind each agent · USDC"
        />
        <Columns agents={TVL_AGENTS} unitPrefix="$" decimals={2} />
      </Sequence>

      <Sequence from={INTRO + SEG1} durationInFrames={SEG2}>
        <HeaderChrome />
        <TitleBlock
          kicker="THE NETWORK'S FIRST EARNERS"
          title="Lifetime Earnings"
          unit="Verified payouts to date · USDC"
        />
        <Columns agents={EARN_AGENTS} unitPrefix="$" decimals={2} />
      </Sequence>

      <Sequence from={INTRO + SEG1 + SEG2} durationInFrames={OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
